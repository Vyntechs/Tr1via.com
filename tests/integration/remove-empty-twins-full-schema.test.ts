// @vitest-environment node
//
// Runs the proposed empty-twin cleanup against the WHOLE real schema (every
// file in supabase/migrations, in order, on PGlite). This proves the cleanup
// names real tables and columns, that its step 0 guards find no table or
// column it does not check, and that it deletes only a true repeat-tap twin:
// never a night the host changed in any column, never one with its games
// edited, never two blank nights made on purpose seconds apart.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  areFreshGames,
  DEFAULT_VENUE_FALLBACK,
  GAME_COLUMNS,
  hiddenEmptyTwinIds,
  isUntouchedNight,
  NIGHT_COLUMNS,
  NIGHT_TWIN_WINDOW_SECONDS,
  twinCandidateIds,
  type TwinNight,
} from "@/lib/host/nightTwins";
import { loadNightTwinContent } from "@/lib/host/loadNightTwinContent";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const CLEANUP = readFileSync(
  path.join(ROOT, "supabase/proposed/20261014_remove_empty_twin_nights.sql"),
  "utf8",
);

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  // Just enough of Supabase's own schemas for the migrations to apply.
  await db.exec(`
    create schema if not exists extensions;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key default gen_random_uuid());
    create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create or replace function auth.role() returns text language sql stable as $$ select null::text $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create publication supabase_realtime;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(),
      bucket_id text, name text, owner uuid);
    create function storage.foldername(text) returns text[] language sql
      as $$ select string_to_array($1, '/') $$;
    set check_function_bodies = off;
  `);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS, file), "utf8"));
  }
}, 60_000);


// The read-only dry-run SELECT at the bottom of the file, uncommented.
function dryRunSql() {
  return (CLEANUP.split("-- DRY RUN START\n")[1] ?? "")
    .split("-- DRY RUN END")[0]!
    .split("\n")
    .map((l) => l.replace(/^-- ?/, ""))
    .join("\n");
}

async function newHost(defaultVenue: string | null = null) {
  const user = await db.query<{ id: string }>("insert into auth.users default values returning id");
  const host = await db.query<{ id: string }>(
    "insert into hosts (user_id, display_name, default_venue) values ($1, 'Heather', $2) returning id",
    [user.rows[0].id, defaultVenue],
  );
  return host.rows[0].id;
}

let codeNo = 0;
async function night(hostId: string, createdAt: string, venue = "Soul Fire Pizza") {
  const n = await db.query<{ id: string }>(
    `insert into nights (host_id, venue_name, room_code, created_at)
     values ($1, $2, $3, $4) returning id`,
    [hostId, venue, `RC${String(++codeNo).padStart(4, "0")}`, createdAt],
  );
  await db.query("insert into games (night_id, game_no) values ($1, 1), ($1, 2)", [n.rows[0].id]);
  return n.rows[0].id;
}

async function addTopic(nightId: string) {
  await db.query(
    `insert into categories (game_id, name, topic, position)
     select g.id, 'Ghosts', 'Ghosts', 1 from games g where g.night_id = $1 and g.game_no = 1`,
    [nightId],
  );
}

async function nightIds() {
  return (await db.query<{ id: string }>("select id from nights order by id")).rows.map((r) => r.id);
}

// Every way the host (or the app) can change a night or its games, each one
// applied to an EMPTY night made 1 second before a night she built in.
const NIGHT_EDITS: Record<string, string> = {
  "venue renamed": "update nights set venue_name = 'Renamed Pub' where id = $1",
  theme: "update nights set theme_key = 'halloween' where id = $1",
  date: "update nights set scheduled_at = '2026-10-16T00:00:00Z' where id = $1",
  "room magic": "update nights set room_magic_enabled = true where id = $1",
  locked: "update nights set is_locked = true where id = $1",
  "answer engine": "update nights set answer_engine = 'resilient_v1' where id = $1",
  "engine latched": "update nights set answer_engine_latched_at = now() where id = $1",
  opened: "update nights set opened_at = now() where id = $1",
  closed: "update nights set closed_at = now() where id = $1",
  "room revision": "update nights set room_revision = 1 where id = $1",
  "control revision": "update nights set control_revision = 1 where id = $1",
  "topic and question counts": "update games set category_count = 4, question_count = 5 where night_id = $1",
  "question count on game 2": "update games set question_count = 5 where night_id = $1 and game_no = 2",
  "topic count on game 1": "update games set category_count = 5 where night_id = $1 and game_no = 1",
  "game state": "update games set state = 'ready' where night_id = $1 and game_no = 1",
  "game started": "update games set started_at = now() where night_id = $1 and game_no = 1",
  "game ended": "update games set ended_at = now() where night_id = $1 and game_no = 2",
  "game 2 removed": "delete from games where night_id = $1 and game_no = 2",
};

