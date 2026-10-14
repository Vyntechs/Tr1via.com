// @vitest-environment node
//
// Runs the proposed empty-twin cleanup against the WHOLE real schema (every
// file in supabase/migrations, in order, on PGlite). This proves the cleanup
// names real tables and columns, and that its step 0 guard finds no table
// pointing at nights or games that the cleanup does not check.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, test } from "vitest";

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

describe("empty twin cleanup on the full migrated schema", () => {
  test("every table pointing at nights or games is checked, and only the empty twin goes", async () => {
    const user = await db.query<{ id: string }>("insert into auth.users default values returning id");
    const host = await db.query<{ id: string }>(
      "insert into hosts (user_id, display_name) values ($1, 'Heather') returning id",
      [user.rows[0].id],
    );
    const hostId = host.rows[0].id;
    const ids: string[] = [];
    for (const [code, at] of [
      ["EMPTY1", "2026-10-08T16:46:06.524Z"],
      ["BUILT1", "2026-10-08T16:46:07.596Z"],
    ]) {
      const n = await db.query<{ id: string }>(
        `insert into nights (host_id, venue_name, room_code, created_at)
         values ($1, 'Soul Fire Pizza', $2, $3) returning id`,
        [hostId, code, at],
      );
      ids.push(n.rows[0].id);
      await db.query("insert into games (night_id, game_no) values ($1, 1), ($1, 2)", [n.rows[0].id]);
    }
    await db.query(
      `insert into categories (game_id, name, topic, position)
       select g.id, 'Ghosts', 'Ghosts', 1 from games g where g.night_id = $1 and g.game_no = 1`,
      [ids[1]],
    );

    await db.exec(CLEANUP);

    const left = await db.query<{ id: string }>("select id from nights");
    expect(left.rows.map((r) => r.id)).toEqual([ids[1]]);
  });
});
