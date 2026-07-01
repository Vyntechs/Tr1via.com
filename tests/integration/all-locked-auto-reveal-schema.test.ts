// @vitest-environment node
//
// resolve_question_if_all_locked — REAL Postgres (pglite), not the mocked
// client. The guarded end-early path used to decide eligibility app-side by
// reading players/game_scores/answers and THEN calling resolve_question —
// a classic check-then-resolve race: a player could join/get removed between
// the app's read and the RPC call. This moves the decision into a single
// SECURITY DEFINER function so the check and the resolve happen atomically
// in one transaction, with the question + participation/player rows locked
// in between.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

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
  await db.exec(
    readFileSync(path.join(MIGRATIONS_DIR, "0018_resolve_question_if_all_locked.sql"), "utf8"),
  );
  return db;
}

describe("resolve_question_if_all_locked", () => {
  let db: PGlite;
  let hostId: string;
  let nightId: string;
  let gameId: string;
  let categoryId: string;

  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows[0];
  const id = async (sql: string, params: unknown[] = []) =>
    (await one<{ id: string }>(sql + " returning id", params)).id;

  beforeAll(async () => {
    db = await freshDb();
    const hostUserId = (await one<{ id: string }>("insert into auth.users default values returning id")).id;
    hostId = await id("insert into hosts (user_id, display_name) values ($1, 'Host')", [hostUserId]);
  });

  afterAll(async () => {
    await db?.close();
  });

  beforeEach(async () => {
    nightId = await id(
      "insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', $2)",
      [hostId, `R${Math.floor(Math.random() * 1_000_000)}`],
    );
    gameId = await id("insert into games (night_id, game_no) values ($1, 1)", [nightId]);
    categoryId = await id(
      "insert into categories (game_id, name, topic, position) values ($1, 'Cat', 'Topic', 0)",
      [gameId],
    );
  });

  async function makePlayer(removed = false) {
    const playerId = await id(
      `insert into players (night_id, device_id, display_name, removed_at)
       values ($1, gen_random_uuid(), 'Player', $2)`,
      [nightId, removed ? new Date().toISOString() : null],
    );
    await db.query(
      "insert into game_participations (game_id, player_id) values ($1, $2)",
      [gameId, playerId],
    );
    return playerId;
  }

  async function makeLiveQuestion() {
    return id(
      `insert into questions (
         category_id, point_value, prompt, options, correct_index, is_picked,
         played_at, finished_at
       ) values (
         $1, 100, 'Prompt?', '["A","B","C","D"]'::jsonb, 0, true,
         now(), null
       )`,
      [categoryId],
    );
  }

  async function lockAnswer(questionId: string, playerId: string, chosenIndex: number) {
    await db.query(
      `insert into answers (question_id, player_id, chosen_index, scramble, ms_to_lock)
       values ($1, $2, $3, '[0,1,2,3]'::jsonb, 1000)`,
      [questionId, playerId, chosenIndex],
    );
  }

  test("applies cleanly and creates the function", async () => {
    const fn = await db.query<{ proname: string }>(
      `select proname from pg_proc where proname = 'resolve_question_if_all_locked'`,
    );
    expect(fn.rows).toHaveLength(1);
  });

  test("returns false and does not resolve when not everyone eligible has locked", async () => {
    const p1 = await makePlayer();
    await makePlayer(); // p2, never locks
    const questionId = await makeLiveQuestion();
    await lockAnswer(questionId, p1, 0);

    const result = await one<{ resolve_question_if_all_locked: boolean }>(
      "select resolve_question_if_all_locked($1)",
      [questionId],
    );
    expect(result.resolve_question_if_all_locked).toBe(false);

    const q = await one<{ finished_at: string | null }>(
      "select finished_at from questions where id = $1",
      [questionId],
    );
    expect(q.finished_at).toBeNull();
  });

  test("returns true and resolves when every eligible player has locked", async () => {
    const p1 = await makePlayer();
    const p2 = await makePlayer();
    const questionId = await makeLiveQuestion();
    await lockAnswer(questionId, p1, 0);
    await lockAnswer(questionId, p2, 1);

    const result = await one<{ resolve_question_if_all_locked: boolean }>(
      "select resolve_question_if_all_locked($1)",
      [questionId],
    );
    expect(result.resolve_question_if_all_locked).toBe(true);

    const q = await one<{ finished_at: string | null }>(
      "select finished_at from questions where id = $1",
      [questionId],
    );
    expect(q.finished_at).not.toBeNull();

    const answers = await db.query<{ is_correct: boolean; awarded_points: number }>(
      "select is_correct, awarded_points from answers where question_id = $1 order by player_id",
      [questionId],
    );
    expect(answers.rows.some((r) => r.is_correct === true && r.awarded_points > 0)).toBe(true);

    const reveal = await one<{ event: string } | undefined>(
      "select event from reveals where question_id = $1",
      [questionId],
    );
    expect(reveal?.event).toBe("resolve");
  });

  test("ignores a removed player who never locked (they are not eligible)", async () => {
    const p1 = await makePlayer();
    await makePlayer(/* removed */ true);
    const questionId = await makeLiveQuestion();
    await lockAnswer(questionId, p1, 0);

    const result = await one<{ resolve_question_if_all_locked: boolean }>(
      "select resolve_question_if_all_locked($1)",
      [questionId],
    );
    expect(result.resolve_question_if_all_locked).toBe(true);
  });

  test("ignores a participation row for a player from another night", async () => {
    const p1 = await makePlayer();
    const otherNightId = await id(
      "insert into nights (host_id, venue_name, room_code) values ($1, 'Other', $2)",
      [hostId, `X${Math.floor(Math.random() * 1_000_000)}`],
    );
    const crossNightPlayerId = await id(
      `insert into players (night_id, device_id, display_name)
       values ($1, gen_random_uuid(), 'Cross Night')`,
      [otherNightId],
    );
    await db.query(
      "insert into game_participations (game_id, player_id) values ($1, $2)",
      [gameId, crossNightPlayerId],
    );
    const questionId = await makeLiveQuestion();
    await lockAnswer(questionId, p1, 0);

    const result = await one<{ resolve_question_if_all_locked: boolean }>(
      "select resolve_question_if_all_locked($1)",
      [questionId],
    );
    expect(result.resolve_question_if_all_locked).toBe(true);
  });

  test("requires at least one eligible player — returns false when nobody is eligible", async () => {
    await makePlayer(/* removed */ true); // only a removed player participated
    const questionId = await makeLiveQuestion();

    const result = await one<{ resolve_question_if_all_locked: boolean }>(
      "select resolve_question_if_all_locked($1)",
      [questionId],
    );
    expect(result.resolve_question_if_all_locked).toBe(false);

    const q = await one<{ finished_at: string | null }>(
      "select finished_at from questions where id = $1",
      [questionId],
    );
    expect(q.finished_at).toBeNull();
  });

  test("function execute privilege is revoked from public/anon/authenticated and granted only to service_role", async () => {
    const grants = await db.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type
       from information_schema.routine_privileges
       where routine_schema = 'public'
         and routine_name = 'resolve_question_if_all_locked'
       order by grantee, privilege_type`,
    );

    const grantsByRole = new Map<string, string[]>();
    for (const row of grants.rows) {
      const g = grantsByRole.get(row.grantee) ?? [];
      g.push(row.privilege_type);
      grantsByRole.set(row.grantee, g);
    }

    expect(grantsByRole.get("anon") ?? []).toEqual([]);
    expect(grantsByRole.get("authenticated") ?? []).toEqual([]);
    expect(grantsByRole.get("PUBLIC") ?? []).toEqual([]);
    expect(grantsByRole.get("service_role")).toContain("EXECUTE");
  });
});
