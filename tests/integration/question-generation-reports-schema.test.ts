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

async function freshDb(): Promise<PGlite> {
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
  await db.exec(readFileSync(path.join(MIGRATIONS_DIR, "0001_init.sql"), "utf8"));
  await db.exec(`
    grant usage on schema public to anon, authenticated, service_role;
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    grant all on all tables in schema public to service_role;
    grant execute on all functions in schema public to anon, authenticated, service_role;
  `);
  await db.exec(readFileSync(path.join(MIGRATIONS_DIR, "0015_question_generation_reports.sql"), "utf8"));
  return db;
}

describe("question_generation_reports schema", () => {
  let db: PGlite;
  let hostUserId: string;
  let nonOwnerUserId: string;
  let reportId: string;

  async function runAs(role: "anon" | "authenticated", authUid: string | null, sql: string) {
    await db.exec(`select set_config('test.auth_uid', '${authUid ?? ""}', false);`);
    await db.exec(`set role ${role};`);
    try {
      return await db.query(sql);
    } finally {
      await db.exec(`reset role; select set_config('test.auth_uid', '', false);`);
    }
  }

  beforeAll(async () => {
    db = await freshDb();
    const one = async <T>(sql: string, params: unknown[] = []) =>
      (await db.query<T>(sql, params)).rows[0];
    const id = async (sql: string, params: unknown[] = []) =>
      (await one<{ id: string }>(sql + " returning id", params)).id;

    hostUserId = (await one<{ id: string }>("insert into auth.users default values returning id")).id;
    nonOwnerUserId = (await one<{ id: string }>("insert into auth.users default values returning id")).id;
    const hostId = await id("insert into hosts (user_id, display_name) values ($1, 'Host')", [hostUserId]);
    const nightId = await id("insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', 'ROOM01')", [hostId]);
    const gameId = await id("insert into games (night_id, game_no) values ($1, 1)", [nightId]);
    const categoryId = await id("insert into categories (game_id, name, topic, position) values ($1, 'Cat', 'Topic', 0)", [gameId]);

    reportId = await id(
      `insert into question_generation_reports (
         category_id, game_id, night_id, host_id, category_name, topic, mode, status,
         requested_count, accepted_count, generated_count, rejected_count, rounds,
         verify_passes, llm_calls, tokens_in, tokens_out, estimated_cost_usd,
         image_target_count, image_attached_count, image_skipped_count,
         risk_flag_count, report
       ) values (
         $1, $2, $3, $4, 'Cat', 'Topic', 'initial', 'completed',
         20, 20, 22, 2, 2, 2, 4, 100, 50, 0.1234,
         20, 18, 2, 3, '{"reasonCounts":{}}'::jsonb
       )`,
      [categoryId, gameId, nightId, hostId],
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  test("the additive report table exists with RLS enabled", async () => {
    const r = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname = 'question_generation_reports'",
    );
    expect(r.rows[0]?.relrowsecurity).toBe(true);
  });

  test("the owning authenticated host can read the report", async () => {
    const r = await runAs(
      "authenticated",
      hostUserId,
      `select id from question_generation_reports where id = '${reportId}'`,
    );
    expect(r.rows).toHaveLength(1);
  });

  test("an authenticated non-owner cannot read another host's report", async () => {
    const r = await runAs(
      "authenticated",
      nonOwnerUserId,
      `select id from question_generation_reports where id = '${reportId}'`,
    );
    expect(r.rows).toHaveLength(0);
  });

  test("anon cannot read reports", async () => {
    await expect(
      runAs("anon", null, "select id from question_generation_reports"),
    ).rejects.toThrow(/permission denied|violates row-level security/i);
  });
});
