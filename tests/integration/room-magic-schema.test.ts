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
  `);
  await db.exec(readFileSync(path.join(MIGRATIONS_DIR, "0001_init.sql"), "utf8"));
  await db.exec(`
    grant usage on schema public to anon, authenticated, service_role;
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    grant all on all tables in schema public to service_role;
    grant execute on all functions in schema public to anon, authenticated, service_role;
  `);
  await db.exec(readFileSync(path.join(MIGRATIONS_DIR, "0017_room_magic_v1.sql"), "utf8"));
  return db;
}

describe("room magic schema", () => {
  let db: PGlite;
  let nightId: string;
  let gameId: string;
  let questionId: string;
  let playerId: string;

  beforeAll(async () => {
    db = await freshDb();
    const one = async <T>(sql: string, params: unknown[] = []) =>
      (await db.query<T>(sql, params)).rows[0];
    const id = async (sql: string, params: unknown[] = []) =>
      (await one<{ id: string }>(sql + " returning id", params)).id;

    const hostUserId = (await one<{ id: string }>("insert into auth.users default values returning id")).id;
    const hostId = await id("insert into hosts (user_id, display_name) values ($1, 'Host')", [hostUserId]);
    nightId = await id("insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', 'ROOM01')", [hostId]);
    gameId = await id("insert into games (night_id, game_no) values ($1, 1)", [nightId]);
    const categoryId = await id("insert into categories (game_id, name, topic, position) values ($1, 'Cat', 'Topic', 0)", [gameId]);
    questionId = await id(
      `insert into questions (
         category_id, point_value, prompt, options, correct_index, is_picked,
         played_at, finished_at
       ) values (
         $1, 100, 'Prompt?', '["A","B","C","D"]'::jsonb, 0, true,
         now() - interval '1 minute', now()
       )`,
      [categoryId],
    );
    playerId = await id(
      "insert into players (night_id, device_id, display_name) values ($1, gen_random_uuid(), 'Player')",
      [nightId],
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  test("nights has a default-off room magic setting", async () => {
    const nightsColumn = await db.query<{ column_default: string; is_nullable: string }>(
      `select column_default, is_nullable
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'nights'
         and column_name = 'room_magic_enabled'`,
    );

    expect(nightsColumn.rows[0]?.column_default).toContain("false");
    expect(nightsColumn.rows[0]?.is_nullable).toBe("NO");

    const insertedNight = await db.query<{ room_magic_enabled: boolean }>(
      "select room_magic_enabled from nights where id = $1",
      [nightId],
    );
    expect(insertedNight.rows[0]?.room_magic_enabled).toBe(false);
  });

  test("the reaction receipt table exists with RLS enabled", async () => {
    const reactionTable = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity
       from pg_class
       where relname = 'room_magic_reactions'`,
    );

    expect(reactionTable.rows[0]?.relrowsecurity).toBe(true);
  });

  test("table grants keep reaction receipts server-only", async () => {
    const r = await db.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type
       from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'room_magic_reactions'
         and grantee in ('anon', 'authenticated', 'service_role')
       order by grantee, privilege_type`,
    );

    const grantsByRole = new Map<string, string[]>();
    for (const row of r.rows) {
      const grants = grantsByRole.get(row.grantee) ?? [];
      grants.push(row.privilege_type);
      grantsByRole.set(row.grantee, grants);
    }

    expect(grantsByRole.get("anon") ?? []).toEqual([]);
    expect(grantsByRole.get("authenticated") ?? []).toEqual([]);
    expect(grantsByRole.get("service_role")).toContain("INSERT");
  });

  test("one player can send only one reaction per question reveal", async () => {
    await db.query(
      `insert into room_magic_reactions (
         night_id, game_id, question_id, player_id, kind
       ) values ($1, $2, $3, $4, 'wow')`,
      [nightId, gameId, questionId, playerId],
    );

    await expect(
      db.query(
        `insert into room_magic_reactions (
           night_id, game_id, question_id, player_id, kind
         ) values ($1, $2, $3, $4, 'applause')`,
        [nightId, gameId, questionId, playerId],
      ),
    ).rejects.toThrow(/duplicate key value violates unique constraint|unique/i);
  });
});
