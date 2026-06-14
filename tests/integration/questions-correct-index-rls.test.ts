// @vitest-environment node
//
// questions.correct_index must never reach a player — REAL Postgres, not mocks.
//
// Why this exists: the questions_player_read RLS policy (0002_rls.sql) gates a
// player's SELECT on the questions row on `played_at` (question is LIVE), and
// RLS is row-level / column-blind — so the instant the host hits Reveal, any
// joined player's `anon` connection can read EVERY column of the live question,
// including correct_index (the answer), via a hand-written query. The app's
// PLAYER_QUESTION_COLUMNS allowlist (lib/hooks/useRoom.ts) is a client-side-only
// curtain; the database is the lock, and it was open for the whole answer window.
//
// This runs the ACTUAL migrations (0001 + 0002 + the fix) on in-process Postgres
// (pglite — WASM, no Docker/CLI/cloud) and reproduces the real role model:
//   * players  → `anon` role + an x-tr1via-device header (current_device_id())
//   * host     → `authenticated` role + auth.uid() owning the night
// then asserts the answer is unreadable by the player at the DB layer while the
// live render columns and the host's full access are preserved.
//
// RED→GREEN: with only 0001 + 0002 applied (the leak as shipped) the player CAN
// read correct_index and these tests FAIL. They pass once the fix migration
// revokes the column from the player (`anon`) role.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);

// Apply 0001 (schema) + 0002 (RLS) + any later migration that revokes the
// player role's column access on questions (the fix). Matching on content keeps
// the test honest if the fix file is renamed; the regex is specific enough that
// no other migration (which only ever `revoke ... on function`) matches.
const QUESTIONS_COLUMN_FIX = /revoke\s+select\s+on\s+questions/i;

async function freshRlsDb(): Promise<PGlite> {
  const db = new PGlite();

  // Supabase-platform stubs so 0001/0002 apply in bare Postgres: the extensions
  // schema 0001 puts on the search_path, the auth.users table hosts FK to, an
  // auth.uid() that reads a test-controlled GUC, and the three Supabase roles.
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

  // Replicate Supabase's default grants: anon + authenticated get table-level
  // SELECT on everything (this is the relation-wide grant that, combined with
  // RLS, leaks correct_index today); service_role bypasses RLS entirely.
  await db.exec(`
    grant usage on schema public to anon, authenticated, service_role;
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    grant all on all tables in schema public to service_role;
    grant execute on all functions in schema public to anon, authenticated, service_role;
  `);

  await db.exec(readFileSync(path.join(MIGRATIONS_DIR, "0002_rls.sql"), "utf8"));

  for (const f of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f > "0002_rls.sql")
    .sort()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    if (QUESTIONS_COLUMN_FIX.test(sql)) await db.exec(sql);
  }

  return db;
}

describe("questions.correct_index is unreadable by a player at the database layer", () => {
  let db: PGlite;
  let liveQId: string;
  let hostUserId: string;
  const deviceId = "11111111-1111-1111-1111-111111111111";

  // Run a query as a given Postgres role with the production identity GUCs set
  // (x-tr1via-device for players, test.auth_uid for the host), always resetting
  // the session afterwards even if the query is denied.
  async function runAs(
    role: "anon" | "authenticated",
    ctx: { device?: string; authUid?: string },
    sql: string,
    params: unknown[] = [],
  ) {
    const headers = ctx.device ? JSON.stringify({ "x-tr1via-device": ctx.device }) : "{}";
    await db.exec(`select set_config('request.headers', '${headers}', false);`);
    await db.exec(`select set_config('test.auth_uid', '${ctx.authUid ?? ""}', false);`);
    await db.exec(`set role ${role};`);
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec(
        `reset role; select set_config('request.headers', '', false); select set_config('test.auth_uid', '', false);`,
      );
    }
  }

  beforeAll(async () => {
    db = await freshRlsDb();

    const id = async (sql: string, params: unknown[] = []) =>
      (await db.query<{ id: string }>(sql + " returning id", params)).rows[0].id;

    hostUserId = (await db.query<{ id: string }>("insert into auth.users default values returning id")).rows[0].id;
    const hostId = await id("insert into hosts (user_id, display_name) values ($1, 'Host')", [hostUserId]);
    const nightId = await id(
      "insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', 'ROOM01')",
      [hostId],
    );
    const gameId = await id("insert into games (night_id, game_no) values ($1, 1)", [nightId]);
    const catId = await id(
      "insert into categories (game_id, name, topic, position) values ($1, 'cat', 't', 0)",
      [gameId],
    );
    // A LIVE question: revealed (played_at set), not yet resolved (finished_at
    // null). correct_index = 2 is the secret the answer window must protect.
    liveQId = await id(
      `insert into questions (category_id, point_value, prompt, options, correct_index, is_picked, played_at)
       values ($1, 100, 'Capital of France?', $2::jsonb, 2, true, now())`,
      [catId, '["Lyon","Nice","Paris","Brest"]'],
    );
    // A player joined to this night on the known device.
    await db.query(
      "insert into players (night_id, device_id, display_name) values ($1, $2, 'Pat')",
      [nightId, deviceId],
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  test("a joined player cannot read correct_index of the LIVE question", async () => {
    await expect(
      runAs("anon", { device: deviceId }, "select correct_index from questions where id = $1", [liveQId]),
    ).rejects.toThrow(/correct_index|permission denied/i);
  });

  test("a joined player CAN still read the live-render columns (prompt/options) — the answer screen is unaffected", async () => {
    const r = await runAs(
      "anon",
      { device: deviceId },
      "select id, prompt, options, played_at, finished_at from questions where id = $1",
      [liveQId],
    );
    expect(r.rows).toHaveLength(1);
  });

  test("the night host (authenticated) CAN still read correct_index — Heather's console is unaffected", async () => {
    const r = await runAs(
      "authenticated",
      { authUid: hostUserId },
      "select correct_index from questions where id = $1",
      [liveQId],
    );
    expect((r.rows[0] as { correct_index: number }).correct_index).toBe(2);
  });

  test("even after the question resolves, the player still cannot read correct_index directly (it reaches them only via the server)", async () => {
    await db.query("select resolve_question($1)", [liveQId]);
    await expect(
      runAs("anon", { device: deviceId }, "select correct_index from questions where id = $1", [liveQId]),
    ).rejects.toThrow(/correct_index|permission denied/i);
  });
});
