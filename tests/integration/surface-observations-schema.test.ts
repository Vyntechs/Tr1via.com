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
  `);
  await db.exec(
    readFileSync(path.join(MIGRATIONS_DIR, "0028_surface_observations.sql"), "utf8"),
  );
  return db;
}

describe("surface_observations schema", () => {
  let db: PGlite;
  let nightId: string;

  beforeAll(async () => {
    db = await freshDb();
    const one = async <T>(sql: string, params: unknown[] = []) =>
      (await db.query<T>(sql, params)).rows[0];
    const id = async (sql: string, params: unknown[] = []) =>
      (await one<{ id: string }>(`${sql} returning id`, params)).id;

    const userId = await id("insert into auth.users default values");
    const hostId = await id(
      "insert into hosts (user_id, display_name) values ($1, 'Host')",
      [userId],
    );
    nightId = await id(
      "insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', 'SYNC01')",
      [hostId],
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  test("is RLS-protected and grants table access only to service_role", async () => {
    const table = await db.query<{ relrowsecurity: boolean }>(`
      select relrowsecurity
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = 'surface_observations'
    `);
    expect(table.rows[0]?.relrowsecurity).toBe(true);

    const grants = await db.query<{ grantee: string; privilege_type: string }>(`
      select grantee, privilege_type
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'surface_observations'
         and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
       order by grantee, privilege_type
    `);
    expect(
      grants.rows.filter((row) => row.grantee !== "service_role"),
    ).toEqual([]);
    expect(
      grants.rows.some(
        (row) =>
          row.grantee === "service_role" && row.privilege_type === "INSERT",
      ),
    ).toBe(true);
  });

  test.each(["anon", "authenticated"] as const)(
    "denies direct %s reads and writes",
    async (role) => {
      await db.exec(`set role ${role}`);
      try {
        await expect(
          db.query("select * from public.surface_observations"),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          db.query(
            `insert into public.surface_observations (
               night_id, surface_kind, subject_key, run_id,
               room_revision, control_revision, play_id
             ) values ($1, 'player', 'private-subject', $2, 1, 1, $3)`,
            [nightId, crypto.randomUUID(), crypto.randomUUID()],
          ),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await db.exec("reset role");
      }
    },
  );

  test("stores only delivery revisions and no answer, choice, player, or device fields", async () => {
    const columns = await db.query<{ column_name: string }>(`
      select column_name
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'surface_observations'
       order by ordinal_position
    `);

    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "night_id",
      "surface_kind",
      "subject_key",
      "run_id",
      "room_revision",
      "control_revision",
      "play_id",
      "observed_at",
    ]);
    expect(columns.rows.map((row) => row.column_name).join(" ")).not.toMatch(
      /answer|choice|player|device/i,
    );
  });

  test("has no answer ancestry and no trigger that can mutate game state", async () => {
    const foreignKeys = await db.query<{ referenced_table: string }>(`
      select target.relname as referenced_table
        from pg_catalog.pg_constraint constraint_row
        join pg_catalog.pg_class source on source.oid = constraint_row.conrelid
        join pg_catalog.pg_class target on target.oid = constraint_row.confrelid
       where constraint_row.contype = 'f'
         and source.oid = 'public.surface_observations'::regclass
    `);
    expect(foreignKeys.rows.map((row) => row.referenced_table)).toEqual(["nights"]);
    expect(
      foreignKeys.rows.some((row) => /answer/i.test(row.referenced_table)),
    ).toBe(false);

    const triggers = await db.query<{ trigger_name: string }>(`
      select trigger_name
        from information_schema.triggers
       where event_object_schema = 'public'
         and event_object_table = 'surface_observations'
    `);
    expect(triggers.rows).toEqual([]);
  });

  test("keeps one short-lived observation per surface subject and indexes expiry cleanup", async () => {
    const primaryKey = await db.query<{ definition: string }>(`
      select pg_catalog.pg_get_constraintdef(oid) as definition
        from pg_catalog.pg_constraint
       where conrelid = 'public.surface_observations'::regclass
         and contype = 'p'
    `);
    expect(primaryKey.rows[0]?.definition).toMatch(
      /primary key \(night_id, surface_kind, subject_key\)/i,
    );

    const indexes = await db.query<{ indexname: string; indexdef: string }>(`
      select indexname, indexdef
        from pg_catalog.pg_indexes
       where schemaname = 'public'
         and tablename = 'surface_observations'
    `);
    expect(indexes.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          indexname: "surface_observations_expiry_idx",
          indexdef: expect.stringMatching(/\(observed_at\)/i),
        }),
      ]),
    );
  });

  test("allows only service_role to purge observations past the fixed retention window", async () => {
    const grants = await db.query<{ grantee: string; privilege_type: string }>(`
      select grantee, privilege_type
        from information_schema.routine_privileges
       where routine_schema = 'public'
         and routine_name = 'cleanup_expired_surface_observations'
         and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
       order by grantee, privilege_type
    `);
    expect(grants.rows).toEqual([
      { grantee: "service_role", privilege_type: "EXECUTE" },
    ]);

    for (const role of ["anon", "authenticated"] as const) {
      await db.exec(`set role ${role}`);
      try {
        await expect(
          db.query("select public.cleanup_expired_surface_observations()"),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await db.exec("reset role");
      }
    }

    await db.query(
      `insert into public.surface_observations (
         night_id, surface_kind, subject_key, room_revision,
         control_revision, observed_at
       ) values
         ($1, 'player', 'expired', 1, 1, now() - interval '6 minutes'),
         ($1, 'player', 'fresh', 1, 1, now() - interval '4 minutes')`,
      [nightId],
    );

    await db.exec("set role service_role");
    try {
      const cleanup = await db.query<{ deleted_count: number }>(
        "select public.cleanup_expired_surface_observations() as deleted_count",
      );
      expect(Number(cleanup.rows[0]?.deleted_count)).toBe(1);
    } finally {
      await db.exec("reset role");
    }

    const remaining = await db.query<{ subject_key: string }>(`
      select subject_key
        from public.surface_observations
       where night_id = '${nightId}'::uuid
       order by subject_key
    `);
    expect(remaining.rows.map((row) => row.subject_key)).toEqual(["fresh"]);
  });

  test("locks cleanup search_path and limits its dependency to surface observations", async () => {
    const routine = await db.query<{ configuration: string[]; definition: string }>(`
      select coalesce(proconfig, array[]::text[]) as configuration,
             pg_catalog.pg_get_functiondef(p.oid) as definition
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = 'cleanup_expired_surface_observations'
    `);

    expect(routine.rows).toHaveLength(1);
    expect(routine.rows[0]?.configuration).toContain("search_path=\"\"");
    expect(routine.rows[0]?.definition).toMatch(
      /delete from public\.surface_observations/i,
    );
    expect(routine.rows[0]?.definition).not.toMatch(
      /\b(games?|answers?|questions?|scores?|reveals?|players?)\b/i,
    );
  });
});
