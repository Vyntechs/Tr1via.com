// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");

describe("legacy reset preserves its contract after resolution locking", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create schema auth;
      create schema extensions;
      create table auth.users (id uuid primary key default gen_random_uuid());
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);
    for (const migration of [
      "0001_init.sql", "0002_rls.sql", "0021_live_security_gate.sql",
      "20260902225149_resolve_question_once.sql",
      "20260907134447_serialize_legacy_reset_with_resolution.sql",
    ]) {
      await db.exec(readFileSync(path.join(migrationsDir, migration), "utf8"));
    }
    await db.exec("grant usage on schema public to service_role;");
  });

  afterAll(async () => { await db?.close(); });

  async function resetAsServiceRole(nightId: string) {
    await db.exec("set role service_role;");
    try {
      return (await db.query<{ result: unknown }>(
        "select public.reset_night_to_setup($1) as result", [nightId],
      )).rows[0].result;
    } finally { await db.exec("reset role;"); }
  }

  test.each(["live", "done"] as const)("clears a %s game's results, preserves the board and roster, and is idempotent", async (state) => {
    const id = async (sql: string, args: unknown[] = []) =>
      (await db.query<{ id: string }>(sql, args)).rows[0].id;
    const userId = await id("insert into auth.users default values returning id");
    const hostId = await id("insert into hosts (user_id, display_name) values ($1, 'Host') returning id", [userId]);
    const nightId = await id(
      "insert into nights (host_id, venue_name, room_code, opened_at) values ($1, 'Venue', $2, now()) returning id",
      [hostId, crypto.randomUUID()],
    );
    const gameId = await id(
      "insert into games (night_id, game_no, state, started_at, ended_at) values ($1, 1, $2, now(), now()) returning id",
      [nightId, state],
    );
    const readyGameId = await id("insert into games (night_id, game_no, state) values ($1, 2, 'ready') returning id", [nightId]);
    const categoryId = await id(
      "insert into categories (game_id, name, topic, position) values ($1, 'Category', 'Topic', 0) returning id", [gameId],
    );
    const questionId = await id(`
      insert into questions (category_id, point_value, prompt, options, correct_index, is_picked, played_at, fact_blurb)
      values ($1, 100, 'Keep this prompt?', '["A","B","C","D"]', 0, true, now() - interval '31 seconds', 'Keep this fact') returning id
    `, [categoryId]);
    await db.query(`
      insert into questions (category_id, prompt, options, correct_index)
      values ($1, 'Keep this unpicked candidate?', '["A","B","C","D"]', 1)
    `, [categoryId]);
    const playerId = await id(
      "insert into players (night_id, device_id, display_name) values ($1, gen_random_uuid(), 'Player') returning id", [nightId],
    );
    await db.query("insert into game_participations (game_id, player_id) values ($1, $2)", [gameId, playerId]);
    await db.query(`
      insert into answers (question_id, player_id, chosen_index, scramble, ms_to_lock)
      values ($1, $2, 0, '[0,1,2,3]', 4999)
    `, [questionId, playerId]);
    await db.query("insert into reveals (game_id, question_id, event) values ($1, $2, 'reveal')", [gameId, questionId]);
    await db.query("select public.resolve_question_once($1)", [questionId]);
    await db.query(
      "insert into adjustments (player_id, game_id, delta) values ($1, $2, 25), ($1, $3, 10)",
      [playerId, gameId, readyGameId],
    );
    const boardSql = "select to_jsonb(q) - array['played_at', 'finished_at'] as content from questions q where category_id = $1 order by id";
    const originalBoard = (await db.query(boardSql, [categoryId])).rows;

    expect(await resetAsServiceRole(nightId)).toEqual({
      wiped: { reveals: 2, answers: 1, finishedQuestions: 1, adjustments: 1 },
      kept: { categories: 1, pickedQuestions: 1, players: 1 },
    });
    expect((await db.query(boardSql, [categoryId])).rows).toEqual(originalBoard);
    expect((await db.query(`
      select g.state, g.started_at, g.ended_at, n.opened_at,
             q.played_at, q.finished_at,
             (select count(*)::int from reveals where game_id = g.id) as reveals,
             (select count(*)::int from answers where question_id = q.id) as answers,
             (select count(*)::int from game_participations where game_id = g.id) as participations
      from games g join nights n on n.id = g.night_id
      join categories c on c.game_id = g.id join questions q on q.category_id = c.id
      where q.id = $1
    `, [questionId])).rows[0]).toEqual({
      state: "ready", started_at: null, ended_at: null, opened_at: null,
      played_at: null, finished_at: null, reveals: 0, answers: 0, participations: 1,
    });
    expect((await db.query("select game_id, delta from adjustments where player_id = $1", [playerId])).rows)
      .toEqual([{ game_id: readyGameId, delta: 10 }]);
    expect(await resetAsServiceRole(nightId)).toEqual({
      wiped: { reveals: 0, answers: 0, finishedQuestions: 0, adjustments: 0 },
      kept: { categories: 1, pickedQuestions: 1, players: 1 },
    });
  });

  test("denies reset to anonymous and authenticated browser roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role};`);
      try {
        await expect(db.query("select public.reset_night_to_setup($1)", [crypto.randomUUID()]))
          .rejects.toThrow(/permission denied/i);
      } finally { await db.exec("reset role;"); }
    }
  });
});
