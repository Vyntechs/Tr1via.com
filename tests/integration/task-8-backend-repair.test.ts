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
const REPAIR_MIGRATION = path.join(
  MIGRATIONS_DIR,
  "0027_durable_answer_admission_repair.sql",
);

type Json = Record<string, unknown>;
type Envelope = { freshlyApplied: boolean; result: Json };
type Fixture = {
  hostId: string;
  nightId: string;
  gameId: string;
  categoryId: string;
  questionId: string;
  playerId: string;
  deviceId: string;
  roomCode: string;
};

function uuid(): string {
  return crypto.randomUUID();
}

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create schema if not exists extensions;
    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key default gen_random_uuid()
    );
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.auth_uid', true), '')::uuid
    $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create publication supabase_realtime;
  `);

  await db.exec(readFileSync(path.join(MIGRATIONS_DIR, "0001_init.sql"), "utf8"));
  await db.exec(`
    grant usage on schema public to anon, authenticated, service_role;
    grant select, insert, update, delete on all tables in schema public
      to anon, authenticated;
    grant all on all tables in schema public to service_role;
    grant execute on all functions in schema public
      to anon, authenticated, service_role;
  `);

  for (const migration of [
    "0002_rls.sql",
    "0021_live_security_gate.sql",
    "0022_live_answer_engine_schema.sql",
    "0023_live_answer_engine_functions.sql",
    "0024_game_scores_answer_engine.sql",
    "0025_reset_night_answer_engine.sql",
    "0026_atomic_answer_engine_open.sql",
  ]) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, migration), "utf8"));
  }
  if (existsSync(REPAIR_MIGRATION)) {
    await db.exec(readFileSync(REPAIR_MIGRATION, "utf8"));
  }
  return db;
}

async function rpc(
  db: PGlite,
  sql: string,
  params: unknown[],
): Promise<Envelope> {
  const result = await db.query<{ result: Envelope }>(sql, params);
  return result.rows[0].result;
}

async function createFixture(
  db: PGlite,
  options: { categoryState?: "draft" | "ready"; pickedQuestion?: boolean } = {},
): Promise<Fixture> {
  const hostUserId = uuid();
  const hostId = uuid();
  const nightId = uuid();
  const gameId = uuid();
  const categoryId = uuid();
  const questionId = uuid();
  const playerId = uuid();
  const deviceId = uuid();
  const roomCode = `T${uuid().replaceAll("-", "").slice(0, 5).toUpperCase()}`;
  await db.query("insert into auth.users (id) values ($1)", [hostUserId]);
  await db.query(
    "insert into hosts (id, user_id, display_name) values ($1, $2, 'Task 8 host')",
    [hostId, hostUserId],
  );
  await db.query(
    `insert into host_answer_engine_settings (
       host_id, release_enabled, preferred_engine
     ) values ($1, true, 'resilient_v1')`,
    [hostId],
  );
  await db.query(
    `insert into nights (id, host_id, venue_name, room_code)
     values ($1, $2, 'Task 8 venue', $3)`,
    [nightId, hostId, roomCode],
  );
  await db.query(
    "insert into games (id, night_id, game_no, state) values ($1, $2, 1, 'ready')",
    [gameId, nightId],
  );
  await db.query(
    `insert into categories (id, game_id, name, topic, position, state)
     values ($1, $2, 'Repair', 'Repair', 0, $3)`,
    [categoryId, gameId, options.categoryState ?? "ready"],
  );
  await db.query(
    `insert into questions (
       id, category_id, point_value, prompt, options, correct_index, is_picked
     ) values ($1, $2, 100, 'Repair?', '["A","B","C","D"]'::jsonb, 0, $3)`,
    [questionId, categoryId, options.pickedQuestion ?? true],
  );
  await db.query(
    `insert into players (id, night_id, device_id, display_name)
     values ($1, $2, $3, 'Repair player')`,
    [playerId, nightId, deviceId],
  );
  await db.query(
    "insert into game_participations (game_id, player_id) values ($1, $2)",
    [gameId, playerId],
  );
  return {
    hostId,
    nightId,
    gameId,
    categoryId,
    questionId,
    playerId,
    deviceId,
    roomCode,
  };
}

async function openRun(db: PGlite, fixture: Fixture): Promise<string> {
  const opened = await rpc(
    db,
    "select public.open_night_run($1, $2, null::uuid, 0::bigint) as result",
    [fixture.nightId, uuid()],
  );
  expect(opened.result).toMatchObject({ code: "applied", applied: true });
  return opened.result.runId as string;
}

async function startGame(
  db: PGlite,
  fixture: Fixture,
  runId: string,
): Promise<Envelope> {
  return rpc(
    db,
    "select public.start_live_game($1, $2, $3, 1::bigint) as result",
    [fixture.gameId, runId, uuid()],
  );
}

async function readyPlay(
  db: PGlite,
): Promise<{ fixture: Fixture; runId: string; playId: string }> {
  const fixture = await createFixture(db);
  const runId = await openRun(db, fixture);
  expect((await startGame(db, fixture, runId)).result.code).toBe("applied");
  const opened = await rpc(
    db,
    `select public.open_question_play(
       $1, $2, $3, $4, 2::bigint
     ) as result`,
    [fixture.gameId, fixture.questionId, runId, uuid()],
  );
  expect(opened.result.code).toBe("applied");
  return { fixture, runId, playId: opened.result.playId as string };
}

async function claim(
  db: PGlite,
  playId: string,
  runId: string,
  deviceId: string,
  submissionId = uuid(),
  slot = 1,
): Promise<Envelope> {
  return rpc(
    db,
    `select public.claim_question_play_answer(
       $1, $2, $3, $4, $5::smallint
     ) as result`,
    [playId, runId, deviceId, submissionId, slot],
  );
}

async function applyClaim(
  db: PGlite,
  playId: string,
  runId: string,
  deviceId: string,
): Promise<Envelope> {
  return rpc(
    db,
    `select public.apply_claimed_question_play_answer(
       $1, $2, $3
     ) as result`,
    [playId, runId, deviceId],
  );
}

describe("0027 durable answer admission repair", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await freshDb();
  });

  afterAll(async () => {
    await db?.close();
  });

  test("ships as one additive migration after 0026", () => {
    expect(existsSync(REPAIR_MIGRATION)).toBe(true);
  });

  test("rejects a resilient empty board without changing game state, revisions, or events", async () => {
    const fixture = await createFixture(db, {
      categoryState: "ready",
      pickedQuestion: false,
    });
    const runId = await openRun(db, fixture);
    const before = await db.query<{
      state: string;
      room_revision: number;
      control_revision: number;
      events: number;
    }>(
      `select g.state, n.room_revision, n.control_revision,
              (select count(*)::int from live_room_events e
                where e.night_id = n.id) as events
         from games g join nights n on n.id = g.night_id
        where g.id = $1`,
      [fixture.gameId],
    );

    const started = await startGame(db, fixture, runId);
    expect(started).toMatchObject({
      freshlyApplied: false,
      result: { code: "invalid_state", applied: false },
    });
    const after = await db.query(
      `select g.state, n.room_revision, n.control_revision,
              (select count(*)::int from live_room_events e
                where e.night_id = n.id) as events
         from games g join nights n on n.id = g.night_id
        where g.id = $1`,
      [fixture.gameId],
    );
    expect(after.rows).toEqual(before.rows);
  });

  test("persists admission before application and a retry applies the first answer once", async () => {
    const { fixture, runId, playId } = await readyPlay(db);
    const firstSubmission = uuid();
    const admitted = await claim(
      db,
      playId,
      runId,
      fixture.deviceId,
      firstSubmission,
      2,
    );
    expect(admitted).toMatchObject({
      freshlyApplied: true,
      result: { code: "claimed", duplicate: false },
    });
    const pending = await db.query<{
      submission_id: string;
      visible_slot: number;
      canonical_result: Json | null;
      confirmed_count: number;
      progress_events: number;
    }>(
      `select a.submission_id, a.visible_slot, a.canonical_result,
              p.confirmed_count,
              (select count(*)::int from live_room_events e
                where e.play_id = p.id and e.kind = 'answer_progress') as progress_events
         from question_play_answers a
         join question_plays p on p.id = a.play_id
        where a.play_id = $1 and a.player_id = $2`,
      [playId, fixture.playerId],
    );
    expect(pending.rows[0]).toEqual({
      submission_id: firstSubmission,
      visible_slot: 2,
      canonical_result: null,
      confirmed_count: 0,
      progress_events: 0,
    });

    const lostAckRetry = await claim(
      db,
      playId,
      runId,
      fixture.deviceId,
      uuid(),
      4,
    );
    expect(lostAckRetry).toMatchObject({
      freshlyApplied: false,
      result: { code: "claimed", duplicate: true },
    });

    const applied = await applyClaim(db, playId, runId, fixture.deviceId);
    const replay = await applyClaim(db, playId, runId, fixture.deviceId);
    expect(applied).toMatchObject({
      freshlyApplied: true,
      result: { code: "confirmed", confirmedSlot: 2, duplicate: false },
    });
    expect(replay).toEqual({ freshlyApplied: false, result: applied.result });

    const canonical = await db.query<{
      canonical_result: Json;
      confirmed_count: number;
      progress_events: number;
    }>(
      `select a.canonical_result, p.confirmed_count,
              (select count(*)::int from live_room_events e
                where e.play_id = p.id and e.kind = 'answer_progress') as progress_events
         from question_play_answers a
         join question_plays p on p.id = a.play_id
        where a.play_id = $1 and a.player_id = $2`,
      [playId, fixture.playerId],
    );
    expect(canonical.rows[0]).toMatchObject({
      canonical_result: { duplicate: false, confirmedSlot: 2 },
      confirmed_count: 1,
      progress_events: 1,
    });
  });

  test("a due finalizer drains and scores a committed pending claim once", async () => {
    const { fixture, runId, playId } = await readyPlay(db);
    await claim(db, playId, runId, fixture.deviceId, uuid(), 1);
    await db.query(
      `update questions
          set correct_index = (
            select canonical_index from question_play_answers where play_id = $1
          )
        where id = $2`,
      [playId, fixture.questionId],
    );
    await db.query(
      `update question_plays
          set opened_at = now() - interval '5 seconds',
              main_zero_at = now() - interval '3 seconds',
              final_window_ends_at = now() - interval '1 second'
        where id = $1`,
      [playId],
    );

    const finalized = await rpc(
      db,
      `select public.finalize_current_play_if_due($1, $2, $3) as result`,
      [fixture.roomCode, runId, playId],
    );
    expect(finalized.result.code).toBe("resolved");
    const state = await db.query<{
      status: string;
      confirmed_count: number;
      awarded_points: number;
      canonical_result: Json;
      progress_events: number;
      terminal_events: number;
    }>(
      `select p.status, p.confirmed_count, a.awarded_points, a.canonical_result,
              (select count(*)::int from live_room_events e
                where e.play_id = p.id and e.kind = 'answer_progress') as progress_events,
              (select count(*)::int from live_room_events e
                where e.play_id = p.id and e.kind = 'play_resolved') as terminal_events
         from question_plays p
         join question_play_answers a on a.play_id = p.id
        where p.id = $1`,
      [playId],
    );
    expect(state.rows[0]).toMatchObject({
      status: "resolved",
      confirmed_count: 1,
      awarded_points: 110,
      canonical_result: { code: "confirmed", duplicate: false },
      progress_events: 1,
      terminal_events: 1,
    });
  });

  test("Show Answer reconciles a pending claim before its host transition", async () => {
    const { fixture, runId, playId } = await readyPlay(db);
    await claim(db, playId, runId, fixture.deviceId, uuid(), 3);
    const shown = await rpc(
      db,
      `select public.begin_question_play_final_window(
         $1, $2, $3, $4, 3::bigint
       ) as result`,
      [fixture.gameId, playId, runId, uuid()],
    );
    expect(shown.result).toMatchObject({ code: "applied", applied: true });
    const state = await db.query<{
      status: string;
      confirmed_count: number;
      canonicalized: boolean;
      progress_events: number;
      show_events: number;
    }>(
      `select p.status, p.confirmed_count,
              (a.canonical_result is not null) as canonicalized,
              (select count(*)::int from live_room_events e
                where e.play_id = p.id and e.kind = 'answer_progress') as progress_events,
              (select count(*)::int from live_room_events e
                where e.play_id = p.id and e.kind = 'final_window_started') as show_events
         from question_plays p
         join question_play_answers a on a.play_id = p.id
        where p.id = $1`,
      [playId],
    );
    expect(state.rows[0]).toEqual({
      status: "final_window",
      confirmed_count: 1,
      canonicalized: true,
      progress_events: 1,
      show_events: 1,
    });
  });

  test("an overdue Show Answer reconciles and scores a pending claim before immediate resolution", async () => {
    const { fixture, runId, playId } = await readyPlay(db);
    await claim(db, playId, runId, fixture.deviceId, uuid(), 1);
    await db.query(
      `update questions
          set correct_index = (
            select canonical_index from question_play_answers where play_id = $1
          )
        where id = $2`,
      [playId, fixture.questionId],
    );
    await db.query(
      `update question_plays
          set opened_at = now() - interval '5 seconds',
              main_zero_at = now() - interval '3 seconds',
              final_window_ends_at = now() - interval '1 second'
        where id = $1`,
      [playId],
    );

    const shown = await rpc(
      db,
      `select public.begin_question_play_final_window(
         $1, $2, $3, $4, 3::bigint
       ) as result`,
      [fixture.gameId, playId, runId, uuid()],
    );
    expect(shown.result).toMatchObject({
      code: "resolved",
      applied: true,
      eventKind: "play_resolved",
    });
    const state = await db.query<{
      status: string;
      confirmed_count: number;
      awarded_points: number;
      canonicalized: boolean;
      progress_events: number;
      terminal_events: number;
    }>(
      `select p.status, p.confirmed_count, a.awarded_points,
              (a.canonical_result is not null) as canonicalized,
              (select count(*)::int from live_room_events e
                where e.play_id = p.id and e.kind = 'answer_progress') as progress_events,
              (select count(*)::int from live_room_events e
                where e.play_id = p.id and e.kind = 'play_resolved') as terminal_events
         from question_plays p
         join question_play_answers a on a.play_id = p.id
        where p.id = $1`,
      [playId],
    );
    expect(state.rows[0]).toEqual({
      status: "resolved",
      confirmed_count: 1,
      awarded_points: 110,
      canonicalized: true,
      progress_events: 1,
      terminal_events: 1,
    });
  });

  test("undo reconciles a pending claim and preserves its canonical retry", async () => {
    const { fixture, runId, playId } = await readyPlay(db);
    await claim(db, playId, runId, fixture.deviceId, uuid(), 2);
    const undone = await rpc(
      db,
      `select public.undo_question_play(
         $1, $2, $3, $4, 3::bigint
       ) as result`,
      [fixture.gameId, playId, runId, uuid()],
    );
    expect(undone.result).toMatchObject({ code: "applied", applied: true });
    const replayClaim = await claim(
      db,
      playId,
      runId,
      fixture.deviceId,
      uuid(),
      4,
    );
    const replay = await applyClaim(db, playId, runId, fixture.deviceId);
    expect(replayClaim.result).toMatchObject({ code: "claimed", duplicate: true });
    expect(replay.result).toMatchObject({
      code: "confirmed",
      confirmedSlot: 2,
      duplicate: false,
    });
    const state = await db.query<{ status: string; answers: number }>(
      `select status,
              (select count(*)::int from question_play_answers where play_id = $1) as answers
         from question_plays where id = $1`,
      [playId],
    );
    expect(state.rows[0]).toEqual({ status: "undone", answers: 1 });
  });

  test("reset disposes a pending claim while rotating the run", async () => {
    const { fixture, runId, playId } = await readyPlay(db);
    await claim(db, playId, runId, fixture.deviceId, uuid(), 1);
    const reset = await rpc(
      db,
      `select public.reset_live_night_to_setup(
         $1, $2, $3, 3::bigint
       ) as result`,
      [fixture.nightId, runId, uuid()],
    );
    expect(reset.result).toMatchObject({
      code: "applied",
      previousRunId: runId,
    });
    const remnants = await db.query<{ plays: number; answers: number }>(
      `select
         (select count(*)::int from question_plays where night_id = $1) as plays,
         (select count(*)::int from question_play_answers where play_id = $2) as answers`,
      [fixture.nightId, playId],
    );
    expect(remnants.rows[0]).toEqual({ plays: 0, answers: 0 });
  });

  test.each([
    [
      "topic suggestion INSERT",
      "insert into topic_suggestions (player_id, text) values ($1, 'Denied')",
      (fixture: Fixture) => [fixture.playerId],
    ],
    [
      "topic suggestion UPDATE",
      "update topic_suggestions set text = 'Denied' where player_id = $1",
      (fixture: Fixture) => [fixture.playerId],
    ],
    [
      "topic suggestion DELETE",
      "delete from topic_suggestions where player_id = $1",
      (fixture: Fixture) => [fixture.playerId],
    ],
    [
      "audience vote INSERT",
      "insert into audience_topic_votes (night_id, player_id, topic) values ($1, $2, 'Denied')",
      (fixture: Fixture) => [fixture.nightId, fixture.playerId],
    ],
    [
      "audience vote UPDATE",
      "update audience_topic_votes set topic = 'Denied' where night_id = $1 and player_id = $2",
      (fixture: Fixture) => [fixture.nightId, fixture.playerId],
    ],
    [
      "audience vote DELETE",
      "delete from audience_topic_votes where night_id = $1 and player_id = $2",
      (fixture: Fixture) => [fixture.nightId, fixture.playerId],
    ],
  ])("denies direct anonymous %s", async (_label, sql, paramsFor) => {
    const fixture = await createFixture(db);
    await db.query(
      "insert into topic_suggestions (player_id, text) values ($1, 'Seed')",
      [fixture.playerId],
    );
    await db.query(
      `insert into audience_topic_votes (night_id, player_id, topic)
       values ($1, $2, 'Seed')`,
      [fixture.nightId, fixture.playerId],
    );
    await db.exec(
      `select set_config(
         'request.headers',
         '{"x-tr1via-device":"${fixture.deviceId}"}',
         false
       ); set role anon;`,
    );
    try {
      await expect(db.query(sql, paramsFor(fixture))).rejects.toThrow(
        /permission denied|topic_suggestions|audience_topic_votes/i,
      );
    } finally {
      await db.exec(
        "reset role; select set_config('request.headers', '', false);",
      );
    }
  });

  test("exposes only the two-step service-role answer API", async () => {
    const routines = await db.query<{
      name: string;
      service_execute: boolean;
      anon_execute: boolean;
      authenticated_execute: boolean;
    }>(`
      select p.proname as name,
             has_function_privilege(
               'service_role', p.oid, 'execute'
             ) as service_execute,
             has_function_privilege('anon', p.oid, 'execute') as anon_execute,
             has_function_privilege(
               'authenticated', p.oid, 'execute'
             ) as authenticated_execute
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'claim_question_play_answer',
           'apply_claimed_question_play_answer'
         )
       order by p.proname
    `);
    expect(routines.rows).toEqual([
      {
        name: "apply_claimed_question_play_answer",
        service_execute: true,
        anon_execute: false,
        authenticated_execute: false,
      },
      {
        name: "claim_question_play_answer",
        service_execute: true,
        anon_execute: false,
        authenticated_execute: false,
      },
    ]);
    const unsafe = await db.query<{ signature: string | null }>(
      `select to_regprocedure(
         'public.submit_question_play_answer(uuid,uuid,uuid,uuid,smallint)'
       )::text as signature`,
    );
    expect(unsafe.rows[0].signature).toBeNull();
  });
});
