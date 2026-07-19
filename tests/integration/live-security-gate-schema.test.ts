// @vitest-environment node
//
// The live player browser is an untrusted transport. This test uses the real
// Postgres policies to prove a copied x-tr1via-device header cannot become an
// authorization credential for another player's answer or room membership.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);
const LIVE_SECURITY_GATE = path.join(MIGRATIONS_DIR, "0021_live_security_gate.sql");

async function freshRlsDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create schema if not exists extensions;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key default gen_random_uuid());
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.auth_uid', true), '')::uuid
    $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  `);

  for (const migration of [
    "0001_init.sql",
    "0002_rls.sql",
    "0008_reset_night_to_setup.sql",
    "0012_swap_point_value.sql",
    "0014_questions_withhold_correct_index_from_players.sql",
    "0018_resolve_question_if_all_locked.sql",
  ]) {
    if (migration === "0002_rls.sql") {
      await db.exec(`
        grant usage on schema public to anon, authenticated, service_role;
        grant select, insert, update, delete on all tables in schema public to anon, authenticated;
        grant all on all tables in schema public to service_role;
        grant execute on all functions in schema public to anon, authenticated, service_role;
      `);
    }
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, migration), "utf8"));
  }

  // Until it is created, leave the fixture at the currently-shipped policy
  // boundary. The explicit existence assertion below then fails for the
  // missing migration, rather than turning this suite into a file-read error.
  if (existsSync(LIVE_SECURITY_GATE)) {
    await db.exec(readFileSync(LIVE_SECURITY_GATE, "utf8"));
  }

  return db;
}

describe("0021 live security gate", () => {
  let db: PGlite;
  let hostUserId: string;
  let nightId: string;
  let gameId: string;
  let victimPlayerId: string;
  let attackerPlayerId: string;
  let liveQuestionWithAnswerId: string;
  let liveQuestionForInsertId: string;
  let gameForParticipationId: string;
  const forgedVictimDeviceId = "11111111-1111-1111-1111-111111111111";

  async function runAsForgedPlayer(sql: string, params: unknown[] = []) {
    await db.exec(
      `select set_config('request.headers', '{"x-tr1via-device":"${forgedVictimDeviceId}"}', false);`,
    );
    await db.exec("set role anon;");
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec("reset role; select set_config('request.headers', '', false);");
    }
  }

  async function runAsServiceRole(sql: string, params: unknown[] = []) {
    await db.exec("set role service_role;");
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec("reset role;");
    }
  }

  async function runAsAuthenticatedHost(sql: string, params: unknown[] = []) {
    await db.exec(`select set_config('test.auth_uid', '${hostUserId}', false);`);
    await db.exec(`select set_config('request.headers', '{}', false);`);
    await db.exec("set role authenticated;");
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec(
        "reset role; select set_config('test.auth_uid', '', false); select set_config('request.headers', '{}', false);",
      );
    }
  }

  beforeAll(async () => {
    db = await freshRlsDb();
    const id = async (sql: string, params: unknown[] = []) =>
      (await db.query<{ id: string }>(`${sql} returning id`, params)).rows[0].id;

    hostUserId = await id("insert into auth.users default values");
    const hostId = await id("insert into hosts (user_id, display_name) values ($1, 'Host')", [hostUserId]);
    nightId = await id(
      "insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', 'GATE01')",
      [hostId],
    );
    gameId = await id("insert into games (night_id, game_no) values ($1, 1)", [nightId]);
    gameForParticipationId = await id(
      "insert into games (night_id, game_no) values ($1, 2)",
      [nightId],
    );
    const categoryId = await id(
      "insert into categories (game_id, name, topic, position) values ($1, 'Category', 'Topic', 0)",
      [gameId],
    );
    victimPlayerId = await id(
      "insert into players (night_id, device_id, display_name) values ($1, $2, 'Victim')",
      [nightId, forgedVictimDeviceId],
    );
    attackerPlayerId = await id(
      "insert into players (night_id, device_id, display_name) values ($1, '22222222-2222-2222-2222-222222222222', 'Attacker')",
      [nightId],
    );
    await id(
      "insert into game_participations (game_id, player_id) values ($1, $2)",
      [gameForParticipationId, attackerPlayerId],
    );
    liveQuestionWithAnswerId = await id(
      `insert into questions (category_id, point_value, prompt, options, correct_index, is_picked, played_at)
       values ($1, 100, 'Answered?', '["A","B","C","D"]'::jsonb, 0, true, now())`,
      [categoryId],
    );
    liveQuestionForInsertId = await id(
      `insert into questions (category_id, point_value, prompt, options, correct_index, is_picked, played_at)
       values ($1, 200, 'Unanswered?', '["A","B","C","D"]'::jsonb, 1, true, now())`,
      [categoryId],
    );
    await db.query(
      `insert into answers (question_id, player_id, chosen_index, scramble, ms_to_lock)
       values ($1, $2, 0, '[0,1,2,3]'::jsonb, 500)`,
      [liveQuestionWithAnswerId, victimPlayerId],
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  test("requires the additive 0021 privilege gate migration", () => {
    expect(existsSync(LIVE_SECURITY_GATE)).toBe(true);
  });

  test("rejects SELECT of answers using a forged player header", async () => {
    await expect(
      runAsForgedPlayer("select id, chosen_index from answers where player_id = $1", [victimPlayerId]),
    ).rejects.toThrow(/permission denied|answers/i);
  });

  test("rejects INSERT of answers using a forged player header", async () => {
    await expect(
      runAsForgedPlayer(
        `insert into answers (question_id, player_id, chosen_index, scramble, ms_to_lock)
         values ($1, $2, 1, '[0,1,2,3]'::jsonb, 900)`,
        [liveQuestionForInsertId, victimPlayerId],
      ),
    ).rejects.toThrow(/permission denied|answers/i);
  });

  test("rejects UPDATE of answers using a forged player header", async () => {
    await expect(
      runAsForgedPlayer("update answers set chosen_index = 2 where player_id = $1", [victimPlayerId]),
    ).rejects.toThrow(/permission denied|answers/i);
  });

  test("rejects DELETE of answers using a forged player header", async () => {
    await expect(
      runAsForgedPlayer("delete from answers where player_id = $1", [victimPlayerId]),
    ).rejects.toThrow(/permission denied|answers/i);
  });

  test("rejects forged-header mutation of a player", async () => {
    await expect(
      runAsForgedPlayer("update players set display_name = 'Impersonated' where id = $1", [victimPlayerId]),
    ).rejects.toThrow(/permission denied|players/i);
  });

  test("rejects forged-header mutation of game participation", async () => {
    await expect(
      runAsForgedPlayer(
        "insert into game_participations (game_id, player_id) values ($1, $2)",
        [gameForParticipationId, victimPlayerId],
      ),
    ).rejects.toThrow(/permission denied|game_participations/i);
  });

  test("rejects SELECT of raw players and device identity using a forged player header", async () => {
    await expect(
      runAsForgedPlayer(
        "select id, device_id, display_name from public.players where id = $1",
        [victimPlayerId],
      ),
    ).rejects.toThrow(/permission denied|players/i);
  });

  test("rejects SELECT of raw game participation using a forged player header", async () => {
    await expect(
      runAsForgedPlayer(
        "select game_id, player_id from public.game_participations where game_id = $1",
        [gameForParticipationId],
      ),
    ).rejects.toThrow(/permission denied|game_participations/i);
  });

  test("preserves authenticated host roster and participation reads", async () => {
    const roster = await runAsAuthenticatedHost(
      "select id, device_id, display_name from public.players where id = $1",
      [victimPlayerId],
    );
    expect(roster.rows).toEqual([
      {
        id: victimPlayerId,
        device_id: forgedVictimDeviceId,
        display_name: "Victim",
      },
    ]);

    const participation = await runAsAuthenticatedHost(
      `select game_id, player_id
       from public.game_participations
       where game_id = $1 and player_id = $2`,
      [gameForParticipationId, attackerPlayerId],
    );
    expect(participation.rows).toEqual([
      { game_id: gameForParticipationId, player_id: attackerPlayerId },
    ]);
  });

  test("grants live mutation functions only to service_role", async () => {
    const grants = await db.query<{ routine_name: string; grantee: string; privilege_type: string }>(
      `select routine_name, grantee, privilege_type
       from information_schema.routine_privileges
       where routine_schema = 'public'
         and routine_name in (
           'resolve_question',
           'resolve_question_if_all_locked',
           'reset_night_to_setup',
           'swap_point_value'
         )
       order by routine_name, grantee, privilege_type`,
    );

    for (const routine of [
      "resolve_question",
      "resolve_question_if_all_locked",
      "reset_night_to_setup",
      "swap_point_value",
    ]) {
      const routineGrants = grants.rows.filter((row) => row.routine_name === routine);
      expect(routineGrants.filter((row) => row.grantee === "service_role")).toEqual([
        expect.objectContaining({ privilege_type: "EXECUTE" }),
      ]);
      // `postgres` owns the test database and is not a Supabase request role.
      // Every role a browser/client request can assume must be absent here.
      expect(
        routineGrants.filter((row) => ["PUBLIC", "anon", "authenticated"].includes(row.grantee)),
      ).toEqual([]);
    }
  });

  test("rejects direct anonymous execution of every live mutation function", async () => {
    const calls: Array<[string, unknown[]]> = [
      ["select public.resolve_question($1)", [liveQuestionWithAnswerId]],
      ["select public.resolve_question_if_all_locked($1)", [liveQuestionWithAnswerId]],
      ["select public.reset_night_to_setup($1)", [nightId]],
      ["select public.swap_point_value($1, $2)", [liveQuestionForInsertId, 300]],
    ];

    for (const [sql, params] of calls) {
      await expect(runAsForgedPlayer(sql, params)).rejects.toThrow(/permission denied|function/i);
    }
  });

  test("hardens every live SECURITY DEFINER function with a trusted search_path", async () => {
    const functions = await db.query<{
      proname: string;
      prosecdef: boolean;
      proconfig: string[] | null;
    }>(
      `select p.proname, p.prosecdef, p.proconfig
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'current_player_id',
           'is_night_host',
           'resolve_question',
           'resolve_question_if_all_locked',
           'reset_night_to_setup',
           'swap_point_value'
         )
       order by p.proname`,
    );

    expect(functions.rows.map((fn) => fn.proname)).toEqual([
      "current_player_id",
      "is_night_host",
      "reset_night_to_setup",
      "resolve_question",
      "resolve_question_if_all_locked",
      "swap_point_value",
    ]);
    for (const fn of functions.rows) {
      expect(fn.prosecdef, fn.proname).toBe(true);
      expect(fn.proconfig ?? [], fn.proname).toContain("search_path=pg_catalog, public");
    }
  });

  test("preserves service-role answer, participation, and live-function behavior", async () => {
    const serviceRoster = await runAsServiceRole(
      "select id, device_id from public.players where id = $1",
      [victimPlayerId],
    );
    expect(serviceRoster.rows).toEqual([
      { id: victimPlayerId, device_id: forgedVictimDeviceId },
    ]);

    const serviceParticipation = await runAsServiceRole(
      "select game_id, player_id from public.game_participations where player_id = $1",
      [attackerPlayerId],
    );
    expect(serviceParticipation.rows).toEqual([
      { game_id: gameForParticipationId, player_id: attackerPlayerId },
    ]);

    const answer = await runAsServiceRole(
      `insert into public.answers (question_id, player_id, chosen_index, scramble, ms_to_lock)
       values ($1, $2, 1, '[0,1,2,3]'::jsonb, 800)
       returning chosen_index`,
      [liveQuestionForInsertId, attackerPlayerId],
    );
    expect(answer.rows).toEqual([{ chosen_index: 1 }]);

    const participation = await runAsServiceRole(
      `insert into public.game_participations (game_id, player_id)
       values ($1, $2)
       returning player_id`,
      [gameForParticipationId, victimPlayerId],
    );
    expect(participation.rows).toEqual([{ player_id: victimPlayerId }]);

    const guarded = await runAsServiceRole(
      "select public.resolve_question_if_all_locked($1) as resolved",
      [liveQuestionWithAnswerId],
    );
    expect(guarded.rows).toEqual([{ resolved: false }]);

    await runAsServiceRole("select public.resolve_question($1)", [liveQuestionWithAnswerId]);
    const resolved = await db.query<{ finished_at: string | null; awarded_points: number | null }>(
      `select q.finished_at, a.awarded_points
       from public.questions q
       join public.answers a on a.question_id = q.id
       where q.id = $1`,
      [liveQuestionWithAnswerId],
    );
    expect(resolved.rows[0].finished_at).not.toBeNull();
    expect(resolved.rows[0].awarded_points).toBe(110);

    await runAsServiceRole("select public.swap_point_value($1, $2)", [liveQuestionForInsertId, 100]);
    const swapped = await db.query<{ id: string; point_value: number }>(
      `select id, point_value
       from public.questions
       where id in ($1, $2)
       order by id`,
      [liveQuestionWithAnswerId, liveQuestionForInsertId],
    );
    expect(new Map(swapped.rows.map((row) => [row.id, row.point_value]))).toEqual(
      new Map([
        [liveQuestionWithAnswerId, 200],
        [liveQuestionForInsertId, 100],
      ]),
    );

    await runAsServiceRole(
      "insert into public.adjustments (player_id, game_id, delta, reason) values ($1, $2, 50, 'Test')",
      [victimPlayerId, gameId],
    );
    await runAsServiceRole(
      "update public.games set state = 'live', started_at = now() where id = $1",
      [gameId],
    );
    await runAsServiceRole(
      "update public.nights set opened_at = now() where id = $1",
      [nightId],
    );

    const reset = await runAsServiceRole(
      "select public.reset_night_to_setup($1) as result",
      [nightId],
    );
    expect(reset.rows).toEqual([
      {
        result: {
          wiped: { reveals: 1, answers: 2, finishedQuestions: 1, adjustments: 1 },
          kept: { categories: 1, pickedQuestions: 2, players: 2 },
        },
      },
    ]);

    const resetState = await db.query<{
      game_state: string;
      started_at: string | null;
      opened_at: string | null;
      answers: number;
      reveals: number;
      adjustments: number;
      played_questions: number;
    }>(
      `select g.state as game_state,
              g.started_at,
              n.opened_at,
              (select count(*)::int from public.answers) as answers,
              (select count(*)::int from public.reveals) as reveals,
              (select count(*)::int from public.adjustments) as adjustments,
              (select count(*)::int from public.questions where played_at is not null) as played_questions
       from public.games g
       join public.nights n on n.id = g.night_id
       where g.id = $1`,
      [gameId],
    );
    expect(resetState.rows).toEqual([
      {
        game_state: "ready",
        started_at: null,
        opened_at: null,
        answers: 0,
        reveals: 0,
        adjustments: 0,
        played_questions: 0,
      },
    ]);
  });
});
