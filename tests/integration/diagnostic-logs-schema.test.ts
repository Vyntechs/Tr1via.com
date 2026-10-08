// @vitest-environment node

// Migration 20261007180000_diagnostic_logs.sql on real Postgres (pglite).
// Proves: the three tables and the timeline view are closed to the browser
// roles (RLS with no policies, no grants), the service role can write and
// read, constraints hold, there are no foreign keys, cleanup keeps 45 days
// and refuses a typo, and every query documented in
// docs/diagnostics/night-timeline.md runs against a realistic night.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const DOCS = path.join(ROOT, "docs/diagnostics/night-timeline.md");
const TABLES = ["diag_answer_events", "diag_server_actions", "diag_device_events"] as const;

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
  await db.exec(readFileSync(path.join(MIGRATIONS, "20261007180000_diagnostic_logs.sql"), "utf8"));
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
    for (const table of TABLES) {
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

  test("the browser roles have no rights on the tables, the view or the cleanup function", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const relation of [...TABLES, "diag_night_timeline"]) {
        const r = await one<{ s: boolean; i: boolean; d: boolean }>(
          `select has_table_privilege('${role}', 'public.${relation}', 'select') as s,
                  has_table_privilege('${role}', 'public.${relation}', 'insert') as i,
                  has_table_privilege('${role}', 'public.${relation}', 'delete') as d`,
        );
        expect(r, `${role} on ${relation}`).toEqual({ s: false, i: false, d: false });
      }
      const fn = await one<{ x: boolean }>(
        `select has_function_privilege('${role}', 'public.cleanup_diagnostic_logs(integer)', 'execute') as x`,
      );
      expect(fn.x).toBe(false);
    }
    const service = await one<{ s: boolean; i: boolean; x: boolean }>(
      `select has_table_privilege('service_role', 'public.diag_device_events', 'insert') as i,
              has_table_privilege('service_role', 'public.diag_night_timeline', 'select') as s,
              has_function_privilege('service_role', 'public.cleanup_diagnostic_logs(integer)', 'execute') as x`,
    );
    expect(service).toEqual({ s: true, i: true, x: true });
  });

  test.each(["anon", "authenticated"] as const)("%s cannot read or write any diagnostic row", async (role) => {
    await db.exec(`set role ${role}`);
    try {
      for (const relation of [...TABLES, "diag_night_timeline"]) {
        await expect(db.query(`select * from public.${relation}`)).rejects.toThrow(/permission denied/i);
      }
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

  test("the timeline view obeys the caller's rights (security_invoker)", async () => {
    const view = await one<{ reloptions: string[] }>(
      "select reloptions from pg_class where oid = 'public.diag_night_timeline'::regclass",
    );
    expect(view.reloptions).toContain("security_invoker=true");
  });

  test("has no foreign keys, so a reset or an unknown id never loses or blocks a row", async () => {
    const fks = await one<{ n: number }>(
      `select count(*)::int as n from pg_constraint
        where contype = 'f' and conrelid in (
          'public.diag_answer_events'::regclass, 'public.diag_server_actions'::regclass, 'public.diag_device_events'::regclass)`,
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
      `select source, who, what, at from diag_night_timeline where night_id = $1 order by at`,
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

  test("cleanup removes rows older than 45 days, keeps newer ones, and refuses a typo", async () => {
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
      const removed = await one<{ n: string }>("select public.cleanup_diagnostic_logs(45) as n");
      expect(Number(removed.n)).toBe(1);
      const left = await db.query<{ session_id: string }>(
        "select session_id from diag_device_events where session_id in ('old-session','new-session')",
      );
      expect(left.rows.map((r) => r.session_id)).toEqual(["new-session"]);
    } finally {
      await db.exec("reset role");
    }
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
