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
    alter table nights add column if not exists answer_engine_latched_at timestamptz;
    alter table nights add column if not exists room_revision bigint not null default 0;
    alter table nights add column if not exists control_revision bigint not null default 0;
    alter table nights add column if not exists room_magic_enabled boolean not null default false;
    alter table nights add column if not exists answer_engine text not null default 'legacy';
    alter table question_generation_jobs add column if not exists game_id uuid;
    alter table question_generation_reports add column if not exists game_id uuid;
    create table if not exists question_play_eligibility (night_id uuid);
    create table if not exists live_command_receipt_archive (night_id uuid references nights on delete cascade);
    create table if not exists surface_observations (night_id uuid references nights on delete cascade);
    create table if not exists diag_server_actions (night_id uuid);
    create table if not exists diag_device_events (night_id uuid);
    create table if not exists diag_answer_events (night_id uuid);
    create table if not exists diag_quota (night_id uuid);
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
    // Both empty, 5.7s apart: more than 5 seconds, so not a repeat tap. Keep both.
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
    expect(remaining).toContain(id(3));
    expect(remaining).toContain(id(4));
    expect(remaining).toContain(id(5));
    expect(remaining).toContain(id(6));
    expect(remaining).toContain(id(7)); // 30s after an opened night: not a repeat tap
    expect(remaining).toContain(id(8));
    expect(remaining).toContain(id(9)); // 105s after a night with a player: not a repeat tap
    expect(remaining).toContain(id(10));
    expect(remaining).not.toContain(id(11)); // 5.0s after a night with a report
    // Deleting a night takes only its two empty game shells with it.
    expect(await count("select 1 from games")).toBe(remaining.length * 2);
    expect(await count("select 1 from categories")).toBe(1);
  });

  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  async function remainingIds() {
    const left = await db.query<{ id: string }>("select id from nights order by created_at");
    return left.rows.map((r) => r.id);
  }

  test("keeps empty twins made in the last hour (someone may be setting one up right now)", async () => {
    await night(id(1), minutesAgo(5));
    await night(id(2), minutesAgo(4.9));
    await night(id(3), minutesAgo(59));
    await night(id(4), minutesAgo(58.5));
    await db.exec(CLEANUP);
    expect(await remainingIds()).toEqual([id(3), id(4), id(1), id(2)]);
  });

  test("keeps a night that anything at all points at (TV records, archives, logs, scores)", async () => {
    const markers = [
      "insert into surface_observations (night_id) values ($1)",
      "insert into live_command_receipt_archive (night_id) values ($1)",
      "insert into diag_server_actions (night_id) values ($1)",
      "insert into diag_device_events (night_id) values ($1)",
      "insert into question_play_eligibility (night_id) values ($1)",
      "update nights set room_revision = 1 where id = $1",
      "update nights set answer_engine_latched_at = now() where id = $1",
      `insert into adjustments (game_id, player_id, delta, reason)
         select g.id, null, 0, 'x' from games g where g.night_id = $1 and g.game_no = 1`,
    ];
    // An adjustment normally belongs to a player; let it stand alone here so
    // the only thing on the night is the adjustment itself.
    await db.exec("alter table adjustments alter column player_id drop not null");
    for (const [i, sql] of markers.entries()) {
      const older = id(100 + i * 2);
      await night(older, `2026-09-0${1 + i}T0${i}:00:00.000Z`);
      await night(id(101 + i * 2), `2026-09-0${1 + i}T0${i}:00:02.000Z`);
      await db.query(sql, [older]);
    }
    await db.exec(CLEANUP);
    const remaining = await remainingIds();
    for (let i = 0; i < markers.length; i++) {
      expect(remaining, markers[i]).toContain(id(100 + i * 2));
    }
  });

  test("never deletes a twin the host edited (theme, room magic, date, venue, game counts), even next to a newer untouched one", async () => {
    const edits = [
      "update nights set theme_key = 'halloween' where id = $1",
      "update nights set room_magic_enabled = true where id = $1",
      "update nights set scheduled_at = '2026-10-16T00:00:00Z' where id = $1",
      "update nights set venue_name = 'Renamed Pub' where id = $1",
      "update games set category_count = 4, question_count = 5 where night_id = $1",
      "update games set question_count = 5 where night_id = $1 and game_no = 2",
    ];
    for (const [i, sql] of edits.entries()) {
      const edited = id(200 + i * 2);
      await night(edited, `2026-08-1${i}T01:00:00.000Z`);
      await night(id(201 + i * 2), `2026-08-1${i}T01:00:02.000Z`);
      await db.query(sql, [edited]);
    }
    await db.exec(CLEANUP);
    const remaining = await remainingIds();
    for (let i = 0; i < edits.length; i++) {
      expect(remaining, edits[i]).toContain(id(200 + i * 2));
      // Same rule as the home page: the edited night is the one that stays,
      // so the untouched empty night 2 seconds after it is the leftover.
      // (Except after a rename: the two are at different venues, so not twins.)
      if (edits[i]!.includes("Renamed Pub")) expect(remaining).toContain(id(201 + i * 2));
      else expect(remaining, edits[i]).not.toContain(id(201 + i * 2));
    }
  });

  test("refuses to run if nights or games has a column it does not compare", async () => {
    await night(id(1), "2026-10-08T16:46:06.524Z");
    await night(id(2), "2026-10-08T16:46:07.596Z");
    await db.exec("alter table games add column brand_new_setting text");
    await expect(db.exec(CLEANUP)).rejects.toThrow(/games\.brand_new_setting/);
    await db.exec("rollback").catch(() => undefined);
    expect(await count("select 1 from nights")).toBe(2);
  });

  test("refuses to run if a table it does not know points at nights", async () => {
    await night(id(1), "2026-10-08T16:46:06.524Z");
    await night(id(2), "2026-10-08T16:46:07.596Z");
    await db.exec("create table brand_new_thing (night_id uuid references nights on delete cascade)");
    await expect(db.exec(CLEANUP)).rejects.toThrow(/brand_new_thing/);
    await db.exec("rollback").catch(() => undefined);
    expect(await count("select 1 from nights")).toBe(2);
  });

  test("the delete re-checks: a player who joins after the list is made keeps the night", async () => {
    const [beforeDelete, deleteAndCommit] = CLEANUP.split("-- 5. Delete,");
    expect(deleteAndCommit).toBeDefined();
    await night(id(1), "2026-10-08T16:46:06.524Z");
    await night(id(2), "2026-10-08T16:46:07.596Z");
    await db.exec(beforeDelete);
    // id(1) is on the delete list now; a player lands on it before the delete.
    expect(await count("select 1 from twin_nights_to_delete where id = $1", [id(1)])).toBe(1);
    await db.query("insert into players (night_id, device_id, display_name) values ($1, gen_random_uuid(), 'Pat')", [id(1)]);
    await db.exec(`-- 5. Delete,${deleteAndCommit}`);
    expect(await remainingIds()).toEqual([id(1), id(2)]);
  });

  test("the dry run lists exactly what the cleanup deletes", async () => {
    await night(id(1), "2026-10-08T16:46:06.524Z");
    await night(id(2), "2026-10-08T16:46:07.596Z");
    await db.query(
      `insert into categories (game_id, name, topic, position)
       select g.id, 'Ghosts', 'Ghosts', 1 from games g where g.night_id = $1 and g.game_no = 1`,
      [id(2)],
    );
    await night(id(3), "2026-05-25T11:58:50.353Z");
    await night(id(4), "2026-05-25T11:58:56.066Z");
    await night(id(5), minutesAgo(3));
    await night(id(6), minutesAgo(2.9));
    await night(id(7), "2026-05-29T20:50:37.730Z");
    const dryRun = CLEANUP.split("-- DRY RUN START\n")[1]!
      .split("-- DRY RUN END")[0]!
      .split("\n")
      .map((l) => l.replace(/^-- ?/, ""))
      .join("\n");
    const listed = (await db.query<{ id: string }>(dryRun)).rows.map((r) => r.id).sort();
    const before = await remainingIds();
    await db.exec(CLEANUP);
    const after = new Set(await remainingIds());
    const deleted = before.filter((x) => !after.has(x)).sort();
    expect(listed).toEqual([id(1)]); // id(3)/id(4) are 5.7s apart: both kept
    expect(deleted).toEqual(listed);
  });
});
