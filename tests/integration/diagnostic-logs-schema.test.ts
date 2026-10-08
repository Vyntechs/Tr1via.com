// @vitest-environment node

// Migration 20261007180000_diagnostic_logs.sql on real Postgres (pglite).
// Proves: the tables and the functions are closed to the browser roles (RLS
// with no policies, no grants), the service role can write and read,
// constraints hold, there are no foreign keys, cleanup keeps 45 days, works in
// small batches and refuses a typo, the per-night row caps hold, the migration
// can be run twice (even over an older draft), the timeline never blocks a
// later change to the game's own tables, and every query documented in
// docs/diagnostics/night-timeline.md runs against a realistic night.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { DIAG_BUCKET_ROW_CAPS, DIAG_NIGHT_ROW_CAP, DIAG_NIGHT_SERVER_ROW_CAP } from "@/lib/diagnostics/config";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const DOCS = path.join(ROOT, "docs/diagnostics/night-timeline.md");
const TABLES = ["diag_answer_events", "diag_server_actions", "diag_device_events"] as const;
const LOCKED_TABLES = [...TABLES, "diag_quota"] as const;
const CLEANUP_FN = "public.cleanup_diagnostic_logs(integer, integer)";
const TAKE_ROWS_FN = "public.diag_take_rows(uuid, text, integer, integer, integer)";
const MIGRATION_FILE = "20261007180000_diagnostic_logs.sql";
const TIMELINE_FN = "public.diag_night_timeline(uuid, timestamptz, timestamptz)";

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
    grant usage on schema public to anon, authenticated, service_role;
  `);
  await db.exec(readFileSync(path.join(MIGRATIONS, "0001_init.sql"), "utf8"));
  // The service role can use every existing table, as on Supabase.
  await db.exec("grant all on all tables in schema public to service_role");
  // Supabase's default privileges hand new public tables and functions to the
  // browser roles; the migration must take them back.
  await db.exec(`
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  `);
  await db.exec(readFileSync(path.join(MIGRATIONS, MIGRATION_FILE), "utf8"));
  return db;
}

describe("diagnostic logs schema", () => {
  let db: PGlite;
  let nightId: string;
  let playerId: string;
  let deviceId: string;
  let gameId: string;
  let questionId: string;
  let quietPlayerId: string;
  let quietDeviceId: string;

  const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
  const id = async (sql: string, params: unknown[] = []) =>
    (await one<{ id: string }>(`${sql} returning id`, params)).id;

  beforeAll(async () => {
    db = await freshDb();
    const userId = await id("insert into auth.users default values");
    const hostId = await id("insert into hosts (user_id, display_name) values ($1, 'Host')", [userId]);
    nightId = await id(
      "insert into nights (host_id, venue_name, room_code) values ($1, 'Soul Fire', 'K9PR4M')",
      [hostId],
    );
    gameId = await id("insert into games (night_id, game_no) values ($1, 1)", [nightId]);
    const categoryId = await id(
      "insert into categories (game_id, name, topic, position) values ($1, 'Movies', 'movies', 0)",
      [gameId],
    );
    questionId = await id(
      `insert into questions (category_id, point_value, prompt, options, correct_index, played_at)
       values ($1, 100, 'Q?', '["a","b","c","d"]', 0, '2026-10-08T00:06:00Z')`,
      [categoryId],
    );
    deviceId = crypto.randomUUID();
    playerId = await id(
      "insert into players (night_id, device_id, display_name) values ($1, $2, 'Heather')",
      [nightId, deviceId],
    );
    quietDeviceId = crypto.randomUUID();
    quietPlayerId = await id(
      "insert into players (night_id, device_id, display_name) values ($1, $2, 'Quiet Quinn')",
      [nightId, quietDeviceId],
    );
    for (const p of [playerId, quietPlayerId]) {
      await db.query("insert into game_participations (game_id, player_id) values ($1, $2)", [gameId, p]);
    }
    await db.query(
      `insert into answers (question_id, player_id, chosen_index, scramble, locked_at, ms_to_lock)
       values ($1, $2, 0, '[0,1,2,3]', '2026-10-08T00:06:03Z', 3000)`,
      [questionId, playerId],
    );
    await db.query(
      "insert into reveals (game_id, question_id, event, occurred_at) values ($1, $2, 'reveal', '2026-10-08T00:06:00Z')",
      [gameId, questionId],
    );

    // Diagnostic rows (as the service role would write them).
    await db.exec("set role service_role");
    await db.query(
      `insert into diag_answer_events
         (received_at, engine, night_id, game_id, question_id, player_id, device_id, slot_chosen, chosen_index,
          client_tap_at, client_sent_at, client_attempt, question_played_at, ms_after_open, deadline_s,
          outcome, reason, http_status, total_ms, steps, cold_start)
       values
         ('2026-10-08T00:06:03.100Z', 'legacy', $1, $2, $3, $4, $5, 1, 0,
          '2026-10-08T00:06:03.000Z', '2026-10-08T00:06:03.050Z', 0, '2026-10-08T00:06:00Z', 3100, 25,
          'saved', 'saved', 204, 180, '{"question": 40, "insert": 160}', false),
         ('2026-10-08T00:06:27.000Z', 'legacy', $1, $2, $3, $6, $7, 2, null,
          '2026-10-08T00:06:21.000Z', '2026-10-08T00:06:26.800Z', 2, '2026-10-08T00:06:00Z', 27000, 25,
          'late', 'deadline_passed', 400, 90, '{"question": 30}', false)`,
      [nightId, gameId, questionId, playerId, deviceId, quietPlayerId, quietDeviceId],
    );
    await db.query(
      `insert into diag_server_actions
         (received_at, action, actor, night_id, game_id, question_id, http_status, outcome, reason,
          total_ms, auth_ms, db_done_ms, broadcast_start_ms, broadcast_done_ms, broadcast_ok, steps, cold_start)
       values
         ('2026-10-08T00:06:00.000Z', 'reveal', 'host', $1, $2, $3, 200, 'ok', 'ok',
          950, 420, 700, 700, 900, true, '{"auth_done": 400, "sent_reveal": 900}', true),
         ('2026-10-08T00:06:30.000Z', 'resolve', 'timer', $1, $2, $3, 200, 'already_resolved', 'ok',
          60, null, 55, null, null, null, '{}', false)`,
      [nightId, gameId, questionId],
    );
    await db.query(
      `insert into diag_device_events (night_id, surface, session_id, device_id, kind, device_at, at_est, offset_ms, forced, data)
       values
         ($1, 'player', 'sess-heather', $2, 'bcast', '2026-10-08T00:06:01Z', '2026-10-08T00:06:01.300Z', -1000, false, '{"ev": "reveal", "lag": 400}'),
         ($1, 'player', 'sess-heather', $2, 'ribbon', '2026-10-08T00:06:10Z', '2026-10-08T00:06:10.100Z', -1000, true,
            '{"from": "online", "to": "unreachable", "chan": "CLOSED", "reach": "unreachable", "ol": true}'),
         ($1, 'tv', 'sess-tv-0001', null, 'fps', '2026-10-08T00:06:12Z', '2026-10-08T00:06:12.100Z', 0, true, '{"scene": "october", "fps": 22}')`,
      [nightId, deviceId],
    );
    await db.exec("reset role");
  });

  afterAll(async () => {
    await db?.close();
  });

  test("RLS is on for every table, with no policies", async () => {
    for (const table of LOCKED_TABLES) {
      const rls = await one<{ relrowsecurity: boolean }>(
        `select relrowsecurity from pg_class where oid = 'public.${table}'::regclass`,
      );
      expect(rls.relrowsecurity).toBe(true);
      const policies = await one<{ n: number }>(
        `select count(*)::int as n from pg_policies where tablename = '${table}'`,
      );
      expect(policies.n).toBe(0);
    }
  });

  test("the browser roles have no rights on the tables or either function", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const table of LOCKED_TABLES) {
        const r = await one<{ s: boolean; i: boolean; d: boolean }>(
          `select has_table_privilege('${role}', 'public.${table}', 'select') as s,
                  has_table_privilege('${role}', 'public.${table}', 'insert') as i,
                  has_table_privilege('${role}', 'public.${table}', 'delete') as d`,
        );
        expect(r, `${role} on ${table}`).toEqual({ s: false, i: false, d: false });
      }
      for (const fn of [CLEANUP_FN, TAKE_ROWS_FN, TIMELINE_FN]) {
        const r = await one<{ x: boolean }>(`select has_function_privilege('${role}', '${fn}', 'execute') as x`);
        expect(r.x, `${role} may run ${fn}`).toBe(false);
      }
    }
    const service = await one<{ i: boolean; x: boolean; t: boolean; q: boolean }>(
      `select has_table_privilege('service_role', 'public.diag_device_events', 'insert') as i,
              has_function_privilege('service_role', '${TIMELINE_FN}', 'execute') as t,
              has_function_privilege('service_role', '${CLEANUP_FN}', 'execute') as x,
              has_function_privilege('service_role', '${TAKE_ROWS_FN}', 'execute') as q`,
    );
    expect(service).toEqual({ i: true, t: true, x: true, q: true });
  });

  test.each(["anon", "authenticated"] as const)("%s cannot read or write any diagnostic row", async (role) => {
    await db.exec(`set role ${role}`);
    try {
      for (const table of LOCKED_TABLES) {
        await expect(db.query(`select * from public.${table}`)).rejects.toThrow(/permission denied/i);
      }
      await expect(
        db.query("select * from public.diag_night_timeline($1)", [nightId]),
      ).rejects.toThrow(/permission denied/i);
      await expect(db.query("select public.cleanup_diagnostic_logs(45)")).rejects.toThrow(/permission denied/i);
      await expect(
        db.query("select public.diag_take_rows($1, 'tv', 5, 100, 100)", [nightId]),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.query(
          `insert into public.diag_device_events (surface, session_id, kind, device_at, at_est)
           values ('player', 'x-session-1', 'net', now(), now())`,
        ),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec("reset role");
    }
  });

  test("the timeline is a function that obeys the caller's rights, not a view", async () => {
    const fn = await one<{ prosecdef: boolean; provolatile: string }>(
      `select prosecdef, provolatile from pg_proc where oid = '${TIMELINE_FN}'::regprocedure`,
    );
    expect(fn.prosecdef).toBe(false); // security invoker
    expect(fn.provolatile).toBe("s"); // stable: read-only
    const view = await one<{ r: string | null }>("select to_regclass('public.diag_night_timeline')::text as r");
    expect(view.r).toBeNull();
  });

  test("the migration can be run twice: nothing breaks, nothing is lost, the locks stay", async () => {
    const before = await one<{ n: number }>("select count(*)::int as n from public.diag_answer_events");
    expect(before.n).toBeGreaterThan(0);
    await db.exec(readFileSync(path.join(MIGRATIONS, MIGRATION_FILE), "utf8"));
    const after = await one<{ n: number }>("select count(*)::int as n from public.diag_answer_events");
    expect(after.n).toBe(before.n);
    const policies = await one<{ n: number }>(
      "select count(*)::int as n from pg_policies where tablename like 'diag_%'",
    );
    expect(policies.n).toBe(0);
    const open = await one<{ x: boolean }>(
      `select has_function_privilege('anon', '${TIMELINE_FN}', 'execute')
           or has_table_privilege('authenticated', 'public.diag_device_events', 'select') as x`,
    );
    expect(open.x).toBe(false);
    // It also replaces an old draft that had the timeline as a view.
    await db.exec(`
      drop function ${TIMELINE_FN};
      create view public.diag_night_timeline as select 1 as night_id;
    `);
    await db.exec(readFileSync(path.join(MIGRATIONS, MIGRATION_FILE), "utf8"));
    const view = await one<{ r: string | null }>("select to_regclass('public.diag_night_timeline')::text as r");
    expect(view.r).toBeNull();
    const rows = await db.query("select * from public.diag_night_timeline($1)", [nightId]);
    expect(rows.rows.length).toBeGreaterThan(0);
  });

  test("the timeline does not block a later change to the game's own tables", async () => {
    // Control: a view over the same column DOES block the change...
    await db.exec("create view public.tmp_control_view as select locked_at from public.answers");
    await expect(
      db.exec("alter table public.answers alter column locked_at type timestamp"),
    ).rejects.toThrow(/used by a view or rule/i);
    await db.exec("drop view public.tmp_control_view");
    // ...but with only the timeline function in place, changing columns the
    // timeline reads goes through, and the function still runs afterwards.
    await db.exec("alter table public.answers alter column locked_at type timestamp");
    await db.exec("alter table public.reveals alter column occurred_at type timestamp");
    await db.exec("alter table public.answers alter column locked_at type timestamptz");
    await db.exec("alter table public.reveals alter column occurred_at type timestamptz");
    const rows = await db.query("select * from public.diag_night_timeline($1)", [nightId]);
    expect(rows.rows.length).toBeGreaterThan(0);
  });

  test("run over an older draft that had the one-argument cleanup function, it leaves exactly one cleanup function", async () => {
    await db.exec(`
      drop function ${CLEANUP_FN};
      create function public.cleanup_diagnostic_logs(p_days integer default 45) returns bigint
        language sql as $$ select 0::bigint $$;
    `);
    await db.exec(readFileSync(path.join(MIGRATIONS, MIGRATION_FILE), "utf8"));
    const fns = await db.query<{ args: string }>(
      `select pg_get_function_identity_arguments(oid) as args from pg_proc
        where proname = 'cleanup_diagnostic_logs' and pronamespace = 'public'::regnamespace`,
    );
    expect(fns.rows.map((r) => r.args)).toEqual(["p_days integer, p_batch integer"]);
    // and a call with just the day count still works, with no "is not unique" error
    await db.exec("set role service_role");
    try {
      await expect(db.query("select public.cleanup_diagnostic_logs(45)")).resolves.toBeDefined();
    } finally {
      await db.exec("reset role");
    }
  });

  test("has no foreign keys, so a reset or an unknown id never loses or blocks a row", async () => {
    const fks = await one<{ n: number }>(
      `select count(*)::int as n from pg_constraint
        where contype = 'f' and conrelid in (
          'public.diag_answer_events'::regclass, 'public.diag_server_actions'::regclass,
          'public.diag_device_events'::regclass, 'public.diag_quota'::regclass)`,
    );
    expect(fks.n).toBe(0);
    await db.exec("set role service_role");
    await db.query(
      `insert into diag_answer_events (received_at, engine, night_id, question_id, outcome, reason, http_status)
       values (now(), 'legacy', gen_random_uuid(), gen_random_uuid(), 'rejected', 'question_not_found', 404)`,
    );
    await db.exec("reset role");
  });

  test("rejects values outside the allowed vocabulary and oversized payloads", async () => {
    await db.exec("set role service_role");
    try {
      await expect(
        db.query(
          `insert into diag_answer_events (received_at, engine, outcome, reason, http_status)
           values (now(), 'legacy', 'maybe', 'x', 200)`,
        ),
      ).rejects.toThrow();
      await expect(
        db.query(
          `insert into diag_answer_events (received_at, engine, outcome, reason, http_status)
           values (now(), 'quantum', 'saved', 'x', 200)`,
        ),
      ).rejects.toThrow();
      await expect(
        db.query(
          `insert into diag_server_actions (received_at, action, actor, http_status, outcome, reason)
           values (now(), 'reveal', 'stranger', 200, 'ok', 'ok')`,
        ),
      ).rejects.toThrow();
      await expect(
        db.query(
          `insert into diag_device_events (surface, session_id, kind, device_at, at_est)
           values ('fridge', 'x-session-1', 'net', now(), now())`,
        ),
      ).rejects.toThrow();
      await expect(
        db.query(
          `insert into diag_device_events (surface, session_id, kind, device_at, at_est, data)
           values ('player', 'x-session-1', 'net', now(), now(), $1::jsonb)`,
          [JSON.stringify({ blob: "x".repeat(5000) })],
        ),
      ).rejects.toThrow();
    } finally {
      await db.exec("reset role");
    }
  });

  test("has indexes for night + time lookups", async () => {
    const idx = await db.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
        where schemaname = 'public' and tablename in ('diag_answer_events','diag_server_actions','diag_device_events')`,
    );
    const defs = idx.rows.map((r) => r.indexdef).join("\n");
    expect(defs).toMatch(/diag_answer_events USING btree \(night_id, received_at\)/);
    expect(defs).toMatch(/diag_server_actions USING btree \(night_id, received_at\)/);
    expect(defs).toMatch(/diag_device_events USING btree \(night_id, at_est\)/);
    expect(defs).toMatch(/diag_device_events USING btree \(night_id, device_id, at_est\)/);
    for (const table of TABLES) expect(defs).toMatch(new RegExp(`${table} USING btree \\(created_at\\)`));
  });

  test("the timeline lines up diagnostic rows and the game's own rows, with names joined in", async () => {
    await db.exec("set role service_role");
    // A tap from a device that is not (yet) a player falls back to a short device id.
    await db.query(
      `insert into diag_answer_events (received_at, engine, night_id, device_id, outcome, reason, http_status)
       values ('2026-10-08T00:06:05Z', 'legacy', $1, gen_random_uuid(), 'rejected', 'no_device_session', 401)`,
      [nightId],
    );
    const rows = await db.query<{ source: string; who: string; what: string; at: Date }>(
      "select source, who, what, at from public.diag_night_timeline($1) order by at",
      [nightId],
    );
    await db.exec("reset role");
    const sources = rows.rows.map((r) => r.source);
    expect(new Set(sources)).toEqual(
      new Set(["answer", "action", "device:player", "device:tv", "db_reveal", "db_answer"]),
    );
    const ats = rows.rows.map((r) => r.at.getTime());
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    const heather = rows.rows.filter((r) => r.who === "Heather");
    expect(heather.map((r) => r.source)).toEqual(
      expect.arrayContaining(["answer", "device:player", "db_answer"]),
    );
    expect(rows.rows.find((r) => r.what === "late: deadline_passed")?.who).toBe("Quiet Quinn");
    expect(rows.rows.find((r) => r.what === "rejected: no_device_session")?.who).toMatch(/^device [0-9a-f]{8}$/);
    expect(rows.rows.find((r) => r.source === "device:tv")?.who).toBe("tv sess-t");
  });

  test("the timeline takes only the night asked for, and an optional time window", async () => {
    await db.exec("set role service_role");
    try {
      const other = await db.query("select * from public.diag_night_timeline(gen_random_uuid())");
      expect(other.rows).toHaveLength(0);
      const window = await db.query<{ source: string }>(
        "select source from public.diag_night_timeline($1, $2::timestamptz, $3::timestamptz)",
        [nightId, "2026-10-08T00:06:09Z", "2026-10-08T00:06:13Z"],
      );
      expect(window.rows.map((r) => r.source).sort()).toEqual(["device:player", "device:tv"]);
      const sinceOnly = await db.query<{ source: string }>(
        "select source from public.diag_night_timeline($1, $2::timestamptz)",
        [nightId, "2026-10-08T00:06:25Z"],
      );
      expect(sinceOnly.rows.map((r) => r.source)).toContain("action");
      expect(sinceOnly.rows.map((r) => r.source)).not.toContain("db_reveal");
    } finally {
      await db.exec("reset role");
    }
  });

  describe("cleanup", () => {
    const insertDevices = (count: number, ageDays: number, tag: string) =>
      db.query(
        `insert into diag_device_events (created_at, night_id, surface, session_id, kind, device_at, at_est)
         select now() - ($1 || ' days')::interval, $2, 'tv', $3 || g, 'net', now(), now()
           from generate_series(1, $4) g`,
        [String(ageDays), nightId, tag, count],
      );
    const countTag = async (tag: string) =>
      (await one<{ n: number }>("select count(*)::int as n from diag_device_events where session_id like $1", [`${tag}%`])).n;

    test("removes rows older than 45 days, keeps newer ones, and refuses a typo", async () => {
      await db.exec("set role service_role");
      try {
        await db.query(
          `insert into diag_device_events (created_at, night_id, surface, session_id, kind, device_at, at_est)
           values (now() - interval '46 days', $1, 'tv', 'old-session', 'net', now(), now()),
                  (now() - interval '44 days', $1, 'tv', 'new-session', 'net', now(), now())`,
          [nightId],
        );
        await expect(db.query("select public.cleanup_diagnostic_logs(0)")).rejects.toThrow(/at least 7 days/);
        await expect(db.query("select public.cleanup_diagnostic_logs(null)")).rejects.toThrow(/at least 7 days/);
        await expect(db.query("select public.cleanup_diagnostic_logs(45, 0)")).rejects.toThrow(/batch must be/);
        await expect(db.query("select public.cleanup_diagnostic_logs(45, null)")).rejects.toThrow(/batch must be/);
        await expect(db.query("select public.cleanup_diagnostic_logs(45, 999999)")).rejects.toThrow(/batch must be/);
        const removed = await one<{ n: string }>("select public.cleanup_diagnostic_logs(45) as n");
        expect(Number(removed.n)).toBeGreaterThanOrEqual(1);
        const left = await db.query<{ session_id: string }>(
          "select session_id from diag_device_events where session_id in ('old-session','new-session')",
        );
        expect(left.rows.map((r) => r.session_id)).toEqual(["new-session"]);
      } finally {
        await db.exec("reset role");
      }
    });

    test("removes one small batch per call, so a big backlog is cleared over several calls, each its own transaction", async () => {
      await db.exec("set role service_role");
      try {
        await insertDevices(250, 60, "flood-");
        await insertDevices(20, 3, "fresh-");
        const removedEach: number[] = [];
        for (let i = 0; i < 10; i++) {
          const r = await one<{ n: string }>("select public.cleanup_diagnostic_logs(45, 100) as n");
          removedEach.push(Number(r.n));
          if (Number(r.n) === 0) break;
        }
        expect(removedEach).toEqual([100, 100, 50, 0]);
        expect(await countTag("flood-")).toBe(0);
        expect(await countTag("fresh-")).toBe(20); // nothing recent was touched
      } finally {
        await db.exec("reset role");
      }
    });

    test("is a no-op on tables with nothing old in them", async () => {
      await db.exec("set role service_role");
      try {
        const r = await one<{ n: string }>("select public.cleanup_diagnostic_logs(45, 5000) as n");
        expect(Number(r.n)).toBe(0);
      } finally {
        await db.exec("reset role");
      }
    });

    test("also clears old row-cap counters, and only old ones", async () => {
      await db.exec("set role service_role");
      try {
        const oldNight = crypto.randomUUID();
        const newNight = crypto.randomUUID();
        await db.query("select public.diag_take_rows($1, 'tv', 3, 100, 100)", [oldNight]);
        await db.query("select public.diag_take_rows($1, 'tv', 3, 100, 100)", [newNight]);
        await db.exec("reset role");
        await db.query("update diag_quota set updated_at = now() - interval '50 days' where night_id = $1", [oldNight]);
        await db.exec("set role service_role");
        await db.query("select public.cleanup_diagnostic_logs(45)");
        const left = await db.query<{ night_id: string }>(
          "select distinct night_id from diag_quota where night_id in ($1, $2)",
          [oldNight, newNight],
        );
        expect(left.rows.map((r) => r.night_id)).toEqual([newNight]);
      } finally {
        await db.exec("reset role");
      }
    });
  });

  describe("diag_take_rows: the per-night row caps", () => {
    const take = async (night: string, bucket: string, want: number, bucketCap: number, nightCap: number) =>
      Number(
        (await one<{ n: number }>("select public.diag_take_rows($1, $2, $3, $4, $5) as n", [night, bucket, want, bucketCap, nightCap]))
          .n,
      );
    const quota = async (night: string) =>
      Object.fromEntries(
        (
          await db.query<{ bucket: string; rows_taken: number; rows_refused: number }>(
            "select bucket, rows_taken, rows_refused from diag_quota where night_id = $1 order by bucket",
            [night],
          )
        ).rows.map((r) => [r.bucket, [r.rows_taken, r.rows_refused]]),
      );

    test("hands out rows until the source's cap, then none, and counts what it turned away", async () => {
      await db.exec("set role service_role");
      try {
        const night = crypto.randomUUID();
        expect(await take(night, "tv", 25, 60, 1000)).toBe(25);
        expect(await take(night, "tv", 25, 60, 1000)).toBe(25);
        expect(await take(night, "tv", 25, 60, 1000)).toBe(10); // only 10 left under the TV's cap
        expect(await take(night, "tv", 25, 60, 1000)).toBe(0);
        expect(await quota(night)).toEqual({ _night: [60, 40], tv: [60, 40] });
      } finally {
        await db.exec("reset role");
      }
    });

    test("one source reaching its cap does not take room from another source of the same night", async () => {
      await db.exec("set role service_role");
      try {
        const night = crypto.randomUUID();
        const device = "p:" + crypto.randomUUID();
        expect(await take(night, "tv", 50, 50, 1000)).toBe(50);
        expect(await take(night, "tv", 1, 50, 1000)).toBe(0);
        expect(await take(night, device, 30, 50, 1000)).toBe(30);
        expect(await take(night, "host", 30, 50, 1000)).toBe(30);
      } finally {
        await db.exec("reset role");
      }
    });

    test("the whole night has a cap too, whatever the sources add up to", async () => {
      await db.exec("set role service_role");
      try {
        const night = crypto.randomUUID();
        // three sources each under their own cap (50), but the night allows 100 in all
        expect(await take(night, "tv", 40, 50, 100)).toBe(40);
        expect(await take(night, "host", 40, 50, 100)).toBe(40);
        expect(await take(night, "p:a", 40, 50, 100)).toBe(20); // the night only had 20 left
        expect(await take(night, "p:b", 40, 50, 100)).toBe(0);
        expect(await take(night, "tv", 5, 50, 100)).toBe(0);
        const q = await quota(night);
        expect(q._night).toEqual([100, 20 + 40 + 5]); // turned away: 20 of the third ask, all 40 of the fourth, all 5 of the last
        expect(q["p:b"]).toEqual([0, 40]);
      } finally {
        await db.exec("reset role");
      }
    });

    test("with the real caps: a night whose reports are used up still has room for a late tap and a host press", async () => {
      await db.exec("set role service_role");
      try {
        const night = crypto.randomUUID();
        // Report sources use up the reports' night share (they are held to it by the caller).
        let reports = 0;
        for (let i = 0; i < 100 && reports < DIAG_NIGHT_ROW_CAP; i++) {
          reports += await take(night, `p:phone-${i}`, 500, DIAG_BUCKET_ROW_CAPS.player, DIAG_NIGHT_ROW_CAP);
        }
        reports += await take(night, "tv", 1000, DIAG_BUCKET_ROW_CAPS.tv, DIAG_NIGHT_ROW_CAP);
        expect(await take(night, "tv", 10, DIAG_BUCKET_ROW_CAPS.tv, DIAG_NIGHT_ROW_CAP)).toBe(0); // reports are shut out
        // The server's own rows have their own sources and a higher night cap.
        expect(await take(night, "a:late-phone", 1, DIAG_BUCKET_ROW_CAPS.tap, DIAG_NIGHT_SERVER_ROW_CAP)).toBe(1);
        expect(await take(night, "press", 1, DIAG_BUCKET_ROW_CAPS.press, DIAG_NIGHT_SERVER_ROW_CAP)).toBe(1);
        // ...and each of them is still held to its own cap.
        let spammer = 0;
        for (let i = 0; i < 5; i++) {
          spammer += await take(night, "a:spammer", 1000, DIAG_BUCKET_ROW_CAPS.tap, DIAG_NIGHT_SERVER_ROW_CAP);
        }
        expect(spammer).toBe(DIAG_BUCKET_ROW_CAPS.tap);
        expect((await quota(night))._night![0]).toBeLessThanOrEqual(DIAG_NIGHT_SERVER_ROW_CAP);
      } finally {
        await db.exec("reset role");
      }
    });

    test("another night is untouched", async () => {
      await db.exec("set role service_role");
      try {
        const full = crypto.randomUUID();
        const other = crypto.randomUUID();
        expect(await take(full, "tv", 10, 10, 10)).toBe(10);
        expect(await take(full, "tv", 10, 10, 10)).toBe(0);
        expect(await take(other, "tv", 10, 10, 10)).toBe(10);
      } finally {
        await db.exec("reset role");
      }
    });

    test("asks for nothing sensible, gets nothing (and nothing breaks)", async () => {
      await db.exec("set role service_role");
      try {
        const night = crypto.randomUUID();
        expect(await take(night, "tv", 0, 10, 10)).toBe(0);
        expect(await take(night, "tv", -5, 10, 10)).toBe(0);
        expect(await take(night, "", 5, 10, 10)).toBe(0);
        expect(await take(night, "x".repeat(49), 5, 10, 10)).toBe(0);
        expect(await take(night, "tv", 5, 0, 10)).toBe(0);
        expect((await one<{ n: number | null }>("select public.diag_take_rows(null, 'tv', 5, 10, 10) as n")).n).toBe(0);
        expect((await one<{ n: number | null }>("select public.diag_take_rows($1, null, 5, 10, 10) as n", [night])).n).toBe(0);
        // a huge ask is held to 1000 at a time
        expect(await take(night, "tv", 1_000_000, 5000, 5000)).toBe(1000);
      } finally {
        await db.exec("reset role");
      }
    });

    // (pglite has one connection, so these asks run one after another; the
    // function locks the night's row first and the source's row second, which is
    // what keeps it exact when real requests overlap.)
    test("never goes over the cap across many asks in a row", async () => {
      await db.exec("set role service_role");
      try {
        const night = crypto.randomUUID();
        const grants = await Promise.all(Array.from({ length: 20 }, () => take(night, "tv", 7, 50, 1000)));
        expect(grants.reduce((a, b) => a + b, 0)).toBe(50);
        expect((await quota(night))._night).toEqual([50, 140 - 50]);
      } finally {
        await db.exec("reset role");
      }
    });
  });

  describe("the example queries in docs/diagnostics/night-timeline.md", () => {
    const markdown = readFileSync(DOCS, "utf8");
    const queries = [...markdown.matchAll(/```sql\n(-- Q\d:[\s\S]*?)```/g)].map((m) => m[1]!);

    test("there are exactly five, Q1 to Q5", () => {
      expect(queries.map((q) => q.split(":")[0])).toEqual(["-- Q1", "-- Q2", "-- Q3", "-- Q4", "-- Q5"]);
    });

    test.each([1, 2, 3, 4, 5])("Q%i runs and answers from the seeded night", async (n) => {
      const sql = queries[n - 1]!
        .replaceAll(":night_id", nightId)
        .replaceAll(":question_id", questionId);
      await db.exec("set role service_role");
      let rows: Record<string, unknown>[];
      try {
        rows = (await db.query<Record<string, unknown>>(sql)).rows;
      } finally {
        await db.exec("reset role");
      }
      expect(rows.length).toBeGreaterThan(0);
      if (n === 2) {
        // Only the player with no saved answer, with what the server said about them.
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ display_name: "Quiet Quinn", taps_server_saw: 1 });
        expect(String(rows[0]!.server_said)).toContain("late: deadline_passed");
      }
      if (n === 1) {
        // 19:05:30 to 19:07:00 Central is 00:05:30 to 00:07:00 UTC.
        expect(rows.map((r) => r.source)).toEqual(expect.arrayContaining(["action", "answer", "db_answer"]));
      }
      if (n === 3) {
        expect(rows[0]).toMatchObject({ action: "reveal", broadcast_ok: true, cold_start: true });
        // Sent at 00:06:00.900 (press + 900 ms); the phone heard it at 00:06:01.300.
        expect(Number(rows[0]!.heard_ms_after_sent)).toBe(400);
      }
      if (n === 4) {
        expect(rows[0]).toMatchObject({ was: "online", now: "unreachable", realtime_channel: "CLOSED" });
      }
      if (n === 5) {
        expect(rows.map((r) => r.outcome)).toEqual(["saved", "late"]);
        expect(Number(rows[1]!.phone_held_tap_ms)).toBe(5800);
      }
    });
  });
});
