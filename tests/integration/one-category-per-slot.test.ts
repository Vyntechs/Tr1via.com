// @vitest-environment node

// The proposed one-per-slot rule (supabase/proposed/20261014_one_category_per_slot.sql)
// against a real Postgres (pglite) WITH the real board guard from 0031
// (fence_category_authoring), which refuses to change or delete a category
// once its game is live or done. Proves: the cleanup keeps the row every
// screen shows, removes only rows with nothing to lose in games that have not
// started, leaves started/finished games exactly as they are (and the guard
// still works afterward), stops when a not-started game needs a person's call,
// and the index then blocks a second row in every slot.
//
// Also covers the host's own delete (DELETE /api/categories/:id is a plain
// delete on the row, so the guard decides): allowed while the game is in
// setup, refused once it is live or done.
//
// ONE_PER_SLOT_SQL can point at another copy of the proposal (used to check
// that these tests fail on the earlier version of the file).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const GUARD = "0031_atomic_board_slot_selection.sql";
const CHAIN = [
  "0001_init.sql",
  "0002_rls.sql",
  "0012_swap_point_value.sql",
  "0015_question_generation_reports.sql",
  "0016_question_generation_reports_privileges.sql",
  "0019_question_generation_jobs.sql",
  "0020_question_generation_jobs_advisor_fixes.sql",
  "0021_live_security_gate.sql",
  "0022_live_answer_engine_schema.sql",
  "0029_generation_attempt_fencing.sql",
  GUARD,
];
const PROPOSAL = readFileSync(
  process.env.ONE_PER_SLOT_SQL ??
    path.join(ROOT, "supabase/proposed/20261014_one_category_per_slot.sql"),
  "utf8",
);

const GUARD_MESSAGE = "the board cannot change after its game starts";

let db: PGlite;
let nightId: string;

async function game(gameNo: number) {
  const row = await db.query<{ id: string }>(
    "insert into games (night_id, game_no) values ($1, $2) returning id",
    [nightId, gameNo],
  );
  return row.rows[0].id;
}

// Rows are seeded while the game is still in setup (the guard refuses inserts
// into a started game), then the game is moved on.
async function setGameState(gameId: string, state: "draft" | "ready" | "live" | "done") {
  await db.query("update games set state = $2 where id = $1", [gameId, state]);
}

async function category(
  gameId: string,
  name: string,
  position: number,
  state: string,
  createdAt: string,
) {
  const row = await db.query<{ id: string }>(
    `insert into categories (game_id, name, topic, position, state, created_at)
     values ($1, $2, $2, $3, $4, $5) returning id`,
    [gameId, name, position, state, createdAt],
  );
  return row.rows[0].id;
}

async function questions(categoryId: string, count: number, picked: boolean) {
  for (let i = 0; i < count; i++) {
    await db.query(
      `insert into questions (category_id, difficulty, prompt, options, correct_index, source, is_picked)
       values ($1, 1, $2, '["A","B","C","D"]'::jsonb, 0, 'ai', $3)`,
      [categoryId, `Q${i}`, picked],
    );
  }
}

async function names(gameId: string) {
  const res = await db.query<{ name: string }>(
    "select name from categories where game_id = $1 order by position, created_at",
    [gameId],
  );
  return res.rows.map((r) => r.name);
}

async function indexExists() {
  const res = await db.query<{ n: number }>(
    "select count(*)::int n from pg_indexes where indexname = 'categories_one_per_slot'",
  );
  return res.rows[0].n === 1;
}

async function errorOf(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (err) {
    return err as { code?: string; message?: string };
  }
  return null;
}

