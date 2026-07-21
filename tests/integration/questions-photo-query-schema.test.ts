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
const PHOTO_QUERY_PATH = path.join(
  MIGRATIONS_DIR,
  "0030_questions_photo_query.sql",
);
const photoQuerySql = existsSync(PHOTO_QUERY_PATH)
  ? readFileSync(PHOTO_QUERY_PATH, "utf8")
  : "";

describe("question photo query persistence", () => {
  let db: PGlite | null = null;

  beforeAll(async () => {
    if (!photoQuerySql) return;
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
    for (const migration of [
      "0001_init.sql",
      "0015_question_generation_reports.sql",
      "0016_question_generation_reports_privileges.sql",
      "0019_question_generation_jobs.sql",
      "0020_question_generation_jobs_advisor_fixes.sql",
      "0029_generation_attempt_fencing.sql",
    ]) {
      await db.exec(readFileSync(path.join(MIGRATIONS_DIR, migration), "utf8"));
    }
    await db.exec(photoQuerySql);
  });

  afterAll(async () => {
    await db?.close();
  });

  test("the additive migration exists", () => {
    expect(photoQuerySql).not.toBe("");
  });

  test("stores a generated photo search phrase while legacy rows remain nullable", async () => {
    expect(db).not.toBeNull();
    if (!db) return;

    const user = await db.query<{ id: string }>(
      "insert into auth.users default values returning id",
    );
    const host = await db.query<{ id: string }>(
      "insert into hosts (user_id, display_name) values ($1, 'Heather') returning id",
      [user.rows[0]!.id],
    );
    const night = await db.query<{ id: string }>(
      "insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', 'PHOTO1') returning id",
      [host.rows[0]!.id],
    );
    const game = await db.query<{ id: string }>(
      "insert into games (night_id, game_no) values ($1, 1) returning id",
      [night.rows[0]!.id],
    );
    const category = await db.query<{ id: string }>(
      "insert into categories (game_id, name, topic, position) values ($1, 'Television', 'Television', 0) returning id",
      [game.rows[0]!.id],
    );

    await db.query(
      `insert into questions (
        category_id, prompt, options, correct_index, photo_query
      ) values
        ($1, 'Question with visual intent?', '["A","B","C","D"]', 0, $2),
        ($1, 'Legacy question without visual intent?', '["A","B","C","D"]', 0, null)`,
      [category.rows[0]!.id, "surveillance television studio"],
    );

    const rows = await db.query<{ prompt: string; photo_query: string | null }>(
      "select prompt, photo_query from questions where category_id = $1 order by prompt",
      [category.rows[0]!.id],
    );
    expect(rows.rows).toEqual([
      {
        prompt: "Legacy question without visual intent?",
        photo_query: null,
      },
      {
        prompt: "Question with visual intent?",
        photo_query: "surveillance television studio",
      },
    ]);
  });
});
