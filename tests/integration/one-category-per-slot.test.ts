// @vitest-environment node

// The proposed one-per-slot rule (supabase/proposed/20261014_one_category_per_slot.sql)
// against a real Postgres (pglite). Proves: the cleanup keeps the row every
// screen shows, removes only rows with nothing to lose, refuses to touch a
// slot that needs a person's decision, and the index then blocks a second row.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, test } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INIT = readFileSync(path.join(ROOT, "supabase/migrations/0001_init.sql"), "utf8");
const PROPOSAL = readFileSync(
  path.join(ROOT, "supabase/proposed/20261014_one_category_per_slot.sql"),
  "utf8",
);

let db: PGlite;
let gameId: string;

async function category(name: string, position: number, state: string, createdAt: string) {
  const row = await db.query<{ id: string }>(
    `insert into categories (game_id, name, topic, position, state, created_at)
     values ($1, $2, $2, $3, $4, $5) returning id`,
    [gameId, name, position, state, createdAt],
  );
  return row.rows[0].id;
}

async function question(categoryId: string, picked: boolean) {
  await db.query(
    `insert into questions (category_id, difficulty, prompt, options, correct_index, source, is_picked)
     values ($1, 1, 'Q', '["A","B","C","D"]'::jsonb, 0, 'ai', $2)`,
    [categoryId, picked],
  );
}

async function names() {
  const res = await db.query<{ name: string }>(
    "select name from categories order by position, created_at",
  );
  return res.rows.map((r) => r.name);
}

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    create schema if not exists extensions;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key default gen_random_uuid());
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.auth_uid', true), '')::uuid
    $$;
  `);
  await db.exec(INIT);
  // Stand-in for the live engine's plays table (0022); only the column the
  // cleanup reads.
  await db.exec("create table if not exists public.question_plays (category_id uuid)");
  const user = await db.query<{ id: string }>("insert into auth.users default values returning id");
  const host = await db.query<{ id: string }>(
    "insert into hosts (user_id, display_name) values ($1, 'Heather') returning id",
    [user.rows[0].id],
  );
  const night = await db.query<{ id: string }>(
    "insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', 'PF8NVJ') returning id",
    [host.rows[0].id],
  );
  const game = await db.query<{ id: string }>(
    "insert into games (night_id, game_no) values ($1, 2) returning id",
    [night.rows[0].id],
  );
  gameId = game.rows[0].id;
});

describe("proposed one-category-per-slot rule", () => {
  test("removes the unlocked extra row from the 2026-10-07 ghost stories slot and keeps the real one", async () => {
    const orphan = await category("Legendary Ghost stories", 2, "review", "2026-10-03T15:36:41Z");
    for (let i = 0; i < 20; i++) await question(orphan, false);
    const real = await category("Ghost Stories", 2, "ready", "2026-10-03T15:37:09Z");
    for (let i = 0; i < 7; i++) await question(real, true);
    await category("Pumpkins", 3, "ready", "2026-10-04T15:43:02Z");

    await db.exec(PROPOSAL);

    expect(await names()).toEqual(["Ghost Stories", "Pumpkins"]);
    const left = await db.query<{ n: number }>(
      "select count(*)::int n from questions where category_id = $1",
      [orphan],
    );
    expect(left.rows[0].n).toBe(0);
  });

  test("changes nothing when a doubled slot holds picks on both rows (needs a person's call)", async () => {
    const older = await category("Saint or Sitcom Character?", 6, "review", "2026-10-13T18:57:00Z");
    await question(older, true);
    const newer = await category("Is That Actually Catholic?", 6, "review", "2026-10-13T19:00:18Z");
    await question(newer, true);

    await expect(db.exec(PROPOSAL)).rejects.toThrow();
    await db.exec("rollback").catch(() => undefined);

    expect(await names()).toEqual(["Saint or Sitcom Character?", "Is That Actually Catholic?"]);
  });

  test("after the rule is in, a second row in a filled slot is refused with a duplicate-key error", async () => {
    await category("Haunted Highways", 2, "ready", "2026-10-03T15:36:18Z");
    await db.exec(PROPOSAL);

    let code: string | undefined;
    try {
      await category("haunted highways", 2, "draft", "2026-10-03T15:37:00Z");
    } catch (err) {
      code = (err as { code?: string }).code;
    }
    expect(code).toBe("23505");
    // A different slot in the same game is still fine.
    await category("Horror movies", 6, "draft", "2026-10-03T16:40:02Z");
    expect(await names()).toEqual(["Haunted Highways", "Horror movies"]);
  });
});
