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
const TIMER_MIGRATION = path.join(
  MIGRATIONS_DIR,
  "20260915182433_player_answer_timer_25_seconds.sql",
);

describe("legacy 25-second answer deadline", () => {
  let db: PGlite;
  let categoryId: string;
  let playerId: string;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create schema if not exists extensions;
      create schema if not exists auth;
      create table if not exists auth.users (
        id uuid primary key default gen_random_uuid()
      );
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);
    await db.exec(
      readFileSync(path.join(MIGRATIONS_DIR, "0001_init.sql"), "utf8"),
    );
    await db.exec(readFileSync(TIMER_MIGRATION, "utf8"));

    const user = await db.query<{ id: string }>(
      "insert into auth.users default values returning id",
    );
    const host = await db.query<{ id: string }>(
      "insert into hosts (user_id, display_name) values ($1, 'Host') returning id",
      [user.rows[0].id],
    );
    const night = await db.query<{ id: string }>(
      "insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', 'TIME25') returning id",
      [host.rows[0].id],
    );
    const game = await db.query<{ id: string }>(
      "insert into games (night_id, game_no) values ($1, 1) returning id",
      [night.rows[0].id],
    );
    const category = await db.query<{ id: string }>(
      "insert into categories (game_id, name, topic, position) values ($1, 'Timer', 'Timer', 0) returning id",
      [game.rows[0].id],
    );
    categoryId = category.rows[0].id;
    const player = await db.query<{ id: string }>(
      "insert into players (night_id, device_id, display_name) values ($1, gen_random_uuid(), 'Player') returning id",
      [night.rows[0].id],
    );
    playerId = player.rows[0].id;
  });

  afterAll(async () => {
    await db?.close();
  });

  async function question(pointValue: number, finishedAt: string | null = null) {
    const result = await db.query<{ id: string }>(
      `insert into questions (
         category_id, point_value, prompt, options, correct_index, is_picked,
         played_at, finished_at
       ) values (
         $1, $2, 'Prompt?', '["A","B","C","D"]'::jsonb, 0, true,
         '2026-09-16T12:00:00.000Z'::timestamptz,
         $3::timestamptz
       ) returning id`,
      [categoryId, pointValue, finishedAt],
    );
    return result.rows[0].id;
  }

  async function insertAnswer(questionId: string, lockedAt: string) {
    return db.query<{
      ms_to_lock: number;
      is_correct: boolean | null;
      awarded_points: number | null;
    }>(
      `insert into answers (
         question_id, player_id, chosen_index, scramble, locked_at, ms_to_lock
       ) values ($1, $2, 0, '[0,1,2,3]'::jsonb, $3::timestamptz, $4)
       returning ms_to_lock, is_correct, awarded_points`,
      [
        questionId,
        playerId,
        lockedAt,
        new Date(lockedAt).getTime() - new Date("2026-09-16T12:00:00.000Z").getTime(),
      ],
    );
  }

  test("the migration is only about the current legacy answer table", () => {
    const sql = readFileSync(TIMER_MIGRATION, "utf8");
    expect(sql).toContain("before insert on public.answers");
    expect(sql).not.toContain("resilient_v1");
    expect(sql).not.toContain("question_plays");
  });

  test("accepts 24.999 seconds", async () => {
    const questionId = await question(100);
    const result = await insertAnswer(
      questionId,
      "2026-09-16T12:00:24.999Z",
    );

    expect(result.rows[0]).toMatchObject({
      ms_to_lock: 24_999,
      is_correct: null,
      awarded_points: null,
    });
  });

  test("rejects exactly 25.000 seconds", async () => {
    const questionId = await question(200);

    await expect(
      insertAnswer(questionId, "2026-09-16T12:00:25.000Z"),
    ).rejects.toThrow(/legacy_answer_deadline_passed/i);
  });

  test("a delayed save cannot discard a request received before the deadline", async () => {
    const questionId = await question(
      300,
      "2026-09-16T12:00:25.000Z",
    );
    const result = await insertAnswer(
      questionId,
      "2026-09-16T12:00:24.999Z",
    );

    expect(result.rows[0]).toMatchObject({
      ms_to_lock: 24_999,
      is_correct: true,
      awarded_points: 300,
    });
  });

  test("ending a question early rejects answers received after that close", async () => {
    const questionId = await question(
      400,
      "2026-09-16T12:00:10.000Z",
    );

    await expect(
      insertAnswer(questionId, "2026-09-16T12:00:10.001Z"),
    ).rejects.toThrow(/legacy_answer_question_closed/i);
  });
});