async function applyProposal() {
  const err = await errorOf(() => db.exec(PROPOSAL));
  if (err) await db.exec("rollback").catch(() => undefined);
  return err;
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
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create publication supabase_realtime;
  `);
  for (const migration of CHAIN) {
    await db.exec(readFileSync(path.join(MIGRATIONS, migration), "utf8"));
  }
  const user = await db.query<{ id: string }>("insert into auth.users default values returning id");
  const host = await db.query<{ id: string }>(
    "insert into hosts (user_id, display_name) values ($1, 'Heather') returning id",
    [user.rows[0].id],
  );
  const night = await db.query<{ id: string }>(
    "insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', 'PF8NVJ') returning id",
    [host.rows[0].id],
  );
  nightId = night.rows[0].id;
});

afterEach(async () => {
  await db.close();
});

describe("test setup", () => {
  test("loads the real board guard (0031) and the real plays table (0022)", async () => {
    expect(existsSync(path.join(MIGRATIONS, GUARD))).toBe(true);
    const trig = await db.query<{ n: number }>(
      "select count(*)::int n from pg_trigger where tgname = 'fence_category_authoring'",
    );
    expect(trig.rows[0].n).toBe(1);
    const plays = await db.query<{ n: number }>(
      "select count(*)::int n from information_schema.columns where table_name = 'question_plays' and column_name = 'run_id'",
    );
    expect(plays.rows[0].n).toBe(1);
  });
});

describe("proposed one-category-per-slot rule", () => {
  test("a finished game's doubled slot (the 2026-10-07 shape) is left alone and the rule still goes in", async () => {
    const g = await game(2);
    const orphan = await category(g, "Legendary Ghost stories", 2, "review", "2026-10-03T15:36:41Z");
    await questions(orphan, 20, false);
    const real = await category(g, "Ghost Stories", 2, "ready", "2026-10-03T15:37:09Z");
    await questions(real, 7, true);
    await category(g, "Pumpkins", 3, "ready", "2026-10-04T15:43:02Z");
    await setGameState(g, "done");

    expect(await applyProposal()).toBeNull();

    expect(await names(g)).toEqual(["Legendary Ghost stories", "Ghost Stories", "Pumpkins"]);
    expect(await indexExists()).toBe(true);
    // The guard is untouched: the finished game's row still cannot be deleted.
    const err = await errorOf(() => db.query("delete from categories where id = $1", [orphan]));
    expect(err?.code).toBe("55000");
    expect(err?.message).toContain(GUARD_MESSAGE);
  });

  test("a live game's doubled slot with picks on both rows (Sarah's Oct 13 shape) is left alone too", async () => {
    const g = await game(1);
    const older = await category(g, "Saint or Sitcom Character?", 6, "review", "2026-10-13T18:57:00Z");
    await questions(older, 2, true);
    const newer = await category(g, "Is That Actually Catholic?", 6, "review", "2026-10-13T19:00:18Z");
    await questions(newer, 3, true);
    await setGameState(g, "live");

    expect(await applyProposal()).toBeNull();

    expect(await names(g)).toEqual(["Saint or Sitcom Character?", "Is That Actually Catholic?"]);
    expect(await indexExists()).toBe(true);
  });

  test("locks categories and questions before ranking, and holds them until the end", async () => {
    // Order in the file: lock_timeout, then the table lock, then the ranking.
    const timeoutAt = PROPOSAL.indexOf("set local lock_timeout");
    const lockAt = PROPOSAL.search(
      /lock table public\.categories, public\.questions in share row exclusive mode;/,
    );
    const rankAt = PROPOSAL.indexOf("create temp table one_per_slot_ranked");
    expect(PROPOSAL.indexOf("begin;")).toBeLessThan(timeoutAt);
    expect(timeoutAt).toBeGreaterThan(-1);
    expect(lockAt).toBeGreaterThan(timeoutAt);
    expect(rankAt).toBeGreaterThan(lockAt);

    // Run everything except the final commit, then look at the locks held.
    const g = await game(2);
    const orphan = await category(g, "Legendary Ghost stories", 2, "review", "2026-10-03T15:36:41Z");
    await questions(orphan, 20, false);
    const real = await category(g, "Ghost Stories", 2, "ready", "2026-10-03T15:37:09Z");
    await questions(real, 7, true);
    const commitAt = PROPOSAL.lastIndexOf("commit;");
    await db.exec(PROPOSAL.slice(0, commitAt));
    const held = await db.query<{ rel: string }>(
      `select relation::regclass::text rel from pg_locks
       where locktype = 'relation' and mode = 'ShareRowExclusiveLock' and granted
       order by 1`,
    );
    expect(held.rows.map((r) => r.rel)).toEqual(["categories", "questions"]);
    await db.exec("rollback");
    // Rolled back: both rows are still there and no index was built.
    expect(await names(g)).toHaveLength(2);
    expect(await indexExists()).toBe(false);
  });

  test("what a removed extra row takes with it: its unpicked questions and its job", async () => {
    const g = await game(2);
    const orphan = await category(g, "Legendary Ghost stories", 2, "review", "2026-10-03T15:36:41Z");
    await questions(orphan, 20, false);
    await db.query(
      `insert into question_generation_jobs (category_id, game_id, night_id, host_id, phase, target_count)
       select $1, $2, n.id, n.host_id, 'ready', 20 from nights n where n.id = $3`,
      [orphan, g, nightId],
    );
    const real = await category(g, "Ghost Stories", 2, "ready", "2026-10-03T15:37:09Z");
    await questions(real, 7, true);

    expect(await applyProposal()).toBeNull();
    const left = await db.query<{ q: number; j: number }>(
      `select (select count(*)::int from questions where category_id = $1) q,
              (select count(*)::int from question_generation_jobs where category_id = $1) j`,
      [orphan],
    );
    expect(left.rows[0]).toEqual({ q: 0, j: 0 });
    // The kept row's picked questions are untouched.
    const kept = await db.query<{ n: number }>(
      "select count(*)::int n from questions where category_id = $1 and is_picked",
      [real],
    );
    expect(kept.rows[0].n).toBe(7);
  });

  test("in a game still in setup, the unlocked extra row is removed and the real one kept", async () => {
    const g = await game(2);
    const orphan = await category(g, "Legendary Ghost stories", 2, "review", "2026-10-03T15:36:41Z");
    await questions(orphan, 20, false);
    const real = await category(g, "Ghost Stories", 2, "ready", "2026-10-03T15:37:09Z");
    await questions(real, 7, true);
    await setGameState(g, "ready");

    expect(await applyProposal()).toBeNull();

    expect(await names(g)).toEqual(["Ghost Stories"]);
    const left = await db.query<{ n: number }>(
      "select count(*)::int n from questions where category_id = $1",
      [orphan],
    );
    expect(left.rows[0].n).toBe(0);
  });

  test("keeps a filled older row and removes the newer empty one (the Back-button double)", async () => {
    const g = await game(1);
    const filled = await category(g, "Ghosts", 4, "review", "2026-10-14T18:00:00Z");
    await questions(filled, 7, true);
    await questions(filled, 13, false);
    const empty = await category(g, "ghosts", 4, "review", "2026-10-14T18:01:00Z");
    await questions(empty, 20, false);

    expect(await applyProposal()).toBeNull();

    const rows = await db.query<{ id: string }>("select id from categories where position = 4");
    expect(rows.rows.map((r) => r.id)).toEqual([filled]);
    const picked = await db.query<{ n: number }>(
      "select count(*)::int n from questions where category_id = $1 and is_picked",
      [filled],
    );
    expect(picked.rows[0].n).toBe(7);
  });

  test("a game still in setup with picks on both rows stops the whole thing and names the rows", async () => {
    const g = await game(1);
    const finished = await game(2);
    const done1 = await category(finished, "Old A", 1, "ready", "2026-10-07T18:00:00Z");
    await category(finished, "Old B", 1, "review", "2026-10-07T18:01:00Z");
    await questions(done1, 7, true);
    await setGameState(finished, "done");
    const older = await category(g, "Saint or Sitcom Character?", 6, "review", "2026-10-13T18:57:00Z");
    await questions(older, 1, true);
    const newer = await category(g, "Is That Actually Catholic?", 6, "review", "2026-10-13T19:00:18Z");
    await questions(newer, 1, true);
    // Slot 5: an empty extra row the cleanup would delete, if it got that far.
    await category(g, "Spare", 5, "draft", "2026-10-13T19:01:00Z");
    await category(g, "Spare again", 5, "ready", "2026-10-13T19:02:00Z");

    const err = await applyProposal();
    expect(err?.message).toContain("has not started");
    expect(err?.message).toContain(older);

    // Rolled back: nothing deleted anywhere, no index.
    expect(await names(g)).toEqual([
      "Spare",
      "Spare again",
      "Saint or Sitcom Character?",
      "Is That Actually Catholic?",
    ]);
    expect(await names(finished)).toEqual(["Old A", "Old B"]);
    expect(await indexExists()).toBe(false);
  });

  test("after the rule is in, a second row in a filled slot is refused with a duplicate-key error", async () => {
    const g = await game(1);
    await category(g, "Haunted Highways", 2, "ready", "2026-10-03T15:36:18Z");
    expect(await applyProposal()).toBeNull();

    const err = await errorOf(() =>
      category(g, "haunted highways", 2, "draft", "2026-10-03T15:37:00Z"),
    );
    expect(err?.code).toBe("23505");
    // A different slot in the same game is still fine.
    await category(g, "Horror movies", 6, "draft", "2026-10-03T16:40:02Z");
    expect(await names(g)).toEqual(["Haunted Highways", "Horror movies"]);
  });

  test("the row a left-alone slot shows is still covered: no third row can join it", async () => {
    const g = await game(2);
    const orphan = await category(g, "Legendary Ghost stories", 2, "review", "2026-10-03T15:36:41Z");
    await questions(orphan, 20, false);
    const real = await category(g, "Ghost Stories", 2, "ready", "2026-10-03T15:37:09Z");
    await questions(real, 7, true);
    await setGameState(g, "done");
    expect(await applyProposal()).toBeNull();

    // Even if that game were sent back to setup, the shown row is in the
    // index, so a new row in slot 2 is still refused.
    await setGameState(g, "draft");
    const err = await errorOf(() => category(g, "ghosts again", 2, "draft", "2026-10-15T12:00:00Z"));
    expect(err?.code).toBe("23505");
  });
});

describe("host deletes a category (what DELETE /api/categories/:id runs)", () => {
  async function reviewCategoryWithNoPicks(state: "draft" | "ready" | "live" | "done") {
    const g = await game(1);
    const id = await category(g, "Is That Actually Catholic?", 6, "review", "2026-10-13T19:00:18Z");
    await questions(id, 20, false);
    await setGameState(g, state);
    return id;
  }

  test.each(["draft", "ready"] as const)(
    "works while the game is in setup (%s): category and its questions are gone",
    async (state) => {
      const id = await reviewCategoryWithNoPicks(state);
      await db.query("delete from categories where id = $1", [id]);
      const left = await db.query<{ n: number }>(
        "select (select count(*) from categories where id = $1) + (select count(*) from questions where category_id = $1) as n",
        [id],
      );
      expect(Number(left.rows[0].n)).toBe(0);
    },
  );

  test.each(["live", "done"] as const)(
    "is refused by the board guard once the game is %s, even with no picks",
    async (state) => {
      const id = await reviewCategoryWithNoPicks(state);
      const err = await errorOf(() => db.query("delete from categories where id = $1", [id]));
      expect(err?.code).toBe("55000");
      expect(err?.message).toContain(GUARD_MESSAGE);
    },
  );
});
