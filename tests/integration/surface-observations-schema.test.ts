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
  // 0028 runs after the live-answer migrations in production. Keep this
  // focused schema harness small while preserving the canonical columns its
  // atomic observation function validates.
  await db.exec(`
    alter table public.nights
      add column current_run_id uuid,
      add column room_revision bigint not null default 0,
      add column control_revision bigint not null default 0;
    create table public.question_plays (
      id uuid primary key default gen_random_uuid(),
      night_id uuid not null references public.nights(id) on delete cascade,
      run_id uuid not null,
      game_id uuid not null references public.games(id) on delete cascade,
      status text not null default 'accepting',
      opened_at timestamptz not null default now()
    );
  `);
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

  test("atomically rejects stale canonical input and rate-limits each opaque subject", async () => {
    const runId = crypto.randomUUID();
    const playId = crypto.randomUUID();
    const game = await db.query<{ id: string }>(
      `insert into public.games (night_id, game_no, state)
       values ($1, 1, 'live') returning id`,
      [nightId],
    );
    const gameId = game.rows[0]!.id;
    await db.query(
      `update public.nights
          set current_run_id = $2, room_revision = 9, control_revision = 4
        where id = $1`,
      [nightId, runId],
    );
    await db.query(
      `insert into public.question_plays (id, night_id, run_id, game_id)
       values ($1, $2, $3, $4)`,
      [playId, nightId, runId, gameId],
    );

    await db.exec("set role service_role");
    try {
      const observe = (roomRevision: number, controlRevision: number) =>
        db.query<{ result: string }>(
          `select public.observe_surface_delivery(
             $1, 'player', 'opaque-player-key', $2, $3, $4, $5
           ) as result`,
          [nightId, runId, roomRevision, controlRevision, playId],
        );

      expect((await observe(9, 4)).rows[0]?.result).toBe("accepted");
      expect((await observe(9, 4)).rows[0]?.result).toBe("rate_limited");
      expect((await observe(8, 3)).rows[0]?.result).toBe("mismatch");

      await db.query(
        `update public.nights
            set room_revision = 10, control_revision = 5
          where id = $1`,
        [nightId],
      );
      expect((await observe(10, 5)).rows[0]?.result).toBe("accepted");
      expect((await observe(9, 4)).rows[0]?.result).toBe("mismatch");
    } finally {
      await db.exec("reset role");
    }

    const stored = await db.query<{
      room_revision: number;
      control_revision: number;
    }>(
      `select room_revision, control_revision
         from public.surface_observations
        where night_id = $1 and subject_key = 'opaque-player-key'`,
      [nightId],
    );
    expect(stored.rows).toEqual([{ room_revision: 10, control_revision: 5 }]);
  });

  test("serializes simultaneous first observations for one opaque subject", async () => {
    const runId = crypto.randomUUID();
    await db.query<{ id: string }>(
      `insert into public.games (night_id, game_no, state)
       values ($1, 2, 'live') returning id`,
      [nightId],
    );
    await db.query(
      `update public.nights set current_run_id = $2, room_revision = 20, control_revision = 10 where id = $1`,
      [nightId, runId],
    );

    const calls = Array.from({ length: 8 }, () =>
      db.query<{ result: string }>(
        `select public.observe_surface_delivery($1, 'player', 'simultaneous-player-key', $2, 20, 10, null) as result`,
        [nightId, runId],
      ),
    );
    const results = (await Promise.all(calls)).map((result) => result.rows[0]?.result);
    expect(results.filter((value) => value === "accepted")).toHaveLength(1);
    expect(results.filter((value) => value === "rate_limited")).toHaveLength(7);

    const routine = await db.query<{ definition: string }>(`
      select pg_catalog.pg_get_functiondef(p.oid) as definition
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'observe_surface_delivery'
    `);
    expect(routine.rows[0]?.definition).toMatch(/pg_advisory_xact_lock/i);
  });

  test("accepts null play only outside live play and rejects a prior game's play", async () => {
    await db.query(`delete from public.surface_observations where night_id = $1`, [nightId]);
    await db.query(`delete from public.games where night_id = $1`, [nightId]);
    const runId = crypto.randomUUID();
    const games = await db.query<{ id: string; game_no: number }>(
      `insert into public.games (night_id, game_no, state) values
         ($1, 1, 'done'), ($1, 2, 'ready') returning id, game_no`,
      [nightId],
    );
    const game1 = games.rows.find((row) => row.game_no === 1)!.id;
    const game2 = games.rows.find((row) => row.game_no === 2)!.id;
    const oldPlay = crypto.randomUUID();
    await db.query(
      `update public.nights set current_run_id = $2, room_revision = 30, control_revision = 12 where id = $1`,
      [nightId, runId],
    );
    await db.query(
      `insert into public.question_plays (id, night_id, run_id, game_id, status)
       values ($1, $2, $3, $4, 'resolved')`,
      [oldPlay, nightId, runId, game1],
    );
    const observe = (subject: string, playId: string | null) => db.query<{ result: string }>(
      `select public.observe_surface_delivery($1, 'player', $2, $3, 30, 12, $4) as result`,
      [nightId, subject, runId, playId],
    );

    expect((await observe("intermission-null-key", null)).rows[0]?.result).toBe("accepted");
    expect((await observe("intermission-old-key", oldPlay)).rows[0]?.result).toBe("mismatch");

    await db.query(`update public.games set state = 'live' where id = $1`, [game2]);
    const currentPlay = crypto.randomUUID();
    await db.query(
      `insert into public.question_plays (id, night_id, run_id, game_id)
       values ($1, $2, $3, $4)`,
      [currentPlay, nightId, runId, game2],
    );
    expect((await observe("live-current-key", currentPlay)).rows[0]?.result).toBe("accepted");
    expect((await observe("live-null-key-000", null)).rows[0]?.result).toBe("mismatch");

    await db.query(`update public.games set state = 'done' where id = $1`, [game2]);
    expect((await observe("finale-null-key-00", null)).rows[0]?.result).toBe("accepted");
    expect((await observe("finale-old-key-000", currentPlay)).rows[0]?.result).toBe("mismatch");
  });

  test("keeps a ready game on a null visible play even when the run has history", async () => {
    await db.query(`delete from public.surface_observations where night_id = $1`, [nightId]);
    await db.query(`delete from public.games where night_id = $1`, [nightId]);
    const runId = crypto.randomUUID();
    const game = await db.query<{ id: string }>(
      `insert into public.games (night_id, game_no, state)
       values ($1, 1, 'ready') returning id`,
      [nightId],
    );
    const oldPlay = crypto.randomUUID();
    await db.query(
      `update public.nights set current_run_id = $2, room_revision = 40, control_revision = 16 where id = $1`,
      [nightId, runId],
    );
    await db.query(
      `insert into public.question_plays (id, night_id, run_id, game_id, status)
       values ($1, $2, $3, $4, 'resolved')`,
      [oldPlay, nightId, runId, game.rows[0]!.id],
    );
    const observe = (subject: string, playId: string | null) => db.query<{ result: string }>(
      `select public.observe_surface_delivery($1, 'player', $2, $3, 40, 16, $4) as result`,
      [nightId, subject, runId, playId],
    );

    expect((await observe("ready-null-player", null)).rows[0]?.result).toBe("accepted");
    expect((await observe("ready-old-player-0", oldPlay)).rows[0]?.result).toBe("mismatch");
  });

  test("keeps the observation RPC service-only and mutation-isolated from game authority", async () => {
    const grants = await db.query<{ grantee: string; privilege_type: string }>(`
      select grantee, privilege_type
        from information_schema.routine_privileges
       where routine_schema = 'public'
         and routine_name = 'observe_surface_delivery'
         and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
       order by grantee, privilege_type
    `);
    expect(grants.rows).toEqual([
      { grantee: "service_role", privilege_type: "EXECUTE" },
    ]);

    const routine = await db.query<{ definition: string }>(`
      select pg_catalog.pg_get_functiondef(p.oid) as definition
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'observe_surface_delivery'
    `);
    const definition = routine.rows[0]?.definition ?? "";
    expect(definition).not.toMatch(
      /\b(insert into|update|delete from)\s+public\.(games?|answers?|scores?|questions?|question_plays|nights)\b/i,
    );
    expect(definition).toMatch(/insert into public\.surface_observations/i);
  });
});
