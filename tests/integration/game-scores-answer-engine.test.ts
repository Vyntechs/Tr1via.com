// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);
const SCHEMA_MIGRATION = path.join(MIGRATIONS_DIR, "0022_live_answer_engine_schema.sql");
const SCORING_MIGRATION = path.join(MIGRATIONS_DIR, "0024_game_scores_answer_engine.sql");
const hasScoringMigrations = existsSync(SCHEMA_MIGRATION) && existsSync(SCORING_MIGRATION);

interface ScoreRow {
  game_id: string;
  player_id: string;
  display_name: string;
  score: string;
  correct_count: string;
  answered_count: string;
  fastest_correct_ms: number | null;
}

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create schema if not exists extensions;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key default gen_random_uuid());
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create publication supabase_realtime;
  `);
  for (const migration of [
    "0001_init.sql",
    "0013_game_scores_per_game_isolation.sql",
    "0022_live_answer_engine_schema.sql",
    "0024_game_scores_answer_engine.sql",
  ]) {
    const migrationPath = path.join(MIGRATIONS_DIR, migration);
    if (existsSync(migrationPath)) await db.exec(readFileSync(migrationPath, "utf8"));
  }
  return db;
}

describe("game_scores branches by the night's immutable answer engine", () => {
  test("requires migration 0022", () => {
    expect(existsSync(SCHEMA_MIGRATION)).toBe(true);
  });

  test("requires migration 0024", () => {
    expect(existsSync(SCORING_MIGRATION)).toBe(true);
  });

  describe.skipIf(!hasScoringMigrations)("engine-aware score facts", () => {
    let db: PGlite;
    const ids = new Map<string, string>();

    const id = (name: string) => {
      const value = ids.get(name);
      if (!value) throw new Error(`Missing fixture id: ${name}`);
      return value;
    };

    beforeAll(async () => {
      db = await freshDb();
      const one = async <T>(sql: string, params: unknown[] = []) =>
        (await db.query<T>(sql, params)).rows[0];
      const insertId = async (name: string, sql: string, params: unknown[] = []) => {
        const row = await one<{ id: string }>(`${sql} returning id`, params);
        ids.set(name, row.id);
        return row.id;
      };

      const userId = (await one<{ id: string }>("insert into auth.users default values returning id")).id;
      const hostId = await insertId(
        "host",
        "insert into hosts (user_id, display_name) values ($1, 'Host')",
        [userId],
      );

      for (const engine of ["legacy", "resilient"] as const) {
        const resilient = engine === "resilient";
        const runId = crypto.randomUUID();
        const nightId = await insertId(
          `${engine}-night`,
          `insert into nights (
             host_id, venue_name, room_code, answer_engine, answer_engine_latched_at, current_run_id
           ) values ($1, $2, $3, $4, now(), $5)`,
          [hostId, `${engine} venue`, resilient ? "RES001" : "LEG001", resilient ? "resilient_v1" : "legacy", runId],
        );
        const game1 = await insertId(
          `${engine}-g1`,
          "insert into games (night_id, game_no) values ($1, 1)",
          [nightId],
        );
        const game2 = await insertId(
          `${engine}-g2`,
          "insert into games (night_id, game_no) values ($1, 2)",
          [nightId],
        );
        const player = await insertId(
          `${engine}-player`,
          "insert into players (night_id, device_id, display_name) values ($1, gen_random_uuid(), $2)",
          [nightId, `${engine} Pat`],
        );
        const zeroPlayer = await insertId(
          `${engine}-zero`,
          "insert into players (night_id, device_id, display_name) values ($1, gen_random_uuid(), $2)",
          [nightId, `${engine} Zoe`],
        );

        for (const [game, suffix] of [[game1, "g1"], [game2, "g2"]] as const) {
          await db.query(
            "insert into game_participations (game_id, player_id) values ($1, $2), ($1, $3)",
            [game, player, zeroPlayer],
          );
          const category = await insertId(
            `${engine}-${suffix}-category`,
            "insert into categories (game_id, name, topic, position) values ($1, $2, 'topic', 0)",
            [game, `${engine} ${suffix}`],
          );
          await insertId(
            `${engine}-${suffix}-question`,
            `insert into questions (
               category_id, point_value, prompt, options, correct_index, is_picked, played_at, finished_at
             ) values ($1, $2, 'question', '["A","B","C","D"]'::jsonb, 0, true, now(), now())`,
            [category, suffix === "g1" ? (resilient ? 200 : 100) : (resilient ? 600 : 700)],
          );
        }

        await db.query(
          `insert into adjustments (player_id, game_id, delta, reason)
           values ($1, $2, $3, 'g1 adjustment'), ($1, $4, $5, 'g2 adjustment')`,
          [player, game1, resilient ? 5 : 15, game2, resilient ? -10 : -20],
        );
      }

      // Legacy facts: only answers count. Resilient-shaped rows are deliberate
      // contamination and must not be read by the legacy branch.
      await db.query(
        `insert into answers (
           question_id, player_id, chosen_index, scramble, ms_to_lock, is_correct, awarded_points
         ) values
           ($1, $2, 0, '[0,1,2,3]'::jsonb, 6000, true, 100),
           ($3, $2, 0, '[0,1,2,3]'::jsonb, 8000, true, 700)`,
        [id("legacy-g1-question"), id("legacy-player"), id("legacy-g2-question")],
      );

      const insertResolvedPlayAnswer = async (
        prefix: string,
        runId: string,
        nightId: string,
        gameId: string,
        questionId: string,
        playerId: string,
        awardedPoints: number,
        msToLock: number,
      ) => {
        const playId = await insertId(
          `${prefix}-play`,
          `insert into question_plays (
             night_id, run_id, game_id, question_id, status, opened_at, main_zero_at,
             final_window_starts_at, final_window_ends_at, finalize_at, resolved_at,
             resolution_reason, eligible_count, confirmed_count
           ) values (
             $1, $2, $3, $4, 'resolved', now() - interval '30 seconds',
             now() - interval '10 seconds', now() - interval '10 seconds',
             now() - interval '8 seconds', now() - interval '8 seconds', now(),
             'deadline', 1, 1
           )`,
          [nightId, runId, gameId, questionId],
        );
        await db.query(
          "insert into question_play_eligibility (play_id, player_id) values ($1, $2)",
          [playId, playerId],
        );
        await db.query(
          `insert into question_play_answers (
             play_id, player_id, submission_id, visible_slot, canonical_index,
             received_at, locked_at, ms_to_lock, is_correct, awarded_points
           ) values ($1, $2, gen_random_uuid(), 1, 0, now(), now(), $3, true, $4)`,
          [playId, playerId, msToLock, awardedPoints],
        );
      };

      const resilientNight = id("resilient-night");
      const run = await db.query<{ current_run_id: string }>(
        "select current_run_id from nights where id = $1",
        [resilientNight],
      );
      await insertResolvedPlayAnswer(
        "resilient-g1",
        run.rows[0].current_run_id,
        resilientNight,
        id("resilient-g1"),
        id("resilient-g1-question"),
        id("resilient-player"),
        200,
        6500,
      );
      await insertResolvedPlayAnswer(
        "resilient-g2",
        run.rows[0].current_run_id,
        resilientNight,
        id("resilient-g2"),
        id("resilient-g2-question"),
        id("resilient-player"),
        660,
        4000,
      );

      // A legacy answer on the resilient night must never leak into its scores.
      await db.query(
        `insert into answers (
           question_id, player_id, chosen_index, scramble, ms_to_lock, is_correct, awarded_points
         ) values ($1, $2, 0, '[0,1,2,3]'::jsonb, 1, true, 888)`,
        [id("resilient-g1-question"), id("resilient-player")],
      );

      const legacyNight = id("legacy-night");
      const legacyRun = await db.query<{ current_run_id: string }>(
        "select current_run_id from nights where id = $1",
        [legacyNight],
      );
      await insertResolvedPlayAnswer(
        "legacy-contamination",
        legacyRun.rows[0].current_run_id,
        legacyNight,
        id("legacy-g1"),
        id("legacy-g1-question"),
        id("legacy-player"),
        999,
        1,
      );
    });

    afterAll(async () => {
      await db?.close();
    });

    async function score(game: string, player: string): Promise<ScoreRow | null> {
      const result = await db.query<ScoreRow>(
        `select game_id, player_id, display_name, score, correct_count,
                answered_count, fastest_correct_ms
           from game_scores
          where game_id = $1 and player_id = $2`,
        [id(game), id(player)],
      );
      return result.rows[0] ?? null;
    }

    test("preserves the game_scores public view shape", async () => {
      const columns = await db.query<{ column_name: string }>(`
        select column_name
          from information_schema.columns
         where table_schema = 'public' and table_name = 'game_scores'
         order by ordinal_position
      `);
      expect(columns.rows.map((row) => row.column_name)).toEqual([
        "game_id",
        "player_id",
        "display_name",
        "score",
        "correct_count",
        "answered_count",
        "fastest_correct_ms",
      ]);
    });

    test("legacy games read only legacy answers and keep Game 1 and Game 2 isolated", async () => {
      const game1 = await score("legacy-g1", "legacy-player");
      const game2 = await score("legacy-g2", "legacy-player");
      expect(Number(game1?.score)).toBe(115);
      expect(Number(game1?.correct_count)).toBe(1);
      expect(Number(game1?.answered_count)).toBe(1);
      expect(game1?.fastest_correct_ms).toBe(6000);
      expect(Number(game2?.score)).toBe(680);
      expect(Number(game2?.correct_count)).toBe(1);
      expect(Number(game2?.answered_count)).toBe(1);
      expect(game2?.fastest_correct_ms).toBe(8000);
    });

    test("resilient games read only resolved play answers and keep Game 1 and Game 2 isolated", async () => {
      const game1 = await score("resilient-g1", "resilient-player");
      const game2 = await score("resilient-g2", "resilient-player");
      expect(Number(game1?.score)).toBe(205);
      expect(Number(game1?.correct_count)).toBe(1);
      expect(Number(game1?.answered_count)).toBe(1);
      expect(game1?.fastest_correct_ms).toBe(6500);
      expect(Number(game2?.score)).toBe(650);
      expect(Number(game2?.correct_count)).toBe(1);
      expect(Number(game2?.answered_count)).toBe(1);
      expect(game2?.fastest_correct_ms).toBe(4000);
    });

    test.each(["legacy", "resilient"])("keeps a zero-answer %s player visible in both games", async (engine) => {
      for (const suffix of ["g1", "g2"]) {
        const row = await score(`${engine}-${suffix}`, `${engine}-zero`);
        expect(row).not.toBeNull();
        expect(Number(row?.score)).toBe(0);
        expect(Number(row?.correct_count)).toBe(0);
        expect(Number(row?.answered_count)).toBe(0);
        expect(row?.fastest_correct_ms).toBeNull();
      }
    });
  });
});
