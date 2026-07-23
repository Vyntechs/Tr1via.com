// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);
const FIX = path.join(MIGRATIONS, "0031_atomic_board_slot_selection.sql");

describe("atomic board-slot selection", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
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
    await db.exec(readFileSync(path.join(MIGRATIONS, "0001_init.sql"), "utf8"));
    await db.exec(readFileSync(path.join(MIGRATIONS, "0002_rls.sql"), "utf8"));
    await db.exec(readFileSync(path.join(MIGRATIONS, "0012_swap_point_value.sql"), "utf8"));
    await db.exec(readFileSync(path.join(MIGRATIONS, "0021_live_security_gate.sql"), "utf8"));
    if (existsSync(FIX)) await db.exec(readFileSync(FIX, "utf8"));
  });

  afterAll(async () => {
    await db.close();
  });

  test("placing an edited candidate selects it and removes the displaced question", async () => {
    const user = await db.query<{ id: string }>(
      "insert into auth.users default values returning id",
    );
    const host = await db.query<{ id: string }>(
      "insert into hosts (user_id, display_name) values ($1, 'Heather') returning id",
      [user.rows[0].id],
    );
    const night = await db.query<{ id: string }>(
      "insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', 'BOARD1') returning id",
      [host.rows[0].id],
    );
    const game = await db.query<{ id: string }>(
      "insert into games (night_id, game_no) values ($1, 1) returning id",
      [night.rows[0].id],
    );
    const category = await db.query<{ id: string }>(
      "insert into categories (game_id, name, topic, position, state) values ($1, 'Tea', 'Tea', 1, 'review') returning id",
      [game.rows[0].id],
    );

    let displacedId = "";
    for (const point of [100, 200, 300, 400, 500, 600, 700]) {
      const row = await db.query<{ id: string }>(
        `insert into questions
          (category_id, difficulty, prompt, options, correct_index, source, is_picked, point_value)
         values ($1, $2, $3, '["A","B","C","D"]'::jsonb, 0, 'ai', true, $4)
         returning id`,
        [category.rows[0].id, point / 100, `Question ${point}`, point],
      );
      if (point === 700) displacedId = row.rows[0].id;
    }
    const edited = await db.query<{ id: string }>(
      `insert into questions
        (category_id, difficulty, prompt, options, correct_index, source, is_picked, point_value)
       values ($1, 7, 'Heather question', '["A","B","C","D"]'::jsonb, 0, 'host-edit', false, null)
       returning id`,
      [category.rows[0].id],
    );

    await db.query("select swap_point_value($1, 700)", [edited.rows[0].id]);

    const rows = await db.query<{ id: string; is_picked: boolean; point_value: number | null }>(
      "select id, is_picked, point_value from questions where id in ($1, $2) order by id",
      [edited.rows[0].id, displacedId],
    );
    const byId = new Map(rows.rows.map((row) => [row.id, row]));
    expect(byId.get(edited.rows[0].id)).toMatchObject({
      is_picked: true,
      point_value: 700,
    });
    expect(byId.get(displacedId)).toMatchObject({
      is_picked: false,
      point_value: null,
    });
    const count = await db.query<{ count: number }>(
      "select count(*)::int as count from questions where category_id = $1 and is_picked",
      [category.rows[0].id],
    );
    expect(count.rows[0].count).toBe(7);
  });

  test("preserves the hardened security-definer search path and service-only execution", async () => {
    const functionConfig = await db.query<{ proconfig: string[] | null }>(
      `select p.proconfig
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'swap_point_value'`,
    );
    expect(functionConfig.rows[0]?.proconfig).toContain("search_path=pg_catalog, public");

    const publicGrant = await db.query<{ allowed: boolean }>(
      "select has_function_privilege('public', 'public.swap_point_value(uuid, integer)', 'execute') as allowed",
    );
    expect(publicGrant.rows[0]?.allowed).toBe(false);
  });
});
