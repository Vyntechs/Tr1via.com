// The log write slots are handed out by the DATABASE, across every connection (and so
// across every server copy). PGlite has one connection and cannot show that, so this
// test uses the local Supabase Postgres (like live-answer-races.test.ts), in a
// SCRATCH database of its own that it creates and drops: nothing in the real local
// database is touched, and no diagnostic table is left behind in it.
//
//   npm run test:db-races -- tests/concurrency/diag-write-slots.test.ts

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { DIAG_DB_LOCK_TIMEOUT_MS, DIAG_FLEET_WRITE_SLOTS } from "../../lib/diagnostics/config";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATION = readFileSync(path.join(ROOT, "supabase/migrations/20261007180000_diagnostic_logs.sql"), "utf8");

const databaseUrl = process.env.TR1VIA_RACE_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const target = new URL(databaseUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(target.hostname) || target.port !== "54322" || target.pathname !== "/postgres") {
  throw new Error("TR1VIA_RACE_DATABASE_URL must target 127.0.0.1:54322/postgres (or localhost/::1 equivalent)");
}
const scratchName = `diag_slots_${process.pid}_${Date.now()}`;
const scratchUrl = (() => {
  const url = new URL(databaseUrl);
  url.pathname = `/${scratchName}`;
  return url.toString();
})();

let admin: Client;
let reachable = true;

async function connect(): Promise<Client> {
  const client = new Client({ connectionString: scratchUrl });
  await client.connect();
  // as the service role, exactly like PostgREST does for the app
  await client.query("set role service_role");
  return client;
}

const row = (n: number) => JSON.stringify([{ received_at: "2026-10-08T01:00:00Z", action: "reveal", actor: "host", http_status: 200, outcome: "ok", reason: `r${n}` }]);

beforeAll(async () => {
  admin = new Client({ connectionString: databaseUrl });
  try {
    await admin.connect();
  } catch {
    reachable = false; // no local Supabase running: nothing to test against
    return;
  }
  await admin.query(`create database ${scratchName}`);
  const setup = new Client({ connectionString: scratchUrl });
  await setup.connect();
  try {
    // the migration's timeline function reads game tables; its body is not checked until it runs
    await setup.query("set check_function_bodies = off");
    await setup.query("create schema if not exists extensions");
    await setup.query(MIGRATION);
    await setup.query("grant usage on schema public to service_role");
  } finally {
    await setup.end();
  }
});

afterAll(async () => {
  if (!reachable) return;
  await admin.query(`drop database if exists ${scratchName} with (force)`);
  await admin.end();
});

describe("the write slots are a limit across all connections", () => {
  test("with the log table locked, only the slots' worth of writes wait; every other write is turned away at once with -1", async (ctx) => {
    if (!reachable) return ctx.skip();
    const locker = await connect();
    const callers = await Promise.all(Array.from({ length: DIAG_FLEET_WRITE_SLOTS + 5 }, connect));
    try {
      // someone holds the table (a truncate, a long migration): inserts must wait for it
      await locker.query("begin");
      await locker.query("lock table public.diag_server_actions in access exclusive mode");

      const startedAt = Date.now();
      const answers = await Promise.all(
        callers.map(async (client, i) => {
          const t0 = Date.now();
          try {
            const r = await client.query("select public.diag_insert_rows('diag_server_actions', $1::jsonb) as n", [row(i)]);
            return { n: Number(r.rows[0].n), ms: Date.now() - t0, code: null as string | null };
          } catch (error) {
            return { n: null, ms: Date.now() - t0, code: (error as { code?: string }).code ?? "?" };
          }
        }),
      );
      const waited = answers.filter((a) => a.code !== null);
      const turnedAway = answers.filter((a) => a.n === -1);
      // exactly the slots' worth of writes waited on the lock, and the lock timeout ended them (55P03)
      expect(waited).toHaveLength(DIAG_FLEET_WRITE_SLOTS);
      expect(waited.every((a) => a.code === "55P03")).toBe(true);
      expect(waited.every((a) => a.ms >= DIAG_DB_LOCK_TIMEOUT_MS - 50)).toBe(true);
      // every other write was answered "busy" in a blink, not after waiting for anything
      expect(turnedAway).toHaveLength(callers.length - DIAG_FLEET_WRITE_SLOTS);
      expect(Math.max(...turnedAway.map((a) => a.ms))).toBeLessThan(Math.min(...waited.map((a) => a.ms)));
      expect(Date.now() - startedAt).toBeLessThan(5_000);

      // nothing was written, and once the lock is released the slots are free again
      await locker.query("rollback");
      const after = await callers[0]!.query("select public.diag_insert_rows('diag_server_actions', $1::jsonb) as n", [row(99)]);
      expect(Number(after.rows[0].n)).toBe(1);
      const count = await callers[0]!.query("select count(*)::int as n from public.diag_server_actions");
      expect(count.rows[0].n).toBe(1);
    } finally {
      await locker.query("rollback").catch(() => {});
      await Promise.all([locker, ...callers].map((c) => c.end().catch(() => {})));
    }
  });

  test("on a healthy table many writers at once all get through (the slots are held for milliseconds, and callers ask again when told 'busy')", async (ctx) => {
    if (!reachable) return ctx.skip();
    const callers = await Promise.all(Array.from({ length: 12 }, connect));
    try {
      let stored = 0;
      await Promise.all(
        callers.map(async (client, i) => {
          for (let attempt = 0; attempt < 40; attempt += 1) {
            const r = await client.query("select public.diag_insert_rows('diag_server_actions', $1::jsonb) as n", [row(1000 + i)]);
            const n = Number(r.rows[0].n);
            if (n >= 0) {
              stored += n;
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 10)); // the app's back-off
          }
        }),
      );
      expect(stored).toBe(callers.length);
    } finally {
      await Promise.all(callers.map((c) => c.end().catch(() => {})));
    }
  });

  test("a slot is held only for the length of its transaction: a finished write frees it", async (ctx) => {
    if (!reachable) return ctx.skip();
    const a = await connect();
    const b = await connect();
    try {
      // hold ALL slots in an open transaction on connection A by writing 3 times inside it...
      await a.query("begin");
      for (let i = 0; i < DIAG_FLEET_WRITE_SLOTS; i += 1) {
        // (the same connection can take the same slot again, so use the locks directly)
        await a.query("select pg_try_advisory_xact_lock(20261008, $1)", [i + 1]);
      }
      const busy = await b.query("select public.diag_insert_rows('diag_server_actions', $1::jsonb) as n", [row(2000)]);
      expect(Number(busy.rows[0].n)).toBe(-1);
      await a.query("commit"); // the transaction ends: the slots are free
      const free = await b.query("select public.diag_insert_rows('diag_server_actions', $1::jsonb) as n", [row(2001)]);
      expect(Number(free.rows[0].n)).toBe(1);
    } finally {
      await a.query("rollback").catch(() => {});
      await Promise.all([a.end().catch(() => {}), b.end().catch(() => {})]);
    }
  });
});
