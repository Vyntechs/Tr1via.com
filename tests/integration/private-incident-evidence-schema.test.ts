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
const EVIDENCE_MIGRATION = path.join(
  MIGRATIONS_DIR,
  "20260917033458_private_incident_evidence.sql",
);

const IDs = {
  user: "10000000-0000-4000-8000-000000000001",
  host: "10000000-0000-4000-8000-000000000002",
  legacyNight: "10000000-0000-4000-8000-000000000003",
  resilientNight: "10000000-0000-4000-8000-000000000004",
  legacyGame: "10000000-0000-4000-8000-000000000005",
  resilientGame: "10000000-0000-4000-8000-000000000006",
  legacyCategory: "10000000-0000-4000-8000-000000000007",
  resilientCategory: "10000000-0000-4000-8000-000000000008",
  legacyQuestion: "10000000-0000-4000-8000-000000000009",
  resilientQuestion: "10000000-0000-4000-8000-000000000010",
  legacyPlayer: "10000000-0000-4000-8000-000000000011",
  resilientPlayer: "10000000-0000-4000-8000-000000000012",
  disposablePlayer: "10000000-0000-4000-8000-000000000013",
  run: "10000000-0000-4000-8000-000000000014",
  play: "10000000-0000-4000-8000-000000000015",
  action: "10000000-0000-4000-8000-000000000016",
  session: "10000000-0000-4000-8000-000000000017",
  event: "10000000-0000-4000-8000-000000000018",
} as const;

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create schema if not exists extensions;
    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key default gen_random_uuid()
    );
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create publication supabase_realtime;
  `);
  await db.exec(readFileSync(path.join(MIGRATIONS_DIR, "0001_init.sql"), "utf8"));
  await db.exec(`
    grant usage on schema public to anon, authenticated, service_role;
    grant select, insert, update, delete on all tables in schema public
      to anon, authenticated;
    grant all on all tables in schema public to service_role;
    grant execute on all functions in schema public
      to anon, authenticated, service_role;
  `);
  await db.exec(
    readFileSync(path.join(MIGRATIONS_DIR, "0022_live_answer_engine_schema.sql"), "utf8"),
  );
  await db.exec(readFileSync(EVIDENCE_MIGRATION, "utf8"));
  return db;
}

async function asService<T>(db: PGlite, sql: string, params: unknown[] = []) {
  await db.exec("set role service_role");
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec("reset role");
  }
}

describe("private incident evidence foundation", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await freshDb();
    await db.query("insert into auth.users (id) values ($1)", [IDs.user]);
    await db.query(
      "insert into hosts (id, user_id, display_name) values ($1, $2, 'Host')",
      [IDs.host, IDs.user],
    );
    await db.query(
      `insert into nights (
         id, host_id, venue_name, room_code, answer_engine, current_run_id
       ) values
         ($1, $3, 'Legacy Venue', 'EVID01', 'legacy', null),
         ($2, $3, 'Resilient Venue', 'EVID02', 'resilient_v1', $4)`,
      [IDs.legacyNight, IDs.resilientNight, IDs.host, IDs.run],
    );
    await db.query(
      `insert into games (id, night_id, game_no) values
         ($1, $3, 1), ($2, $4, 1)`,
      [IDs.legacyGame, IDs.resilientGame, IDs.legacyNight, IDs.resilientNight],
    );
    await db.query(
      `insert into categories (id, game_id, name, topic, position) values
         ($1, $3, 'Legacy', 'Legacy', 0),
         ($2, $4, 'Resilient', 'Resilient', 0)`,
      [
        IDs.legacyCategory,
        IDs.resilientCategory,
        IDs.legacyGame,
        IDs.resilientGame,
      ],
    );
    await db.query(
      `insert into questions (
         id, category_id, prompt, options, correct_index, played_at
       ) values
         ($1, $3, 'Legacy?', '["A","B","C","D"]'::jsonb, 0,
          '2030-01-02T03:04:05Z'),
         ($2, $4, 'Resilient?', '["A","B","C","D"]'::jsonb, 0, null)`,
      [
        IDs.legacyQuestion,
        IDs.resilientQuestion,
        IDs.legacyCategory,
        IDs.resilientCategory,
      ],
    );
    await db.query(
      `insert into players (id, night_id, device_id, display_name) values
         ($1, $4, '20000000-0000-4000-8000-000000000001', 'Legacy Player'),
         ($2, $5, '20000000-0000-4000-8000-000000000002', 'Resilient Player'),
         ($3, $4, '20000000-0000-4000-8000-000000000003', 'Disposable')`,
      [
        IDs.legacyPlayer,
        IDs.resilientPlayer,
        IDs.disposablePlayer,
        IDs.legacyNight,
        IDs.resilientNight,
      ],
    );
    await db.query(
      `insert into question_plays (
         id, night_id, run_id, game_id, category_id, question_id,
         opened_at, main_zero_at, final_window_ends_at, eligible_count
       ) values (
         $1, $2, $3, $4, $5, $6,
         '2030-01-02T03:04:05Z', '2030-01-02T03:04:30Z',
         '2030-01-02T03:04:32Z', 1
       )`,
      [
        IDs.play,
        IDs.resilientNight,
        IDs.run,
        IDs.resilientGame,
        IDs.resilientCategory,
        IDs.resilientQuestion,
      ],
    );
    await db.query(
      `insert into question_play_eligibility (play_id, player_id, night_id)
       values ($1, $2, $3)`,
      [IDs.play, IDs.resilientPlayer, IDs.resilientNight],
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  test("enables RLS, removes all direct browser and service-role table access, and stays out of Realtime", async () => {
    const protectedTables = await db.query<{
      relname: string;
      relrowsecurity: boolean;
    }>(`
      select c.relname, c.relrowsecurity
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in (
           'answer_rejection_evidence', 'incident_surface_events'
         )
       order by c.relname
    `);
    expect(protectedTables.rows).toEqual([
      { relname: "answer_rejection_evidence", relrowsecurity: true },
      { relname: "incident_surface_events", relrowsecurity: true },
    ]);

    const grants = await db.query<{ grantee: string; table_name: string }>(`
      select grantee, table_name
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name in (
           'answer_rejection_evidence', 'incident_surface_events'
         )
         and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
    `);
    expect(grants.rows).toEqual([]);

    for (const role of ["anon", "authenticated", "service_role"] as const) {
      await db.exec(`set role ${role}`);
      try {
        await expect(
          db.query("select * from public.answer_rejection_evidence"),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          db.query("select * from public.incident_surface_events"),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await db.exec("reset role");
      }
    }

    const publication = await db.query<{ tablename: string }>(`
      select tablename
        from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime'
         and tablename in (
           'answer_rejection_evidence', 'incident_surface_events'
         )
    `);
    expect(publication.rows).toEqual([]);
  });

  test("grants only service_role access to the narrow write and cleanup functions", async () => {
    const grants = await db.query<{
      grantee: string;
      routine_name: string;
    }>(`
      select grantee, routine_name
        from information_schema.role_routine_grants
       where routine_schema = 'public'
         and routine_name in (
           'record_legacy_answer_rejection',
           'record_resilient_answer_rejection',
           'record_incident_surface_event',
           'cleanup_expired_incident_evidence'
         )
       order by routine_name, grantee
    `);
    expect(
      grants.rows.filter((row) => row.grantee !== "postgres")
        .every((row) => row.grantee === "service_role"),
    ).toBe(true);
    expect(
      new Set(
        grants.rows
          .filter((row) => row.grantee === "service_role")
          .map((row) => row.routine_name),
      ),
    ).toEqual(
      new Set([
        "record_legacy_answer_rejection",
        "record_resilient_answer_rejection",
        "record_incident_surface_event",
        "cleanup_expired_incident_evidence",
      ]),
    );
  });

  test("records the exact 25.000-second legacy rejection and aggregates retries deterministically", async () => {
    const call = (receivedAt: string, trace: string) =>
      asService<{ id: string }>(
        db,
        `select public.record_legacy_answer_rejection(
           $1, $2, $3, 0::smallint, $4::timestamptz,
           'deadline_passed', $5, 'release-a'
         ) as id`,
        [IDs.legacyQuestion, IDs.legacyPlayer, IDs.action, receivedAt, trace],
      );

    const exact = await call("2030-01-02T03:04:30.000Z", "trace-exact");
    const later = await call("2030-01-02T03:04:30.800Z", "trace-later");
    expect(later.rows[0].id).toBe(exact.rows[0].id);
    const concurrentRetries = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        call(
          `2030-01-02T03:04:${(30.1 + index * 0.2).toFixed(3)}Z`,
          `trace-concurrent-${index}`,
        ),
      ),
    );
    expect(new Set(concurrentRetries.map((result) => result.rows[0].id))).toEqual(
      new Set([exact.rows[0].id]),
    );

    const row = await db.query<{
      first_deadline_delta_ms: number;
      last_deadline_delta_ms: number;
      request_count: number;
      first_trace_id: string;
      retained_for: string;
    }>(`
      select first_deadline_delta_ms, last_deadline_delta_ms, request_count,
             first_trace_id, (expires_at - first_received_at)::text as retained_for
        from answer_rejection_evidence
       where id = $1
    `, [exact.rows[0].id]);
    expect(row.rows[0]).toEqual({
      first_deadline_delta_ms: 0,
      last_deadline_delta_ms: 1500,
      request_count: 10,
      first_trace_id: "trace-exact",
      retained_for: "30 days",
    });

    await expect(
      call("2030-01-02T03:04:29.999Z", "trace-too-early"),
    ).rejects.toThrow(/invalid deadline rejection/i);
  });

  test("validates resilient ancestry and stores a deadline rejection without exposing a table write path", async () => {
    const result = await asService<{ id: string }>(
      db,
      `select public.record_resilient_answer_rejection(
         $1, $2, $3, $4, 2::smallint,
         '2030-01-02T03:04:32Z'::timestamptz,
         'deadline_passed', 'trace-live', 'release-live'
       ) as id`,
      [IDs.play, IDs.run, IDs.resilientPlayer, crypto.randomUUID()],
    );
    expect(result.rows[0].id).toMatch(/^[0-9a-f-]{36}$/i);

    await expect(
      asService(
        db,
        `select public.record_resilient_answer_rejection(
           $1, $2, $3, null, 2::smallint,
           '2030-01-02T03:04:32Z'::timestamptz,
           'deadline_passed', null, null
         )`,
        [IDs.play, IDs.run, IDs.legacyPlayer],
      ),
    ).rejects.toThrow(/ineligible resilient player/i);
  });

  test("keeps one historical receipt per stage and surface, including a valid stale screen", async () => {
    await db.query(
      "update questions set finished_at = '2030-01-02T03:04:31Z' where id = $1",
      [IDs.legacyQuestion],
    );
    const call = (eventId: string) =>
      asService<{ id: string }>(
        db,
        `select public.record_incident_surface_event(
           $1, $2, 'legacy', $3, $4, null, null,
           'answer_reveal', 'frame_committed', 'player_phone',
           'pk_private_subject_1234567890',
           '2030-01-02T03:04:31Z'::timestamptz,
           false, null, null, 9, 4, 'route_poll', $5, $6,
           'release-old', 'trace-screen'
         ) as id`,
        [
          IDs.legacyNight,
          IDs.legacyPlayer,
          IDs.legacyGame,
          IDs.legacyQuestion,
          IDs.session,
          eventId,
        ],
      );

    const first = await call(IDs.event);
    const retry = await call(crypto.randomUUID());
    expect(retry.rows[0].id).toBe(first.rows[0].id);

    const rows = await db.query<{
      current_when_received: boolean;
      delivery_path: string;
      surface_kind: string;
    }>(`
      select current_when_received, delivery_path, surface_kind
        from incident_surface_events
       where id = $1
    `, [first.rows[0].id]);
    expect(rows.rows).toEqual([{
      current_when_received: false,
      delivery_path: "route_poll",
      surface_kind: "player_phone",
    }]);
  });

  test("preserves evidence across mutable game cleanup but erases player-linked evidence when the player is deleted", async () => {
    const surface = await asService<{ id: string }>(
      db,
      `select public.record_incident_surface_event(
         $1, $2, 'legacy', $3, $4, null, null,
         'question_open', 'frame_committed', 'player_phone',
         'pk_disposable_subject_123456',
         '2030-01-02T03:04:05Z'::timestamptz,
         true, null, null, null, null, 'initial_snapshot', $5, $6,
         null, null
       ) as id`,
      [
        IDs.legacyNight,
        IDs.disposablePlayer,
        IDs.legacyGame,
        IDs.legacyQuestion,
        crypto.randomUUID(),
        crypto.randomUUID(),
      ],
    );

    await db.query("update questions set played_at = null where id = $1", [
      IDs.legacyQuestion,
    ]);
    expect(
      (await db.query("select id from incident_surface_events where id = $1", [surface.rows[0].id])).rows,
    ).toHaveLength(1);

    await db.query("delete from players where id = $1", [IDs.disposablePlayer]);
    expect(
      (await db.query("select id from incident_surface_events where id = $1", [surface.rows[0].id])).rows,
    ).toEqual([]);

    await db.query("delete from question_plays where id = $1", [IDs.play]);
    const resilientEvidence = await db.query(
      "select id from answer_rejection_evidence where answer_engine = 'resilient_v1'",
    );
    expect(resilientEvidence.rows).toHaveLength(1);
  });

  test("cleans expired rows in bounded batches and rejects an unsafe batch size", async () => {
    await db.exec(`
      update answer_rejection_evidence
         set first_received_at = '2020-01-01T00:00:00Z'::timestamptz,
             last_received_at = '2020-01-01T00:00:00Z'::timestamptz,
             expires_at = '2020-01-31T00:00:00Z'::timestamptz
       where answer_engine = 'legacy';
      update incident_surface_events
         set received_at = '2020-01-01T00:00:00Z'::timestamptz,
             expires_at = '2020-01-31T00:00:00Z'::timestamptz;
    `);

    const cleaned = await asService<{ result: {
      answerRejections: number;
      surfaceEvents: number;
    } }>(
      db,
      "select public.cleanup_expired_incident_evidence(1) as result",
    );
    expect(cleaned.rows[0].result).toEqual({
      answerRejections: 1,
      surfaceEvents: 1,
    });

    await expect(
      asService(db, "select public.cleanup_expired_incident_evidence(0)"),
    ).rejects.toThrow(/invalid cleanup batch size/i);
  });

  test("stores no names, devices, cookies, network addresses, answer text, or open-ended metadata", async () => {
    const columns = await db.query<{ table_name: string; column_name: string }>(`
      select table_name, column_name
        from information_schema.columns
       where table_schema = 'public'
         and table_name in (
           'answer_rejection_evidence', 'incident_surface_events'
         )
    `);
    const names = columns.rows.map((row) => row.column_name).join(" ");
    expect(names).not.toMatch(
      /display_name|device_id|cookie|ip_address|user_agent|answer_text|metadata|payload/i,
    );
  });
});
