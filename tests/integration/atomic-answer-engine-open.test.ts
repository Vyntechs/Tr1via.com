// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);
const MIGRATION = path.join(MIGRATIONS_DIR, "0026_atomic_answer_engine_open.sql");

type RpcResult = Record<string, unknown> & { code: string };
type RpcEnvelope = { freshlyApplied: boolean; result: RpcResult };

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create schema if not exists extensions;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key default gen_random_uuid());
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create publication supabase_realtime;
  `);
  for (const migration of [
    "0001_init.sql",
    "0008_reset_night_to_setup.sql",
    "0013_game_scores_per_game_isolation.sql",
    "0022_live_answer_engine_schema.sql",
    "0023_live_answer_engine_functions.sql",
    "0025_reset_night_answer_engine.sql",
    "0026_atomic_answer_engine_open.sql",
  ]) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, migration), "utf8"));
  }
  return db;
}

async function seedNight(
  db: PGlite,
  options: {
    answerEngine?: "legacy" | "resilient_v1";
    latched?: boolean;
    opened?: boolean;
    runId?: string | null;
    roomRevision?: number;
    controlRevision?: number;
    setting?: { releaseEnabled: boolean; preferredEngine: "legacy" | "resilient_v1" };
  } = {},
) {
  const user = await db.query<{ id: string }>(
    "insert into auth.users default values returning id",
  );
  const host = await db.query<{ id: string }>(
    "insert into hosts (user_id, display_name) values ($1, 'Host') returning id",
    [user.rows[0].id],
  );
  if (options.setting) {
    await db.query(
      `insert into host_answer_engine_settings (
         host_id, release_enabled, preferred_engine
       ) values ($1, $2, $3)`,
      [host.rows[0].id, options.setting.releaseEnabled, options.setting.preferredEngine],
    );
  }
  const night = await db.query<{ id: string }>(
    `insert into nights (
       host_id, venue_name, room_code, answer_engine, answer_engine_latched_at,
       current_run_id, room_revision, control_revision, opened_at
     ) values (
       $1, 'Venue', $2, $3,
       case when $4::boolean then now() else null end,
       $5::uuid, $6, $7,
       case when $8::boolean then now() else null end
     ) returning id`,
    [
      host.rows[0].id,
      `A${crypto.randomUUID().replaceAll("-", "").slice(0, 5).toUpperCase()}`,
      options.answerEngine ?? "legacy",
      options.latched ?? false,
      options.runId ?? null,
      options.roomRevision ?? 0,
      options.controlRevision ?? 0,
      options.opened ?? false,
    ],
  );
  return { hostId: host.rows[0].id, nightId: night.rows[0].id };
}

async function open(
  db: PGlite,
  nightId: string,
  commandId: string,
  expectedRunId: string | null = null,
  expectedControlRevision = 0,
): Promise<RpcEnvelope> {
  const response = await db.query<{ result: RpcEnvelope }>(
    "select public.open_night_run($1, $2, $3, $4) as result",
    [nightId, commandId, expectedRunId, expectedControlRevision],
  );
  return response.rows[0].result;
}

describe("atomic answer-engine open migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await freshDb();
  });

  afterEach(async () => {
    await db.close();
  });

  test("exists after the reset-safe live engine migration", () => {
    expect(existsSync(MIGRATION)).toBe(true);
  });

  test.each([
    ["missing setting", undefined],
    ["disabled resilient setting", { releaseEnabled: false, preferredEngine: "resilient_v1" as const }],
    ["enabled legacy setting", { releaseEnabled: true, preferredEngine: "legacy" as const }],
  ])("opens with legacy when the host has a %s", async (_label, setting) => {
    const { nightId } = await seedNight(db, { setting });
    const result = await open(db, nightId, crypto.randomUUID());

    expect(result).toMatchObject({
      freshlyApplied: false,
      result: { code: "legacy_opened", openedAt: expect.any(String) },
    });
    expect(Object.keys(result.result).sort()).toEqual(["code", "openedAt"]);

    const night = await db.query<{
      answer_engine: string;
      answer_engine_latched_at: Date | null;
      opened_at: Date | null;
      current_run_id: string | null;
      room_revision: number;
      control_revision: number;
    }>(
      `select answer_engine, answer_engine_latched_at, opened_at, current_run_id,
              room_revision, control_revision
         from nights where id = $1`,
      [nightId],
    );
    expect(night.rows[0]).toMatchObject({
      answer_engine: "legacy",
      current_run_id: null,
      room_revision: 0,
      control_revision: 0,
    });
    expect(night.rows[0].answer_engine_latched_at).not.toBeNull();
    expect(night.rows[0].opened_at).not.toBeNull();

    const events = await db.query<{ count: number }>(
      "select count(*)::int as count from live_room_events where night_id = $1",
      [nightId],
    );
    expect(events.rows[0].count).toBe(0);
  });

  test("atomically latches and opens resilient when release and preference are enabled", async () => {
    const { nightId } = await seedNight(db, {
      setting: { releaseEnabled: true, preferredEngine: "resilient_v1" },
    });
    const commandId = crypto.randomUUID();
    const result = await open(db, nightId, commandId);

    expect(result).toMatchObject({
      freshlyApplied: true,
      result: {
        code: "applied",
        applied: true,
        eventKind: "night_opened",
        runId: expect.any(String),
        roomRevision: 1,
        controlRevision: 1,
      },
    });
    const night = await db.query<{
      answer_engine: string;
      current_run_id: string;
      answer_engine_latched_at: Date;
      opened_at: Date;
    }>(
      `select answer_engine, current_run_id, answer_engine_latched_at, opened_at
         from nights where id = $1`,
      [nightId],
    );
    expect(night.rows[0]).toMatchObject({
      answer_engine: "resilient_v1",
      current_run_id: result.result.runId,
    });
    expect(night.rows[0].answer_engine_latched_at).not.toBeNull();
    expect(night.rows[0].opened_at).not.toBeNull();

    const durable = await db.query<{ runs: number; events: number; receipts: number }>(
      `select
         (select count(*)::int from live_night_runs where night_id = $1) as runs,
         (select count(*)::int from live_room_events where night_id = $1 and kind = 'night_opened') as events,
         (select count(*)::int from live_command_receipts
           where night_id = $1 and command_id = $2 and status = 'applied') as receipts`,
      [nightId, commandId],
    );
    expect(durable.rows[0]).toEqual({ runs: 1, events: 1, receipts: 1 });
  });

  test("an already-open unlatched night ignores an enabled setting and terminates its receipt", async () => {
    const { nightId } = await seedNight(db, {
      opened: true,
      setting: { releaseEnabled: true, preferredEngine: "resilient_v1" },
    });
    const commandId = crypto.randomUUID();
    const before = await db.query<{ opened_at: Date }>(
      "select opened_at from nights where id = $1",
      [nightId],
    );
    const result = await open(db, nightId, commandId);

    expect(result).toMatchObject({
      freshlyApplied: false,
      result: { code: "already_open", openedAt: expect.any(String) },
    });
    const after = await db.query<{
      answer_engine: string;
      answer_engine_latched_at: Date | null;
      opened_at: Date;
      current_run_id: string | null;
    }>(
      `select answer_engine, answer_engine_latched_at, opened_at, current_run_id
         from nights where id = $1`,
      [nightId],
    );
    expect(after.rows[0]).toEqual({
      answer_engine: "legacy",
      answer_engine_latched_at: null,
      opened_at: before.rows[0].opened_at,
      current_run_id: null,
    });
    const receipt = await db.query<{ status: string; canonical_result: RpcResult }>(
      `select status, canonical_result from live_command_receipts
        where night_id = $1 and command_id = $2`,
      [nightId, commandId],
    );
    expect(receipt.rows).toEqual([{
      status: "rejected",
      canonical_result: result.result,
    }]);
  });

  test("a latched legacy night stays legacy after reset even if preference changes", async () => {
    const { hostId, nightId } = await seedNight(db, {
      answerEngine: "legacy",
      latched: true,
      setting: { releaseEnabled: true, preferredEngine: "resilient_v1" },
    });
    await db.query(
      "update host_answer_engine_settings set preferred_engine = 'resilient_v1' where host_id = $1",
      [hostId],
    );

    const result = await open(db, nightId, crypto.randomUUID());
    expect(result.result.code).toBe("legacy_opened");
    const night = await db.query<{ answer_engine: string; current_run_id: string | null }>(
      "select answer_engine, current_run_id from nights where id = $1",
      [nightId],
    );
    expect(night.rows[0]).toEqual({ answer_engine: "legacy", current_run_id: null });
  });

  test("a reset-preallocated resilient run ignores a later preference change", async () => {
    const runId = crypto.randomUUID();
    const { nightId } = await seedNight(db, {
      answerEngine: "resilient_v1",
      latched: true,
      runId,
      setting: { releaseEnabled: false, preferredEngine: "legacy" },
    });

    const result = await open(db, nightId, crypto.randomUUID(), runId);
    expect(result).toMatchObject({
      freshlyApplied: true,
      result: { eventKind: "night_opened", runId },
    });
    const runs = await db.query<{ count: number }>(
      "select count(*)::int as count from live_night_runs where night_id = $1",
      [nightId],
    );
    expect(runs.rows[0].count).toBe(1);
  });

  test("rejects stale expectations before consulting preference or latching", async () => {
    const { nightId } = await seedNight(db, {
      controlRevision: 3,
      setting: { releaseEnabled: true, preferredEngine: "resilient_v1" },
    });
    const commandId = crypto.randomUUID();
    const result = await open(db, nightId, commandId, null, 2);

    expect(result).toEqual({
      freshlyApplied: false,
      result: { code: "stale", applied: false },
    });
    const night = await db.query<{
      answer_engine: string;
      answer_engine_latched_at: Date | null;
      opened_at: Date | null;
      current_run_id: string | null;
    }>(
      `select answer_engine, answer_engine_latched_at, opened_at, current_run_id
         from nights where id = $1`,
      [nightId],
    );
    expect(night.rows[0]).toEqual({
      answer_engine: "legacy",
      answer_engine_latched_at: null,
      opened_at: null,
      current_run_id: null,
    });
  });

  test("returns the exact canonical open result as a nonfresh retry", async () => {
    const { nightId } = await seedNight(db, {
      setting: { releaseEnabled: true, preferredEngine: "resilient_v1" },
    });
    const commandId = crypto.randomUUID();
    const winner = await open(db, nightId, commandId);
    const retry = await open(db, nightId, commandId);
    expect(retry).toEqual({ freshlyApplied: false, result: winner.result });
  });

  test("leaves no pending receipt for legacy, already-open, or stale outcomes", async () => {
    const legacy = await seedNight(db);
    const already = await seedNight(db, { opened: true });
    const stale = await seedNight(db, { controlRevision: 1 });
    await open(db, legacy.nightId, crypto.randomUUID());
    await open(db, already.nightId, crypto.randomUUID());
    await open(db, stale.nightId, crypto.randomUUID(), null, 0);

    const pending = await db.query<{ count: number }>(
      `select count(*)::int as count from live_command_receipts
        where night_id in ($1, $2, $3) and status = 'pending'`,
      [legacy.nightId, already.nightId, stale.nightId],
    );
    expect(pending.rows[0].count).toBe(0);
  });

  test("keeps the exact signature, security definer boundary, and grants", async () => {
    const routine = await db.query<{
      security_definer: boolean;
      config: string[] | null;
      identity_args: string;
    }>(`
      select p.prosecdef as security_definer,
             p.proconfig as config,
             pg_get_function_identity_arguments(p.oid) as identity_args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'open_night_run'
    `);
    expect(routine.rows).toHaveLength(1);
    expect(routine.rows[0]).toMatchObject({
      security_definer: true,
      identity_args: "p_night_id uuid, p_command_id uuid, p_expected_run_id uuid, p_expected_control_revision bigint",
    });
    expect(routine.rows[0].config).toContain("search_path=pg_catalog, public");

    const grants = await db.query<{ grantee: string; privilege_type: string }>(`
      select grantee, privilege_type
        from information_schema.routine_privileges
       where specific_schema = 'public'
         and routine_name = 'open_night_run'
         and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
       order by grantee, privilege_type
    `);
    expect(grants.rows).toEqual([{ grantee: "service_role", privilege_type: "EXECUTE" }]);
  });

  test("defers only direct receipt-to-night ancestry until commit", async () => {
    const constraints = await db.query<{
      constraint_name: string;
      is_deferrable: string;
      initially_deferred: string;
    }>(`
      select constraint_name, is_deferrable, initially_deferred
        from information_schema.table_constraints
       where constraint_schema = 'public'
         and table_name = 'live_command_receipts'
         and constraint_name in (
           'live_command_receipts_night_fk',
           'live_command_receipts_night_run_fk'
         )
       order by constraint_name
    `);
    expect(constraints.rows).toEqual([
      {
        constraint_name: "live_command_receipts_night_fk",
        is_deferrable: "YES",
        initially_deferred: "YES",
      },
      {
        constraint_name: "live_command_receipts_night_run_fk",
        is_deferrable: "NO",
        initially_deferred: "NO",
      },
    ]);
  });
});
