// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, test } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INIT = readFileSync(path.join(ROOT, "supabase/migrations/0001_init.sql"), "utf8");
const CREATE_ONCE = readFileSync(
  path.join(ROOT, "supabase/proposed/20261014_create_night_once.sql"),
  "utf8",
);
const CLEANUP = readFileSync(
  path.join(ROOT, "supabase/proposed/20261014_remove_empty_twin_nights.sql"),
  "utf8",
);

let db: PGlite;
let hostId: string;

async function newHost(name: string) {
  const user = await db.query<{ id: string }>("insert into auth.users default values returning id");
  const host = await db.query<{ id: string }>(
    "insert into hosts (user_id, display_name) values ($1, $2) returning id",
    [user.rows[0].id, name],
  );
  return host.rows[0].id;
}

async function createOnce(codes: string[], venue = "Soul Fire Pizza", host = hostId) {
  const res = await db.query<{ night_id: string; room_code: string; reused: boolean }>(
    "select * from create_night_once($1, $2, null, null, $3::text[], 600)",
    [host, venue, codes],
  );
  return res.rows[0];
}

async function count(sql: string, params: unknown[] = []) {
  const res = await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) x`, params);
  return res.rows[0].n;
}

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    create schema if not exists extensions;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key default gen_random_uuid());
    create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  `);
  await db.exec(INIT);
  // Columns/tables that later migrations add in production.
  await db.exec(`
    alter table nights add column if not exists current_run_id uuid;
    alter table nights alter column theme_key drop not null;
    alter table nights alter column theme_key drop default;
    create table if not exists question_plays (id uuid primary key default gen_random_uuid(), night_id uuid);
    create table if not exists question_generation_jobs (id uuid primary key default gen_random_uuid(), night_id uuid);
    create table if not exists question_generation_reports (id uuid primary key default gen_random_uuid(), night_id uuid);
    create table if not exists live_night_runs (night_id uuid);
    create table if not exists live_room_events (night_id uuid);
    create table if not exists live_command_receipts (night_id uuid);
    create table if not exists room_magic_reactions (night_id uuid);
  `);
  await db.exec(CREATE_ONCE);
  hostId = await newHost("Heather");
});

describe("create_night_once (proposed migration, real Postgres)", () => {
  test("first call makes one night with two draft games; a repeat call returns the same night", async () => {
    const first = await createOnce(["ZN4WJW"]);
    expect(first.reused).toBe(false);
    expect(await count("select 1 from games where night_id = $1 and state = 'draft'", [first.night_id])).toBe(2);

    const second = await createOnce(["EYBRKT"]);
    expect(second).toEqual({ night_id: first.night_id, room_code: "ZN4WJW", reused: true });
    expect(await count("select 1 from nights")).toBe(1);
    expect(await count("select 1 from games")).toBe(2);
  });

  test("once the night has a category, the next call makes a new night", async () => {
    const first = await createOnce(["ZN4WJW"]);
    await db.query(
      `insert into categories (game_id, name, topic, position)
       select id, 'Ghosts', 'Ghosts', 1 from games where night_id = $1 and game_no = 1`,
      [first.night_id],
    );
    const second = await createOnce(["EYBRKT"]);
    expect(second.reused).toBe(false);
    expect(second.night_id).not.toBe(first.night_id);
  });

  test("does not reuse across venues, hosts, or after the 10-minute window", async () => {
    const first = await createOnce(["AAAAA1"]);
    expect((await createOnce(["AAAAA2"], "Another Bar")).reused).toBe(false);
    const other = await newHost("Sarah");
    expect((await createOnce(["AAAAA3"], "Soul Fire Pizza", other)).reused).toBe(false);
    await db.query("update nights set created_at = now() - interval '11 minutes' where id = $1", [first.night_id]);
    expect((await createOnce(["AAAAA4"])).reused).toBe(false);
  });

  test("a reuse window of 0 always makes a new night (test seeding)", async () => {
    const first = await createOnce(["ZERO01"]);
    const res = await db.query<{ night_id: string; reused: boolean }>(
      "select * from create_night_once($1, 'Soul Fire Pizza', null, null, $2::text[], 0)",
      [hostId, ["ZERO02"]],
    );
    expect(res.rows[0].reused).toBe(false);
    expect(res.rows[0].night_id).not.toBe(first.night_id);
    expect(await count("select 1 from nights")).toBe(2);
  });

  test("a room-code collision moves on to the next code", async () => {
    const other = await newHost("Sarah");
    await createOnce(["TAKEN1"], "Soul Fire Pizza", other);
    const mine = await createOnce(["TAKEN1", "FREE01"]);
    expect(mine.room_code).toBe("FREE01");
    expect(mine.reused).toBe(false);
  });
});

