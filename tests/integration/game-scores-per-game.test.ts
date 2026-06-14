// @vitest-environment node
//
// game_scores per-game isolation — REAL Postgres, not the mocked client.
//
// Why this exists: the mocked unit suite (msw) cannot exercise a SQL view, so
// the `game_scores` cross-game double-count (a player's Game-1 points leaking
// into their Game-2 leaderboard row, and vice-versa) shipped to prod and
// passed CI undetected. This runs the ACTUAL migrations on an in-process
// Postgres (pglite — WASM, no Docker/CLI/cloud) and asserts each game's row
// is computed from ONLY that game's answers.
//
// It resolves answers with the production `resolve_question` RPC (defined in
// 0001_init.sql), so awarded_points/is_correct are computed exactly as a live
// show computes them — no hand-rolled scoring math to drift.
//
// RED→GREEN: with only 0001 applied (the original view) this test fails
// (every aggregate doubles). It passes once 0013 redefines the view to
// game-scope each answers aggregate.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);

// Apply the base schema (0001) plus every later migration that (re)defines the
// game_scores view, in filename order. The view depends only on base tables, so
// the RLS/storage/realtime/billing migrations (which need Supabase-managed
// schemas) are irrelevant here and skipped. A future view fix is auto-included
// the moment its migration redefines the view.
const VIEW_REDEF = /create\s+(or\s+replace\s+)?view\s+game_scores/i;

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  // Minimal stubs so 0001 applies in bare Postgres: the `extensions` schema it
  // sets on the search_path, and the `auth.users` table hosts.user_id FKs to.
  await db.exec(`
    create schema if not exists extensions;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key default gen_random_uuid());
  `);
  await db.exec(readFileSync(path.join(MIGRATIONS_DIR, "0001_init.sql"), "utf8"));
  const laterViewMigrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f > "0001_init.sql")
    .sort();
  for (const f of laterViewMigrations) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    if (VIEW_REDEF.test(sql)) await db.exec(sql);
  }
  return db;
}

interface ScoreRow {
  score: string;
  correct_count: string;
  answered_count: string;
  fastest_correct_ms: number | null;
}

describe("game_scores reports per-game numbers using only that game's answers", () => {
  let db: PGlite;
  let game1Id: string;
  let game2Id: string;
  let twoGamePlayerId: string;
  let zeroAnswerJoinerId: string;

  beforeAll(async () => {
    db = await freshDb();

    const one = async <T>(sql: string, params: unknown[] = []) =>
      (await db.query<T>(sql, params)).rows[0];
    const id = async (sql: string, params: unknown[] = []) =>
      (await one<{ id: string }>(sql + " returning id", params)).id;

    const userId = (await one<{ id: string }>("insert into auth.users default values returning id")).id;
    const hostId = await id("insert into hosts (user_id, display_name) values ($1, 'Host')", [userId]);
    const nightId = await id(
      "insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', 'ROOM01')",
      [hostId],
    );
    game1Id = await id("insert into games (night_id, game_no) values ($1, 1)", [nightId]);
    game2Id = await id("insert into games (night_id, game_no) values ($1, 2)", [nightId]);

    const cat1 = await id(
      "insert into categories (game_id, name, topic, position) values ($1, 'G1 cat', 't', 0)",
      [game1Id],
    );
    const cat2 = await id(
      "insert into categories (game_id, name, topic, position) values ($1, 'G2 cat', 't', 0)",
      [game2Id],
    );

    const opts = '["a","b","c","d"]';
    // Both questions are correct_index 0, played (so resolve_question runs).
    const q1 = await id(
      `insert into questions (category_id, point_value, prompt, options, correct_index, is_picked, played_at)
       values ($1, 100, 'q', $2::jsonb, 0, true, now())`,
      [cat1, opts],
    );
    const q2 = await id(
      `insert into questions (category_id, point_value, prompt, options, correct_index, is_picked, played_at)
       values ($1, 700, 'q', $2::jsonb, 0, true, now())`,
      [cat2, opts],
    );

    // One player participates in BOTH games; a second player joins Game 2 only
    // and never answers (must still show on the board at 0 — the FILTER-vs-WHERE
    // distinction the fix hinges on).
    twoGamePlayerId = await id(
      "insert into players (night_id, device_id, display_name) values ($1, gen_random_uuid(), 'Pat')",
      [nightId],
    );
    zeroAnswerJoinerId = await id(
      "insert into players (night_id, device_id, display_name) values ($1, gen_random_uuid(), 'Zoe')",
      [nightId],
    );
    await db.query("insert into game_participations (game_id, player_id) values ($1, $2)", [game1Id, twoGamePlayerId]);
    await db.query("insert into game_participations (game_id, player_id) values ($1, $2)", [game2Id, twoGamePlayerId]);
    await db.query("insert into game_participations (game_id, player_id) values ($1, $2)", [game2Id, zeroAnswerJoinerId]);

    // Pat answers correctly in each game. Distinct ms_to_lock (both >5000ms so no
    // speed bonus → awarded == point_value) so fastest_correct_ms is also proven
    // per-game: G1=6000, G2=8000.
    const answer = `insert into answers (question_id, player_id, chosen_index, scramble, ms_to_lock)
                    values ($1, $2, 0, '[0,1,2,3]'::jsonb, $3)`;
    await db.query(answer, [q1, twoGamePlayerId, 6000]);
    await db.query(answer, [q2, twoGamePlayerId, 8000]);

    await db.query("select resolve_question($1)", [q1]);
    await db.query("select resolve_question($1)", [q2]);
  });

  afterAll(async () => {
    await db?.close();
  });

  async function scoreRow(gameId: string, playerId: string): Promise<ScoreRow | null> {
    const r = await db.query<ScoreRow>(
      `select score, correct_count, answered_count, fastest_correct_ms
         from game_scores where game_id = $1 and player_id = $2`,
      [gameId, playerId],
    );
    return r.rows[0] ?? null;
  }

  test("Game 1 row counts ONLY the player's Game 1 answer (not their Game 2 points)", async () => {
    const r = await scoreRow(game1Id, twoGamePlayerId);
    expect(r).not.toBeNull();
    expect(Number(r!.score)).toBe(100);
    expect(Number(r!.answered_count)).toBe(1);
    expect(Number(r!.correct_count)).toBe(1);
    expect(r!.fastest_correct_ms).toBe(6000);
  });

  test("Game 2 row counts ONLY the player's Game 2 answer (not their Game 1 points)", async () => {
    const r = await scoreRow(game2Id, twoGamePlayerId);
    expect(r).not.toBeNull();
    expect(Number(r!.score)).toBe(700);
    expect(Number(r!.answered_count)).toBe(1);
    expect(Number(r!.correct_count)).toBe(1);
    expect(r!.fastest_correct_ms).toBe(8000);
  });

  test("a player who joined a game but never answered still appears at score 0", async () => {
    const r = await scoreRow(game2Id, zeroAnswerJoinerId);
    // Must NOT vanish — a WHERE-clause fix would drop zero-answer joiners; the
    // FILTER-clause fix keeps the game_participations row at 0.
    expect(r).not.toBeNull();
    expect(Number(r!.score)).toBe(0);
    expect(Number(r!.answered_count)).toBe(0);
    expect(Number(r!.correct_count)).toBe(0);
    expect(r!.fastest_correct_ms).toBeNull();
  });
});
