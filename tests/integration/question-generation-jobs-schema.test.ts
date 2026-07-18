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
const MIGRATION_PATH = path.join(
  MIGRATIONS_DIR,
  "0019_question_generation_jobs.sql",
);
const migrationSql = existsSync(MIGRATION_PATH)
  ? readFileSync(MIGRATION_PATH, "utf8")
  : "";

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
  `);
  await db.exec(migrationSql);
  return db;
}

describe("question_generation_jobs schema", () => {
  let db: PGlite | null = null;
  let ownerUserId = "";
  let nonOwnerUserId = "";
  let jobId = "";

  async function runAs(
    role: "anon" | "authenticated",
    authUid: string | null,
    sql: string,
  ) {
    if (!db) throw new Error("generation-job migration missing");
    await db.exec(`select set_config('test.auth_uid', '${authUid ?? ""}', false);`);
    await db.exec(`set role ${role};`);
    try {
      return await db.query(sql);
    } finally {
      await db.exec(`reset role; select set_config('test.auth_uid', '', false);`);
    }
  }

  beforeAll(async () => {
    if (!migrationSql) return;
    db = await freshDb();
    const one = async <T>(sql: string, params: unknown[] = []) =>
      (await db!.query<T>(sql, params)).rows[0];
    const id = async (sql: string, params: unknown[] = []) =>
      (await one<{ id: string }>(`${sql} returning id`, params)).id;

    ownerUserId = (
      await one<{ id: string }>("insert into auth.users default values returning id")
    ).id;
    nonOwnerUserId = (
      await one<{ id: string }>("insert into auth.users default values returning id")
    ).id;
    const hostId = await id(
      "insert into hosts (user_id, display_name) values ($1, 'Heather')",
      [ownerUserId],
    );
    const nightId = await id(
      "insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', 'ROOM01')",
      [hostId],
    );
    const gameId = await id(
      "insert into games (night_id, game_no) values ($1, 1)",
      [nightId],
    );
    const categoryId = await id(
      "insert into categories (game_id, name, topic, position) values ($1, 'Cat', 'Topic', 0)",
      [gameId],
    );
    jobId = await id(
      `insert into question_generation_jobs (
        category_id, game_id, night_id, host_id, phase, target_count
      ) values ($1, $2, $3, $4, 'queued', 20)`,
      [categoryId, gameId, nightId, hostId],
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  test("the additive migration exists", () => {
    expect(migrationSql).toContain("create table question_generation_jobs");
  });

  test("the table enables RLS and defaults real progress counts to zero", async () => {
    expect(db).not.toBeNull();
    if (!db) return;
    const rls = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname = 'question_generation_jobs'",
    );
    expect(rls.rows[0]?.relrowsecurity).toBe(true);

    const row = await db.query<{
      written_count: number;
      certified_count: number;
      image_count: number;
      attempt: number;
    }>(
      "select written_count, certified_count, image_count, attempt from question_generation_jobs where id = $1",
      [jobId],
    );
    expect(row.rows[0]).toEqual({
      written_count: 0,
      certified_count: 0,
      image_count: 0,
      attempt: 1,
    });
  });

  test("only one current job can exist per category", async () => {
    expect(db).not.toBeNull();
    if (!db) return;
    const ids = await db.query<{ category_id: string; game_id: string; night_id: string; host_id: string }>(
      "select category_id, game_id, night_id, host_id from question_generation_jobs where id = $1",
      [jobId],
    );
    const row = ids.rows[0]!;
    await expect(
      db.query(
        `insert into question_generation_jobs (
          category_id, game_id, night_id, host_id, phase, target_count
        ) values ($1, $2, $3, $4, 'queued', 20)`,
        [row.category_id, row.game_id, row.night_id, row.host_id],
      ),
    ).rejects.toThrow(/unique|duplicate key/i);
  });

  test("the owning authenticated host can read progress and a non-owner cannot", async () => {
    expect(db).not.toBeNull();
    if (!db) return;
    const owner = await runAs(
      "authenticated",
      ownerUserId,
      `select id from question_generation_jobs where id = '${jobId}'`,
    );
    expect(owner.rows).toHaveLength(1);

    const nonOwner = await runAs(
      "authenticated",
      nonOwnerUserId,
      `select id from question_generation_jobs where id = '${jobId}'`,
    );
    expect(nonOwner.rows).toHaveLength(0);
  });

  test("anon cannot read jobs and authenticated clients cannot write them", async () => {
    expect(db).not.toBeNull();
    if (!db) return;
    await expect(
      runAs("anon", null, "select id from question_generation_jobs"),
    ).rejects.toThrow(/permission denied|violates row-level security/i);

    const grants = await db.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type
       from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'question_generation_jobs'
         and grantee in ('anon', 'authenticated', 'service_role')
       order by grantee, privilege_type`,
    );
    const authGrants = grants.rows
      .filter((row) => row.grantee === "authenticated")
      .map((row) => row.privilege_type);
    expect(authGrants).toEqual(["SELECT"]);
    expect(
      grants.rows.some(
        (row) => row.grantee === "service_role" && row.privilege_type === "INSERT",
      ),
    ).toBe(true);
  });
});