describe("empty twin cleanup (proposed, real Postgres)", () => {
  async function night(id: string, createdAt: string, opened = false) {
    await db.query(
      `insert into nights (id, host_id, venue_name, room_code, created_at, opened_at)
       values ($1, $2, 'Soul Fire Pizza', $3, $4, $5)`,
      [id, hostId, `R${id.slice(-5)}`, createdAt, opened ? createdAt : null],
    );
    await db.query("insert into games (night_id, game_no) values ($1, 1), ($1, 2)", [id]);
  }
  const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

  test("removes only empty twins and keeps one night per cluster", async () => {
    // Heather's pair: empty first, built second (1.07s apart).
    await night(id(1), "2026-10-08T16:46:06.524Z");
    await night(id(2), "2026-10-08T16:46:07.596Z");
    await db.query(
      `insert into categories (game_id, name, topic, position)
       select g.id, 'Ghosts', 'Ghosts', 1 from games g where g.night_id = $1 and g.game_no = 1`,
      [id(2)],
    );
    // Both empty, 5.7s apart: keep the newer.
    await night(id(3), "2026-05-25T11:58:50.353Z");
    await night(id(4), "2026-05-25T11:58:56.066Z");
    // A lone empty night from weeks ago: not a twin, keep.
    await night(id(5), "2026-05-29T20:50:37.730Z");
    // Empty but opened twin: keep.
    await night(id(6), "2026-06-06T16:39:56.401Z", true);
    await night(id(7), "2026-06-06T16:40:26.068Z");
    // Empty twin with a player: keep.
    await night(id(8), "2026-07-01T02:56:53.156Z");
    await night(id(9), "2026-07-01T02:58:38.827Z");
    await db.query("insert into players (night_id, device_id, display_name) values ($1, gen_random_uuid(), 'Pat')", [id(8)]);
    // Empty twin with a generation report: keep.
    await night(id(10), "2026-08-01T01:00:00.000Z");
    await night(id(11), "2026-08-01T01:00:05.000Z");
    await db.query("insert into question_generation_reports (night_id) values ($1)", [id(10)]);

    await db.exec(CLEANUP);

    const left = await db.query<{ id: string }>("select id from nights order by created_at");
    const remaining = left.rows.map((r) => r.id);
    expect(remaining).not.toContain(id(1));
    expect(remaining).toContain(id(2));
    expect(remaining).not.toContain(id(3));
    expect(remaining).toContain(id(4));
    expect(remaining).toContain(id(5));
    expect(remaining).toContain(id(6));
    expect(remaining).not.toContain(id(7)); // empty newer twin of an opened night
    expect(remaining).toContain(id(8));
    expect(remaining).not.toContain(id(9)); // the empty one next to the night with a player
    expect(remaining).toContain(id(10));
    expect(remaining).not.toContain(id(11));
    // Deleting a night takes only its two empty game shells with it.
    expect(await count("select 1 from games")).toBe(remaining.length * 2);
    expect(await count("select 1 from categories")).toBe(1);
  });
});
