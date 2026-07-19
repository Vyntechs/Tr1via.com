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
const SCHEMA_MIGRATION = path.join(MIGRATIONS_DIR, "0022_live_answer_engine_schema.sql");
const FUNCTIONS_MIGRATION = path.join(MIGRATIONS_DIR, "0023_live_answer_engine_functions.sql");
const hasSchemaMigration = existsSync(SCHEMA_MIGRATION);
const hasFunctionsMigration = existsSync(FUNCTIONS_MIGRATION);

const SERVER_ONLY_TABLES = [
  "host_answer_engine_settings",
  "live_command_receipts",
  "question_plays",
  "question_play_eligibility",
  "question_play_answers",
  "question_play_attempt_windows",
  "play_finalize_attempt_windows",
  "live_room_events",
] as const;

const ENGINE_RPCS = [
  "begin_question_play_final_window",
  "end_live_game",
  "finalize_current_play_if_due",
  "open_night_run",
  "open_question_play",
  "start_live_game",
  "submit_question_play_answer",
  "undo_question_play",
] as const;

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
    create publication supabase_realtime;
  `);

  await db.exec(readFileSync(path.join(MIGRATIONS_DIR, "0001_init.sql"), "utf8"));
  await db.exec(`
    grant usage on schema public to anon, authenticated, service_role;
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    grant all on all tables in schema public to service_role;
    grant execute on all functions in schema public to anon, authenticated, service_role;
  `);
  await db.exec(readFileSync(path.join(MIGRATIONS_DIR, "0002_rls.sql"), "utf8"));
  await db.exec(readFileSync(path.join(MIGRATIONS_DIR, "0021_live_security_gate.sql"), "utf8"));

  for (const migration of [SCHEMA_MIGRATION, FUNCTIONS_MIGRATION]) {
    if (existsSync(migration)) await db.exec(readFileSync(migration, "utf8"));
  }
  return db;
}

describe("authoritative live answer engine schema", () => {
  test("requires migration 0022", () => {
    expect(hasSchemaMigration).toBe(true);
  });

  test("requires migration 0023", () => {
    expect(hasFunctionsMigration).toBe(true);
  });

  describe.skipIf(!hasSchemaMigration)("0022 schema contract", () => {
    let db: PGlite;

    beforeAll(async () => {
      db = await freshDb();
    });

    afterAll(async () => {
      await db?.close();
    });

    test("adds the immutable engine latch, run revisions, and answer eligibility columns", async () => {
      const columns = await db.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(`
        select table_name, column_name, data_type, is_nullable, column_default
          from information_schema.columns
         where table_schema = 'public'
           and (
             (table_name = 'players' and column_name = 'can_answer')
             or
             (table_name = 'nights' and column_name in (
               'answer_engine', 'answer_engine_latched_at', 'current_run_id',
               'room_revision', 'control_revision'
             ))
           )
         order by table_name, column_name
      `);

      expect(columns.rows).toEqual([
        expect.objectContaining({
          table_name: "nights",
          column_name: "answer_engine",
          data_type: "text",
          is_nullable: "NO",
          column_default: expect.stringContaining("legacy"),
        }),
        expect.objectContaining({
          table_name: "nights",
          column_name: "answer_engine_latched_at",
          data_type: "timestamp with time zone",
          is_nullable: "YES",
        }),
        expect.objectContaining({
          table_name: "nights",
          column_name: "control_revision",
          data_type: "bigint",
          is_nullable: "NO",
          column_default: expect.stringMatching(/^0/),
        }),
        expect.objectContaining({
          table_name: "nights",
          column_name: "current_run_id",
          data_type: "uuid",
          is_nullable: "YES",
        }),
        expect.objectContaining({
          table_name: "nights",
          column_name: "room_revision",
          data_type: "bigint",
          is_nullable: "NO",
          column_default: expect.stringMatching(/^0/),
        }),
        expect.objectContaining({
          table_name: "players",
          column_name: "can_answer",
          data_type: "boolean",
          is_nullable: "NO",
          column_default: "true",
        }),
      ]);
    });

    test("creates every server-owned engine table with RLS enabled", async () => {
      const tables = await db.query<{ relname: string; relrowsecurity: boolean }>(`
        select c.relname, c.relrowsecurity
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind = 'r'
           and c.relname = any($1::text[])
         order by c.relname
      `, [SERVER_ONLY_TABLES]);

      expect(tables.rows.map((row) => row.relname)).toEqual([...SERVER_ONLY_TABLES].sort());
      expect(tables.rows.every((row) => row.relrowsecurity)).toBe(true);
    });

    test("pins engine and play states to the supported values", async () => {
      const checks = await db.query<{ table_name: string; definition: string }>(`
        select c.relname as table_name, pg_catalog.pg_get_constraintdef(k.oid) as definition
          from pg_catalog.pg_constraint k
          join pg_catalog.pg_class c on c.oid = k.conrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and k.contype = 'c'
           and c.relname in ('nights', 'host_answer_engine_settings', 'question_plays')
      `);
      const definitions = checks.rows.map((row) => `${row.table_name} ${row.definition}`).join("\n");

      expect(definitions).toMatch(/nights[\s\S]*answer_engine[\s\S]*legacy[\s\S]*resilient_v1/i);
      expect(definitions).toMatch(/host_answer_engine_settings[\s\S]*preferred_engine[\s\S]*legacy[\s\S]*resilient_v1/i);
      for (const state of ["accepting", "all_in_hold", "final_window", "resolved", "undone"]) {
        expect(definitions).toContain(state);
      }
    });

    test("allows only one unfinished play and one non-undone play per run and question", async () => {
      const indexes = await db.query<{ indexdef: string }>(`
        select indexdef
          from pg_catalog.pg_indexes
         where schemaname = 'public' and tablename = 'question_plays'
      `);
      const definitions = indexes.rows.map((row) => row.indexdef.toLowerCase());

      expect(definitions.some((definition) =>
        definition.includes("unique")
        && definition.includes("run_id")
        && definition.includes("where")
        && ["accepting", "all_in_hold", "final_window"].every((state) => definition.includes(state)),
      )).toBe(true);
      expect(definitions.some((definition) =>
        definition.includes("unique")
        && definition.includes("run_id")
        && definition.includes("question_id")
        && definition.includes("where")
        && definition.includes("undone"),
      )).toBe(true);
    });

    test("prevents an answer unless the player belongs to that play's frozen eligibility set", async () => {
      const foreignKeys = await db.query<{ definition: string }>(`
        select pg_catalog.pg_get_constraintdef(k.oid) as definition
          from pg_catalog.pg_constraint k
          join pg_catalog.pg_class c on c.oid = k.conrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relname = 'question_play_answers'
           and k.contype = 'f'
      `);
      const normalized = foreignKeys.rows
        .map((row) => row.definition.replace(/\s+/g, " ").toLowerCase())
        .join("\n");

      expect(normalized).toMatch(
        /foreign key \(play_id, player_id\) references question_play_eligibility\(play_id, player_id\)/,
      );
    });

    test("grants every engine table only to service_role", async () => {
      const grants = await db.query<{
        table_name: string;
        grantee: string;
        privilege_type: string;
      }>(`
        select table_name, grantee, privilege_type
          from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name = any($1::text[])
      `, [SERVER_ONLY_TABLES]);

      for (const table of SERVER_ONLY_TABLES) {
        const tableGrants = grants.rows.filter((row) => row.table_name === table);
        expect(tableGrants.some((row) => row.grantee === "service_role")).toBe(true);
        expect(
          tableGrants.filter((row) => ["PUBLIC", "anon", "authenticated"].includes(row.grantee)),
        ).toEqual([]);
      }
    });

    test.each(["anon", "authenticated"])("denies raw %s writes to every engine table", async (role) => {
      await db.exec(`set role ${role}`);
      try {
        for (const table of SERVER_ONLY_TABLES) {
          await expect(db.query(`insert into public.${table} default values`)).rejects.toThrow(
            /permission denied/i,
          );
        }
      } finally {
        await db.exec("reset role");
      }
    });
  });

  describe.skipIf(!hasSchemaMigration || !hasFunctionsMigration)("0023 RPC privilege contract", () => {
    let db: PGlite;

    beforeAll(async () => {
      db = await freshDb();
    });

    afterAll(async () => {
      await db?.close();
    });

    test("grants authoritative mutation RPCs only to service_role", async () => {
      const grants = await db.query<{ routine_name: string; grantee: string; privilege_type: string }>(`
        select routine_name, grantee, privilege_type
          from information_schema.routine_privileges
         where routine_schema = 'public'
           and routine_name = any($1::text[])
      `, [ENGINE_RPCS]);

      for (const routine of ENGINE_RPCS) {
        const routineGrants = grants.rows.filter((row) => row.routine_name === routine);
        expect(routineGrants.filter((row) => row.grantee === "service_role")).toEqual([
          expect.objectContaining({ privilege_type: "EXECUTE" }),
        ]);
        expect(
          routineGrants.filter((row) => ["PUBLIC", "anon", "authenticated"].includes(row.grantee)),
        ).toEqual([]);
      }
    });

    test.each(["anon", "authenticated"])("denies direct %s RPC execution", async (role) => {
      const calls = [
        "select public.open_night_run(null::uuid, null::uuid, null::uuid, 0::bigint)",
        "select public.start_live_game(null::uuid, null::uuid, null::uuid, 0::bigint)",
        "select public.open_question_play(null::uuid, null::uuid, null::uuid, null::uuid, 0::bigint)",
        "select public.submit_question_play_answer(null::uuid, null::uuid, null::uuid, null::uuid, 1::smallint)",
        "select public.begin_question_play_final_window(null::uuid, null::uuid, null::uuid, null::uuid, 0::bigint)",
        "select public.finalize_current_play_if_due(null::text, null::uuid, null::uuid)",
        "select public.undo_question_play(null::uuid, null::uuid, null::uuid, null::uuid, 0::bigint)",
        "select public.end_live_game(null::uuid, null::uuid, null::uuid, 0::bigint)",
      ];

      await db.exec(`set role ${role}`);
      try {
        for (const sql of calls) {
          await expect(db.query(sql)).rejects.toThrow(/permission denied/i);
        }
      } finally {
        await db.exec("reset role");
      }
    });
  });
});