// Seeds every case (all well over an hour old) and returns which night is the
// one true leftover twin.
async function seedAllCases() {
  const hostId = await newHost();
  const at = (hour: number, seconds: number) =>
    new Date(Date.parse("2026-09-01T00:00:00.000Z") + hour * 3_600_000 + seconds * 1000).toISOString();
  const kept: Record<string, string> = {};
  let hour = 0;
  for (const [label, sql] of Object.entries(NIGHT_EDITS)) {
    hour += 1;
    const edited = await night(hostId, at(hour, 0));
    const built = await night(hostId, at(hour, 1));
    await addTopic(built);
    await db.query(sql, [edited]);
    kept[label] = edited;
  }
  // Two blank nights made on purpose a little apart: both stay.
  kept["blank, 6s apart (older)"] = await night(hostId, at(++hour, 0));
  kept["blank, 6s apart (newer)"] = await night(hostId, at(hour, 6));
  kept["blank, 30s apart (older)"] = await night(hostId, at(++hour, 0));
  kept["blank, 30s apart (newer)"] = await night(hostId, at(hour, 30));
  // A host whose default venue changed since: these no longer look brand new.
  const movedHost = await newHost("Cleburne Taproom");
  kept["old default venue (older)"] = await night(movedHost, at(++hour, 0));
  kept["old default venue (newer)"] = await night(movedHost, at(hour, 1));
  // The one true leftover: untouched and empty, 1 second before a built night.
  const leftover = await night(hostId, at(++hour, 0));
  const builtTwin = await night(hostId, at(hour, 1));
  await addTopic(builtTwin);
  kept["built twin"] = builtTwin;
  return { leftover, kept };
}

describe("empty twin cleanup on the full migrated schema", () => {
  test("only a true repeat-tap twin goes; every night changed in any column, and blank nights made seconds apart, stay", async () => {
    const { leftover, kept } = await seedAllCases();
    const before = await nightIds();

    await db.exec(CLEANUP);
    const after = new Set(await nightIds());
    const deleted = before.filter((id) => !after.has(id));
    for (const [label, id] of Object.entries(kept)) expect(after.has(id), label).toBe(true);
    expect(deleted).toEqual([leftover]);
  });

  test("the dry run lists exactly that one night", async () => {
    await db.exec("delete from nights");
    const { leftover } = await seedAllCases();
    const listed = (await db.query<{ id: string }>(dryRunSql())).rows.map((r) => r.id);
    expect(listed).toEqual([leftover]);
  });
});

// ---- The home page rule and the cleanup must pick the same nights ----

// Rows as Supabase hands them to the app: times as ISO strings, numbers as numbers.
function plain(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k,
      v instanceof Date ? v.toISOString() : typeof v === "bigint" ? Number(v) : v,
    ]),
  );
}

// Just the query shape loadNightTwinContent uses: from().select().in().
const reader = {
  from: (table: string) => ({
    select: (cols: string) => ({
      in: async (col: string, values: string[]) => {
        const r = await db.query<Record<string, unknown>>(
          `select ${cols} from ${table} where ${col} = any($1::uuid[])`,
          [`{${values.join(",")}}`],
        );
        return { data: r.rows.map(plain), error: null };
      },
    }),
  }),
} as unknown as Pick<SupabaseClient, "from">;

// Exactly what app/host/page.tsx does for each host.
async function homePageHides(): Promise<string[]> {
  const hosts = await db.query<{ id: string; default_venue: string | null }>(
    "select id, default_venue from hosts",
  );
  const hidden: string[] = [];
  for (const h of hosts.rows) {
    const rows = (
      await db.query<Record<string, unknown>>(
        "select * from nights where host_id = $1 order by created_at desc",
        [h.id],
      )
    ).rows.map(plain) as unknown as TwinNight[];
    const rule = { defaultVenue: h.default_venue ?? DEFAULT_VENUE_FALLBACK };
    const content = await loadNightTwinContent(reader, twinCandidateIds(rows, rule));
    hidden.push(...hiddenEmptyTwinIds(rows, content, rule));
  }
  return hidden.sort();
}

