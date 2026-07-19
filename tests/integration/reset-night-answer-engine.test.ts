// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);
const RESET_MIGRATION = path.join(MIGRATIONS_DIR, "0025_reset_night_answer_engine.sql");
const hasResetMigration = existsSync(RESET_MIGRATION);

interface RpcResult {
  code: string;
  applied: boolean;
  runId?: string;
  previousRunId?: string;
  roomRevision?: number;
  controlRevision?: number;
}

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create schema if not exists extensions;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key default gen_random_uuid());
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create publication supabase_realtime;
  `);
  for (const migration of [
    "0001_init.sql",
    "0008_reset_night_to_setup.sql",
    "0013_game_scores_per_game_isolation.sql",
    "0022_live_answer_engine_schema.sql",
    "0023_live_answer_engine_functions.sql",
    "0025_reset_night_answer_engine.sql",
  ]) {
    const migrationPath = path.join(MIGRATIONS_DIR, migration);
    if (existsSync(migrationPath)) await db.exec(readFileSync(migrationPath, "utf8"));
  }
  return db;
}

describe("reset_live_night_to_setup", () => {
  test("requires migration 0025", () => {
    expect(existsSync(RESET_MIGRATION)).toBe(true);
  });

  describe.skipIf(!hasResetMigration)("atomic resilient reset", () => {
    let db: PGlite;
    let hostId: string;
    let nightId: string;
    let oldRunId: string;
    let startCommandId: string;
    let resetCommandId: string;
    let game1Id: string;
    let playId: string;
    let startResult: RpcResult;
    let resetResult: RpcResult;

    beforeAll(async () => {
      db = await freshDb();
      const one = async <T>(sql: string, params: unknown[] = []) =>
        (await db.query<T>(sql, params)).rows[0];

      const user = await one<{ id: string }>("insert into auth.users default values returning id");
      const host = await one<{ id: string }>(
        "insert into hosts (user_id, display_name) values ($1, 'Host') returning id",
        [user.id],
      );
      hostId = host.id;
      oldRunId = crypto.randomUUID();
      const night = await one<{ id: string }>(
        `insert into nights (
           host_id, venue_name, room_code, answer_engine, answer_engine_latched_at,
           current_run_id, room_revision, control_revision, opened_at
         ) values ($1, 'Venue', 'RST001', 'resilient_v1', now(), $2, 7, 7, now())
         returning id`,
        [host.id, oldRunId],
      );
      nightId = night.id;

      const game1 = await one<{ id: string }>(
        "insert into games (night_id, game_no, state) values ($1, 1, 'ready') returning id",
        [nightId],
      );
      game1Id = game1.id;
      const game2 = await one<{ id: string }>(
        "insert into games (night_id, game_no, state, started_at) values ($1, 2, 'live', now()) returning id",
        [nightId],
      );
      const player = await one<{ id: string }>(
        "insert into players (night_id, device_id, display_name) values ($1, gen_random_uuid(), 'Player') returning id",
        [nightId],
      );
      await db.query(
        "insert into game_participations (game_id, player_id) values ($1, $3), ($2, $3)",
        [game1Id, game2.id, player.id],
      );

      const category1 = await one<{ id: string }>(
        "insert into categories (game_id, name, topic, position) values ($1, 'One', 'one', 0) returning id",
        [game1Id],
      );
      const category2 = await one<{ id: string }>(
        "insert into categories (game_id, name, topic, position) values ($1, 'Two', 'two', 0) returning id",
        [game2.id],
      );
      const question1 = await one<{ id: string }>(
        `insert into questions (
           category_id, point_value, prompt, options, correct_index, is_picked
         ) values ($1, 100, 'One?', '["A","B","C","D"]'::jsonb, 0, true)
         returning id`,
        [category1.id],
      );
      const question2 = await one<{ id: string }>(
        `insert into questions (
           category_id, point_value, prompt, options, correct_index, is_picked,
           played_at, finished_at
         ) values ($1, 200, 'Two?', '["A","B","C","D"]'::jsonb, 0, true, now(), now())
         returning id`,
        [category2.id],
      );

      startCommandId = crypto.randomUUID();
      const started = await db.query<{ result: RpcResult }>(
        "select public.start_live_game($1, $2, $3, 7) as result",
        [game1Id, oldRunId, startCommandId],
      );
      startResult = started.rows[0].result;

      const play = await one<{ id: string }>(
        `insert into question_plays (
           night_id, run_id, game_id, category_id, question_id, status, opened_at,
           main_zero_at, final_window_starts_at, final_window_ends_at, finalize_at,
           resolved_at, resolution_reason, eligible_count, confirmed_count
         ) values (
           $1, $2, $3, $4, $5, 'resolved', now() - interval '30 seconds',
           now() - interval '10 seconds', now() - interval '10 seconds',
           now() - interval '8 seconds', now() - interval '8 seconds', now(),
           'deadline', 1, 1
         ) returning id`,
        [nightId, oldRunId, game2.id, category2.id, question2.id],
      );
      playId = play.id;
      await db.query(
        "insert into question_play_eligibility (play_id, player_id, night_id) values ($1, $2, $3)",
        [playId, player.id, nightId],
      );
      await db.query(
        `insert into question_play_answers (
           play_id, player_id, submission_id, visible_slot, canonical_index,
           received_at, locked_at, ms_to_lock, is_correct, awarded_points
         ) values ($1, $2, gen_random_uuid(), 1, 0, now(), now(), 3000, true, 220)`,
        [playId, player.id],
      );
      await db.query(
        `insert into live_room_events (
           night_id, run_id, play_id, game_id, question_id, room_revision,
           control_revision, kind, payload
         ) values ($1, $2, $3, $4, $5, 9, 8, 'play_resolved', '{"status":"resolved"}')`,
        [nightId, oldRunId, playId, game2.id, question2.id],
      );
      await db.query(
        `insert into live_command_receipts (
           night_id, command_id, run_id, kind, request_hash, expected_control_revision,
           expected_game_id, expected_play_id, expected_play_status, status,
           canonical_result, completed_at
         ) values (
           $1, gen_random_uuid(), $2, 'begin_question_play_final_window', 'play-receipt', 8,
           $3, $4, 'resolved', 'applied', '{"code":"applied","applied":true}', now()
         )`,
        [nightId, oldRunId, game2.id, playId],
      );

      await db.query(
        `insert into answers (
           question_id, player_id, chosen_index, scramble, ms_to_lock, is_correct, awarded_points
         ) values ($1, $2, 0, '[0,1,2,3]'::jsonb, 4000, true, 200)`,
        [question2.id, player.id],
      );
      await db.query(
        "insert into reveals (game_id, question_id, event) values ($1, $2, 'resolve')",
        [game2.id, question2.id],
      );
      await db.query(
        "insert into adjustments (player_id, game_id, delta, reason) values ($1, $2, 25, 'manual')",
        [player.id, game2.id],
      );

      resetCommandId = crypto.randomUUID();
      const reset = await db.query<{ result: RpcResult }>(
        "select public.reset_live_night_to_setup($1, $2, $3, 8) as result",
        [nightId, oldRunId, resetCommandId],
      );
      resetResult = reset.rows[0].result;

      // Keep the untouched question in the fixture so the reset must preserve
      // picked content while clearing timestamps from the played question.
      expect(question1.id).toBeTruthy();
    });

    afterAll(async () => {
      await db?.close();
    });

    test("rotates the run, preserves the engine, and resets canonical live state atomically", async () => {
      expect(resetResult).toMatchObject({
        code: "applied",
        applied: true,
        previousRunId: oldRunId,
        roomRevision: 0,
        controlRevision: 0,
      });
      expect(resetResult.runId).toBeTruthy();
      expect(resetResult.runId).not.toBe(oldRunId);

      const night = await db.query<{
        answer_engine: string;
        answer_engine_latched_at: Date | null;
        current_run_id: string;
        room_revision: number;
        control_revision: number;
        opened_at: Date | null;
      }>(
        `select answer_engine, answer_engine_latched_at, current_run_id,
                room_revision, control_revision, opened_at
           from nights where id = $1`,
        [nightId],
      );
      expect(night.rows[0]).toMatchObject({
        answer_engine: "resilient_v1",
        current_run_id: resetResult.runId,
        room_revision: 0,
        control_revision: 0,
        opened_at: null,
      });
      expect(night.rows[0].answer_engine_latched_at).not.toBeNull();

      const games = await db.query<{ state: string; started_at: Date | null; ended_at: Date | null }>(
        "select state, started_at, ended_at from games where night_id = $1 order by game_no",
        [nightId],
      );
      expect(games.rows).toEqual([
        { state: "ready", started_at: null, ended_at: null },
        { state: "ready", started_at: null, ended_at: null },
      ]);

      const questions = await db.query<{ played_at: Date | null; finished_at: Date | null }>(
        `select q.played_at, q.finished_at
           from questions q join categories c on c.id = q.category_id
           join games g on g.id = c.game_id
          where g.night_id = $1 order by g.game_no`,
        [nightId],
      );
      expect(questions.rows).toEqual([
        { played_at: null, finished_at: null },
        { played_at: null, finished_at: null },
      ]);
    });

    test("clears legacy and resilient live rows, adjustments, and old-run events without deleting players", async () => {
      const counts = await db.query<{
        answers: number;
        reveals: number;
        adjustments: number;
        plays: number;
        play_answers: number;
        play_eligibility: number;
        old_events: number;
        players: number;
      }>(
        `select
           (select count(*) from answers a join questions q on q.id = a.question_id
             join categories c on c.id = q.category_id join games g on g.id = c.game_id
            where g.night_id = $1) as answers,
           (select count(*) from reveals r join games g on g.id = r.game_id
            where g.night_id = $1) as reveals,
           (select count(*) from adjustments a join games g on g.id = a.game_id
            where g.night_id = $1) as adjustments,
           (select count(*) from question_plays where night_id = $1) as plays,
           (select count(*) from question_play_answers where play_id = $2) as play_answers,
           (select count(*) from question_play_eligibility where play_id = $2) as play_eligibility,
           (select count(*) from live_room_events where night_id = $1 and run_id = $3) as old_events,
           (select count(*) from players where night_id = $1) as players`,
        [nightId, playId, oldRunId],
      );
      expect(counts.rows[0]).toEqual({
        answers: 0,
        reveals: 0,
        adjustments: 0,
        plays: 0,
        play_answers: 0,
        play_eligibility: 0,
        old_events: 0,
        players: 1,
      });
    });

    test("archives old receipts and preserves exact retries after run rotation", async () => {
      const archived = await db.query<{ request_hash: string; canonical_result: RpcResult }>(
        `select request_hash, canonical_result
           from live_command_receipt_archive
          where night_id = $1 and command_id = $2`,
        [nightId, startCommandId],
      );
      expect(archived.rows).toEqual([{ request_hash: expect.any(String), canonical_result: startResult }]);

      const exactStartRetry = await db.query<{ result: RpcResult }>(
        "select public.start_live_game($1, $2, $3, 7) as result",
        [game1Id, oldRunId, startCommandId],
      );
      expect(exactStartRetry.rows[0].result).toEqual(startResult);

      const exactResetRetry = await db.query<{ result: RpcResult }>(
        "select public.reset_live_night_to_setup($1, $2, $3, 8) as result",
        [nightId, oldRunId, resetCommandId],
      );
      expect(exactResetRetry.rows[0].result).toEqual(resetResult);
    });

    test("rejects and receipts new commands that target the retired run", async () => {
      const commandId = crypto.randomUUID();
      const stale = await db.query<{ result: RpcResult }>(
        "select public.start_live_game($1, $2, $3, 0) as result",
        [game1Id, oldRunId, commandId],
      );
      expect(stale.rows[0].result).toEqual({ code: "stale", applied: false });

      const receipt = await db.query<{ status: string; canonical_result: RpcResult }>(
        `select status, canonical_result from live_command_receipts
          where night_id = $1 and command_id = $2`,
        [nightId, commandId],
      );
      expect(receipt.rows).toEqual([
        { status: "rejected", canonical_result: { code: "stale", applied: false } },
      ]);
    });

    test("keeps receipt history append-only behind security-definer functions", async () => {
      const grants = await db.query<{ grantee: string; privilege_type: string }>(`
        select grantee, privilege_type
          from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name in ('live_night_runs', 'live_command_receipt_archive')
           and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
      `);
      expect(grants.rows).toEqual([]);

      const deleteRules = await db.query<{ constraint_name: string; delete_rule: string }>(`
        select constraint_name, delete_rule
          from information_schema.referential_constraints
         where constraint_schema = 'public'
           and constraint_name in (
             'live_night_runs_night_id_fkey',
             'live_command_receipts_night_run_fk',
             'live_command_receipts_night_fk',
             'live_command_receipt_archive_night_id_fkey',
             'live_command_receipt_archive_run_fk'
           )
         order by constraint_name
      `);
      expect(deleteRules.rows).toHaveLength(5);
      expect(deleteRules.rows.every((row) => row.delete_rule === "CASCADE")).toBe(true);

      await db.exec("set role service_role");
      try {
        await expect(
          db.query(
            `insert into live_night_runs (night_id, run_id, answer_engine)
             values ($1, gen_random_uuid(), 'resilient_v1')`,
            [nightId],
          ),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          db.query(
            "update live_command_receipt_archive set canonical_result = '{}' where night_id = $1",
            [nightId],
          ),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          db.query("delete from live_command_receipt_archive where night_id = $1", [nightId]),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          db.exec("truncate table live_command_receipt_archive"),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await db.exec("reset role");
      }
    });

    test("lets service-role RPCs reopen and reset while preserving exact retries", async () => {
      const commandId = crypto.randomUUID();
      await db.exec("set role service_role");
      try {
        const opened = await db.query<{ result: RpcResult }>(
          "select public.open_night_run($1, $2, $3, 0) as result",
          [nightId, commandId, resetResult.runId],
        );
        expect(opened.rows[0].result).toMatchObject({
          code: "applied",
          applied: true,
          runId: resetResult.runId,
          roomRevision: 1,
          controlRevision: 1,
        });
        const exactOpenRetry = await db.query<{ result: RpcResult }>(
          "select public.open_night_run($1, $2, $3, 0) as result",
          [nightId, commandId, resetResult.runId],
        );
        expect(exactOpenRetry.rows[0].result).toEqual(opened.rows[0].result);

        const secondResetCommandId = crypto.randomUUID();
        const secondReset = await db.query<{ result: RpcResult }>(
          "select public.reset_live_night_to_setup($1, $2, $3, 1) as result",
          [nightId, resetResult.runId, secondResetCommandId],
        );
        expect(secondReset.rows[0].result).toMatchObject({
          code: "applied",
          applied: true,
          previousRunId: resetResult.runId,
          roomRevision: 0,
          controlRevision: 0,
        });
        const exactResetRetry = await db.query<{ result: RpcResult }>(
          "select public.reset_live_night_to_setup($1, $2, $3, 1) as result",
          [nightId, resetResult.runId, secondResetCommandId],
        );
        expect(exactResetRetry.rows[0].result).toEqual(secondReset.rows[0].result);
      } finally {
        await db.exec("reset role");
      }
    });

    test("cascades direct night deletion and host deletion through live and archived receipt history", async () => {
      const staleCommandId = crypto.randomUUID();
      const stale = await db.query<{ result: RpcResult }>(
        "select public.start_live_game($1, $2, $3, 0) as result",
        [game1Id, oldRunId, staleCommandId],
      );
      expect(stale.rows[0].result).toEqual({ code: "stale", applied: false });

      const liveStatuses = await db.query<{ status: string }>(
        "select distinct status from live_command_receipts where night_id = $1 order by status",
        [nightId],
      );
      const archiveStatuses = await db.query<{ status: string }>(
        "select distinct status from live_command_receipt_archive where night_id = $1 order by status",
        [nightId],
      );
      expect(liveStatuses.rows).toEqual([{ status: "applied" }, { status: "rejected" }]);
      expect(archiveStatuses.rows).toEqual([{ status: "applied" }, { status: "rejected" }]);

      await db.query("delete from nights where id = $1", [nightId]);
      const deletedNightChildren = await db.query<{
        runs: number;
        live_receipts: number;
        archived_receipts: number;
      }>(
        `select
           (select count(*) from live_night_runs where night_id = $1) as runs,
           (select count(*) from live_command_receipts where night_id = $1) as live_receipts,
           (select count(*) from live_command_receipt_archive where night_id = $1) as archived_receipts`,
        [nightId],
      );
      expect(deletedNightChildren.rows[0]).toEqual({
        runs: 0,
        live_receipts: 0,
        archived_receipts: 0,
      });

      const hostRunId = crypto.randomUUID();
      const hostNight = await db.query<{ id: string }>(
        `insert into nights (
           host_id, venue_name, room_code, answer_engine, answer_engine_latched_at,
           current_run_id, room_revision, control_revision
         ) values ($1, 'Host cascade', 'HST001', 'resilient_v1', now(), $2, 1, 1)
         returning id`,
        [hostId, hostRunId],
      );
      const hostNightId = hostNight.rows[0].id;
      await db.query(
        `insert into live_command_receipts (
           night_id, command_id, run_id, kind, request_hash, expected_control_revision,
           status, canonical_result, completed_at
         ) values
           ($1, gen_random_uuid(), $2, 'fixture_applied', 'a', 0, 'applied',
            '{"code":"applied","applied":true}', now()),
           ($1, gen_random_uuid(), $2, 'fixture_rejected', 'r', 0, 'rejected',
            '{"code":"stale","applied":false}', now())`,
        [hostNightId, hostRunId],
      );
      await db.query(
        `insert into live_command_receipt_archive (
           night_id, command_id, run_id, kind, request_hash, expected_control_revision,
           status, canonical_result, created_at, completed_at
         ) values
           ($1, gen_random_uuid(), $2, 'fixture_applied', 'aa', 0, 'applied',
            '{"code":"applied","applied":true}', now(), now()),
           ($1, gen_random_uuid(), $2, 'fixture_rejected', 'rr', 0, 'rejected',
            '{"code":"stale","applied":false}', now(), now())`,
        [hostNightId, hostRunId],
      );

      await db.query("delete from hosts where id = $1", [hostId]);
      const deletedHostChildren = await db.query<{
        nights: number;
        runs: number;
        live_receipts: number;
        archived_receipts: number;
      }>(
        `select
           (select count(*) from nights where id = $1) as nights,
           (select count(*) from live_night_runs where night_id = $1) as runs,
           (select count(*) from live_command_receipts where night_id = $1) as live_receipts,
           (select count(*) from live_command_receipt_archive where night_id = $1) as archived_receipts`,
        [hostNightId],
      );
      expect(deletedHostChildren.rows[0]).toEqual({
        nights: 0,
        runs: 0,
        live_receipts: 0,
        archived_receipts: 0,
      });
    });
  });
});
