// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);
const MIGRATION = path.join(
  MIGRATIONS_DIR,
  "20260902225149_resolve_question_once.sql",
);

describe("resolve_question_once", () => {
  let db: PGlite;
  let questionId: string;

  beforeAll(async () => {
    db = new PGlite();
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
    `);
    await db.exec(
      readFileSync(path.join(MIGRATIONS_DIR, "0001_init.sql"), "utf8"),
    );
    await db.exec(`
      grant usage on schema public to service_role;
      grant all on all tables in schema public to service_role;
      grant execute on function public.resolve_question(uuid) to service_role;
    `);
    await db.exec(
      readFileSync(path.join(MIGRATIONS_DIR, "0002_rls.sql"), "utf8"),
    );
    await db.exec(
      readFileSync(
        path.join(MIGRATIONS_DIR, "0021_live_security_gate.sql"),
        "utf8",
      ),
    );
    await db.exec(readFileSync(MIGRATION, "utf8"));

    const user = await db.query<{ id: string }>(
      "insert into auth.users default values returning id",
    );
    const host = await db.query<{ id: string }>(
      "insert into hosts (user_id, display_name) values ($1, 'Host') returning id",
      [user.rows[0].id],
    );
    const night = await db.query<{ id: string }>(
      "insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', 'ONCE01') returning id",
      [host.rows[0].id],
    );
    const game = await db.query<{ id: string }>(
      "insert into games (night_id, game_no) values ($1, 1) returning id",
      [night.rows[0].id],
    );
    const category = await db.query<{ id: string }>(
      "insert into categories (game_id, name, topic, position) values ($1, 'Category', 'Topic', 0) returning id",
      [game.rows[0].id],
    );
    const question = await db.query<{ id: string }>(
      `insert into questions (
         category_id, point_value, prompt, options, correct_index, is_picked,
         played_at
       ) values (
         $1, 100, 'Prompt?', '["A","B","C","D"]'::jsonb, 0, true, now()
       ) returning id`,
      [category.rows[0].id],
    );
    questionId = question.rows[0].id;
  });

  afterAll(async () => {
    await db?.close();
  });

  async function resolveAsServiceRole() {
    await db.exec("set role service_role;");
    try {
      return await db.query<{ resolve_question_once: boolean }>(
        "select public.resolve_question_once($1)",
        [questionId],
      );
    } finally {
      await db.exec("reset role;");
    }
  }

  test("returns true once, false thereafter, and records one reveal", async () => {
    const first = await resolveAsServiceRole();
    const second = await resolveAsServiceRole();

    expect(first.rows[0].resolve_question_once).toBe(true);
    expect(second.rows[0].resolve_question_once).toBe(false);

    const question = await db.query<{ finished_at: string | null }>(
      "select finished_at from questions where id = $1",
      [questionId],
    );
    expect(question.rows[0].finished_at).not.toBeNull();

    const reveals = await db.query<{ count: number }>(
      "select count(*)::int as count from reveals where question_id = $1 and event = 'resolve'",
      [questionId],
    );
    expect(reveals.rows[0].count).toBe(1);
  });

  test("does not expose the race-winning RPC to player roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role};`);
      try {
        await expect(
          db.query("select public.resolve_question_once($1)", [questionId]),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await db.exec("reset role;");
      }
    }
  });
});
