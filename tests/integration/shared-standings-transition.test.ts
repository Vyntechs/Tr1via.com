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
    const user = await db.query<{ id: string }>("insert into auth.users default values returning id");
    const host = await db.query<{ id: string }>(
      "insert into hosts (user_id, display_name) values ($1, 'Heather') returning id",
      [user.rows[0].id],
    );
    const night = await db.query<{ id: string }>(
      "insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', 'SCORE1') returning id",
      [host.rows[0].id],
    );
    const game = await db.query<{ id: string }>(
      "insert into games (night_id, game_no, state) values ($1, 1, 'live') returning id",
      [night.rows[0].id],
    );
    const category = await db.query<{ id: string }>(
      "insert into categories (game_id, name, topic, position, state) values ($1, 'Tea', 'Tea', 1, 'ready') returning id",
      [game.rows[0].id],
    );
    const question = await db.query<{ id: string }>(
      `insert into questions
        (category_id, difficulty, prompt, options, correct_index, source, is_picked, point_value, played_at, finished_at)
       values ($1, 1, 'Question', '["A","B","C","D"]'::jsonb, 0, 'host-edit', true, 100, now(), now())
       returning id`,
      [category.rows[0].id],
    );

    const first = await db.query<{ applied: boolean }>(
      "select record_standings_advance($1, $2, $3, now()) as applied",
      [game.rows[0].id, question.rows[0].id, "2026-07-23T01:00:00.000Z"],
    );
    const repeated = await db.query<{ applied: boolean }>(
      "select record_standings_advance($1, $2, $3, now()) as applied",
      [game.rows[0].id, question.rows[0].id, "2026-07-23T01:00:00.000Z"],
    );

    expect(first.rows[0].applied).toBe(true);
    expect(repeated.rows[0].applied).toBe(false);

    await db.query(
      "insert into reveals (game_id, question_id, event) values ($1, $2, 'undo'), ($1, $2, 'reveal'), ($1, $2, 'resolve')",
      [game.rows[0].id, question.rows[0].id],
    );
    const replay = await db.query<{ applied: boolean }>(
      "select record_standings_advance($1, $2, $3, now()) as applied",
      [game.rows[0].id, question.rows[0].id, "2026-07-23T01:02:00.000Z"],
    );
    expect(replay.rows[0].applied).toBe(true);

    const events = await db.query<{ count: number }>(
      "select count(*)::int as count from reveals where game_id=$1 and question_id=$2 and event='advance'",
      [game.rows[0].id, question.rows[0].id],
    );
    expect(events.rows[0].count).toBe(2);
  });
});
