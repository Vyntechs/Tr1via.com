// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);

async function seedResolvedQuestion(db: PGlite, roomCode: string) {
  const user = await db.query<{ id: string }>("insert into auth.users default values returning id");
  const host = await db.query<{ id: string }>(
    "insert into hosts (user_id, display_name) values ($1, 'Heather') returning id",
    [user.rows[0].id],
  );
  const night = await db.query<{ id: string }>(
    "insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', $2) returning id",
    [host.rows[0].id, roomCode],
  );
  const game = await db.query<{ id: string }>(
    "insert into games (night_id, game_no, state) values ($1, 1, 'live') returning id",
    [night.rows[0].id],
  );
  const category = await db.query<{ id: string }>(
    "insert into categories (game_id, name, topic, position, state) values ($1, 'Tea', 'Tea', 1, 'ready') returning id",
    [game.rows[0].id],
  );
  const finishedAt = "2026-07-23T01:00:00.000Z";
  const question = await db.query<{ id: string }>(
    `insert into questions
      (category_id, difficulty, prompt, options, correct_index, source, is_picked, point_value, played_at, finished_at)
     values ($1, 1, 'Question', '["A","B","C","D"]'::jsonb, 0, 'host-edit', true, 100,
             '2026-07-23T00:59:30.000Z'::timestamptz, $2::timestamptz)
     returning id`,
    [category.rows[0].id, finishedAt],
  );

  return {
    nightId: night.rows[0].id,
    gameId: game.rows[0].id,
    questionId: question.rows[0].id,
    finishedAt,
  };
}

describe("shared standings transition schema", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
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
    await db.exec(readFileSync(path.join(MIGRATIONS, "0001_init.sql"), "utf8"));
    await db.exec(readFileSync(path.join(MIGRATIONS, "0032_shared_standings_transition.sql"), "utf8"));
  });

  afterAll(async () => db.close());

  test("deduplicates repeat advance taps but permits a later replay cycle", async () => {
    const fixture = await seedResolvedQuestion(db, "SCORE1");

    const first = await db.query<{ applied: boolean }>(
      "select record_standings_advance($1, $2, $3, now()) as applied",
      [fixture.gameId, fixture.questionId, fixture.finishedAt],
    );
    const repeated = await db.query<{ applied: boolean }>(
      "select record_standings_advance($1, $2, $3, now()) as applied",
      [fixture.gameId, fixture.questionId, fixture.finishedAt],
    );

    expect(first.rows[0].applied).toBe(true);
    expect(repeated.rows[0].applied).toBe(false);

    await db.query(
      "insert into reveals (game_id, question_id, event) values ($1, $2, 'undo'), ($1, $2, 'reveal'), ($1, $2, 'resolve')",
      [fixture.gameId, fixture.questionId],
    );
    const replayFinishedAt = "2026-07-23T01:02:00.000Z";
    await db.query(
      "update questions set finished_at = $2::timestamptz where id = $1",
      [fixture.questionId, replayFinishedAt],
    );
    const replay = await db.query<{ applied: boolean }>(
      "select record_standings_advance($1, $2, $3, now()) as applied",
      [fixture.gameId, fixture.questionId, replayFinishedAt],
    );
    expect(replay.rows[0].applied).toBe(true);

    const events = await db.query<{ count: number }>(
      "select count(*)::int as count from reveals where game_id=$1 and question_id=$2 and event='advance'",
      [fixture.gameId, fixture.questionId],
    );
    expect(events.rows[0].count).toBe(2);
  });

  test("rejects a stale resolution timestamp without recording an advance", async () => {
    const fixture = await seedResolvedQuestion(db, "SCORE2");

    await expect(
      db.query("select record_standings_advance($1, $2, $3, now())", [
        fixture.gameId,
        fixture.questionId,
        "2026-07-23T00:58:00.000Z",
      ]),
    ).rejects.toThrow(/resolution.*stale/i);

    const events = await db.query<{ count: number }>(
      "select count(*)::int as count from reveals where question_id = $1 and event = 'advance'",
      [fixture.questionId],
    );
    expect(events.rows[0].count).toBe(0);
  });

  test("rejects a question belonging to a different game without recording an advance", async () => {
    const fixture = await seedResolvedQuestion(db, "SCORE3");
    const otherGame = await db.query<{ id: string }>(
      "insert into games (night_id, game_no, state) values ($1, 2, 'live') returning id",
      [fixture.nightId],
    );

    await expect(
      db.query("select record_standings_advance($1, $2, $3, now())", [
        otherGame.rows[0].id,
        fixture.questionId,
        fixture.finishedAt,
      ]),
    ).rejects.toThrow(/does not belong.*game/i);

    const events = await db.query<{ count: number }>(
      "select count(*)::int as count from reveals where question_id = $1 and event = 'advance'",
      [fixture.questionId],
    );
    expect(events.rows[0].count).toBe(0);
  });

  test("locks the canonical question row while validating its game and resolution", async () => {
    const functionDefinition = await db.query<{ definition: string }>(
      `select pg_get_functiondef(p.oid) as definition
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'record_standings_advance'`,
    );
    const definition = functionDefinition.rows[0]?.definition.toLowerCase() ?? "";
    const questionRead = definition.indexOf("from public.questions q");
    const categoryJoin = definition.indexOf("join public.categories c", questionRead);
    const gameMatch = definition.indexOf("c.game_id = p_game_id", categoryJoin);
    const questionLock = definition.indexOf("for update of q", gameMatch);
    const revealInsert = definition.indexOf("insert into public.reveals");

    expect(questionRead).toBeGreaterThan(-1);
    expect(categoryJoin).toBeGreaterThan(questionRead);
    expect(gameMatch).toBeGreaterThan(categoryJoin);
    expect(questionLock).toBeGreaterThan(gameMatch);
    expect(revealInsert).toBeGreaterThan(questionLock);
  });
});