describe("the home page hide rule and the cleanup agree", () => {
  test("on every case, the home page hides exactly what the dry run lists and the cleanup deletes", async () => {
    await db.exec("delete from nights");
    const { leftover } = await seedAllCases();
    const edge = await newHost();
    const expected = [leftover];
    // Same millisecond, different microseconds: neither is newer, both stay.
    await night(edge, "2026-08-01T00:00:00.524100Z");
    await night(edge, "2026-08-01T00:00:00.524400Z");
    // 5.0004 s apart: 5.000 s to the millisecond, so a twin in both rules.
    expected.push(await night(edge, "2026-08-01T01:00:00.000000Z"));
    await night(edge, "2026-08-01T01:00:05.000400Z");
    // 5.001 s apart: not a twin.
    await night(edge, "2026-08-01T02:00:00.000Z");
    await night(edge, "2026-08-01T02:00:05.001Z");
    // Three taps 3 s apart: the newest stays.
    expected.push(await night(edge, "2026-08-01T03:00:00.000Z"));
    expected.push(await night(edge, "2026-08-01T03:00:03.000Z"));
    await night(edge, "2026-08-01T03:00:06.000Z");
    // A theme picked on the first of two taps: that one stays, the
    // untouched one a second later is the leftover.
    const themed = await night(edge, "2026-08-01T04:00:00.000Z");
    await db.query("update nights set theme_key = 'halloween' where id = $1", [themed]);
    expected.push(await night(edge, "2026-08-01T04:00:01.000Z"));

    const hidden = await homePageHides();
    const listed = (await db.query<{ id: string }>(dryRunSql())).rows.map((r) => r.id).sort();
    const before = await nightIds();
    await db.exec(CLEANUP);
    const after = new Set(await nightIds());
    const deleted = before.filter((id) => !after.has(id)).sort();

    expect(listed).toEqual([...expected].sort());
    expect(hidden).toEqual(listed);
    expect(deleted).toEqual(listed);
  });

  test("the cleanup only ever keeps more: a twin made in the last hour is hidden but not deleted", async () => {
    await db.exec("delete from nights");
    const hostId = await newHost();
    const recent = await night(hostId, new Date(Date.now() - 20 * 60_000).toISOString());
    const built = await night(hostId, new Date(Date.now() - 20 * 60_000 + 1000).toISOString());
    await addTopic(built);
    expect(await homePageHides()).toEqual([recent]);
    expect((await db.query(dryRunSql())).rows).toEqual([]);
  });

  test("both name every column of the real schema, with the same 5-second window, and a brand-new night passes both", async () => {
    const columns = async (table: string) =>
      (
        await db.query<{ column_name: string }>(
          "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1",
          [table],
        )
      ).rows.map((r) => r.column_name).sort();
    const sqlList = (table: string) =>
      [...CLEANUP.split(`-- ${table} columns:`)[1]!.split(`-- end ${table} columns`)[0]!.matchAll(/'([a-z_]+)'/g)]
        .map((m) => m[1])
        .sort();
    expect(await columns("nights")).toEqual([...NIGHT_COLUMNS].sort());
    expect(await columns("games")).toEqual([...GAME_COLUMNS].sort());
    expect(sqlList("nights")).toEqual([...NIGHT_COLUMNS].sort());
    expect(sqlList("games")).toEqual([...GAME_COLUMNS].sort());
    const windows = [...CLEANUP.matchAll(/created_ms\)\)\) <= (\d+)/g)].map((m) => Number(m[1]));
    expect(windows).toEqual([NIGHT_TWIN_WINDOW_SECONDS, NIGHT_TWIN_WINDOW_SECONDS]);

    // Insert a night the way POST /api/nights does, then read it back.
    await db.exec("delete from nights");
    const hostId = await newHost();
    const created = await db.query<{ id: string }>(
      `insert into nights (host_id, venue_name, room_code, theme_key, scheduled_at)
       values ($1, 'Soul Fire Pizza', 'NEW001', null, null) returning id`,
      [hostId],
    );
    const id = created.rows[0].id;
    await db.query("insert into games (night_id, game_no) values ($1, 1), ($1, 2)", [id]);
    const row = plain((await db.query<Record<string, unknown>>("select * from nights where id = $1", [id])).rows[0]!);
    const games = (await db.query<Record<string, unknown>>("select * from games where night_id = $1", [id])).rows.map(plain);
    expect(isUntouchedNight(row as unknown as TwinNight, { defaultVenue: DEFAULT_VENUE_FALLBACK })).toBe(true);
    expect(areFreshGames(games)).toBe(true);
    const fresh = await db.query<{ id: string }>(
      CLEANUP.split("create or replace temporary view twin_fresh_empty_nights as\n")[1]!.split(";")[0]!,
    );
    expect(fresh.rows.map((r) => r.id)).toEqual([id]);
  });
});
