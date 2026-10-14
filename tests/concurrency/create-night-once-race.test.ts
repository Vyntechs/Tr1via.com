// Same-instant race test for the PROPOSED create_night_once function
// (supabase/proposed/20261014_create_night_once.sql). It must pass before
// that function is applied to production.
//
// PGlite has one connection and cannot show locking, so this uses the local
// Supabase Postgres (like diag-write-slots.test.ts), in a SCRATCH database of
// its own that it creates and drops: nothing in the real local database is
// touched. Without a local Supabase running it reports as skipped.
//
//   supabase start
//   npm run test:db-races -- tests/concurrency/create-night-once-race.test.ts

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INIT = readFileSync(path.join(ROOT, "supabase/migrations/0001_init.sql"), "utf8");
const CREATE_ONCE = readFileSync(
  path.join(ROOT, "supabase/proposed/20261014_create_night_once.sql"),
  "utf8",
);

const databaseUrl = process.env.TR1VIA_RACE_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const target = new URL(databaseUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(target.hostname) || target.port !== "54322" || target.pathname !== "/postgres") {
  throw new Error("TR1VIA_RACE_DATABASE_URL must target 127.0.0.1:54322/postgres (or localhost/::1 equivalent)");
}
const scratchName = `night_once_${process.pid}_${Date.now()}`;
const scratchUrl = (() => {
  const url = new URL(databaseUrl);
  url.pathname = `/${scratchName}`;
  return url.toString();
})();

let admin: Client;
let reachable = true;
const open: Client[] = [];

async function connect(): Promise<Client> {
  const client = new Client({ connectionString: scratchUrl });
  await client.connect();
  open.push(client);
  return client;
}

let codeSeq = 0;
const codes = () => Array.from({ length: 6 }, () => `R${String(++codeSeq).padStart(5, "0")}`);

async function newHost(client: Client, name: string): Promise<string> {
  const user = await client.query<{ id: string }>("insert into auth.users default values returning id");
  const host = await client.query<{ id: string }>(
    "insert into hosts (user_id, display_name) values ($1, $2) returning id",
    [user.rows[0]!.id, name],
  );
  return host.rows[0]!.id;
}

async function createOnce(client: Client, hostId: string) {
  const res = await client.query<{ night_id: string; room_code: string; reused: boolean }>(
    "select * from create_night_once($1, 'Soul Fire Pizza', null, null, $2::text[], 600)",
    [hostId, codes()],
  );
  return res.rows[0]!;
}

async function nightsFor(client: Client, hostId: string): Promise<number> {
  const res = await client.query<{ n: number }>("select count(*)::int as n from nights where host_id = $1", [hostId]);
  return res.rows[0]!.n;
}

/** Resolves to "waiting" if the promise has not settled within ms. */
async function settledWithin<T>(p: Promise<T>, ms: number): Promise<"settled" | "waiting"> {
  return Promise.race([
    p.then(() => "settled" as const, () => "settled" as const),
    new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), ms)),
  ]);
}

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
    // A fresh database has no Supabase auth schema; the roles are cluster-wide
    // and already exist in a local Supabase.
    await setup.query(`
      create schema if not exists extensions;
      create schema if not exists auth;
      create table if not exists auth.users (id uuid primary key default gen_random_uuid());
      create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
      end $$;
    `);
    await setup.query(INIT);
    // Columns later migrations add in production that the function reads.
    await setup.query(`
      alter table nights add column if not exists current_run_id uuid;
      alter table nights alter column theme_key drop not null;
      alter table nights alter column theme_key drop default;
    `);
    await setup.query(CREATE_ONCE);
  } finally {
    await setup.end();
  }
});

afterAll(async () => {
  if (!reachable) return;
  await Promise.all(open.map((c) => c.end().catch(() => undefined)));
  await admin.query(`drop database if exists ${scratchName} with (force)`);
  await admin.end();
});

describe("create_night_once under real concurrent connections", () => {
  test("a second call waits for the first, then gets the same night back", async (ctx) => {
    if (!reachable) return ctx.skip();
    const a = await connect();
    const b = await connect();
    const hostId = await newHost(a, "Heather");

    await a.query("begin");
    const first = await createOnce(a, hostId); // holds the host lock, not committed yet
    expect(first.reused).toBe(false);

    const second = createOnce(b, hostId);
    expect(await settledWithin(second, 300)).toBe("waiting");

    await a.query("commit");
    const got = await second;
    expect(got).toEqual({ night_id: first.night_id, room_code: first.room_code, reused: true });
    expect(await nightsFor(a, hostId)).toBe(1);
  });

  test("ten calls at the same instant make exactly one night with two games", async (ctx) => {
    if (!reachable) return ctx.skip();
    const clients = await Promise.all(Array.from({ length: 10 }, connect));
    const hostId = await newHost(clients[0]!, "Sarah");

    const results = await Promise.all(clients.map((c) => createOnce(c, hostId)));

    const ids = new Set(results.map((r) => r.night_id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => !r.reused)).toHaveLength(1);
    expect(await nightsFor(clients[0]!, hostId)).toBe(1);
    const games = await clients[0]!.query<{ n: number }>(
      "select count(*)::int as n from games where night_id = $1 and state = 'draft'",
      [[...ids][0]],
    );
    expect(games.rows[0]!.n).toBe(2);
  });

  test("the lock is per host: another host's night is not held up", async (ctx) => {
    if (!reachable) return ctx.skip();
    const a = await connect();
    const b = await connect();
    const hostA = await newHost(a, "Host A");
    const hostB = await newHost(a, "Host B");

    await a.query("begin");
    await createOnce(a, hostA);
    try {
      const other = createOnce(b, hostB);
      expect(await settledWithin(other, 1_000)).toBe("settled");
      expect((await other).reused).toBe(false);
    } finally {
      await a.query("commit");
    }
  });
});
