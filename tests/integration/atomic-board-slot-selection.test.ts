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

  async function seedAuthoringCategory(roomCode: string) {
    const user = await db.query<{ id: string }>(
      "insert into auth.users default values returning id",
    );
    const host = await db.query<{ id: string }>(
      "insert into hosts (user_id, display_name) values ($1, 'Heather') returning id",
      [user.rows[0].id],
    );
    const night = await db.query<{ id: string }>(
      "insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', $2) returning id",
      [host.rows[0].id, roomCode],
    );
    const game = await db.query<{ id: string }>(
      "insert into games (night_id, game_no, state) values ($1, 1, 'ready') returning id",
      [night.rows[0].id],
    );
    const category = await db.query<{ id: string }>(
      "insert into categories (game_id, name, topic, position, state) values ($1, 'Tea', 'Tea', 1, 'ready') returning id",
      [game.rows[0].id],
    );
    const questions: Array<{ id: string }> = [];
    for (const point of [100, 200, 300, 400, 500, 600, 700]) {
      const row = await db.query<{ id: string }>(
        `insert into questions
          (category_id, difficulty, prompt, options, correct_index, source, is_picked, point_value)
         values ($1, $2, $3, '["A","B","C","D"]'::jsonb, 0, 'ai', true, $4)
         returning id`,
        [category.rows[0].id, point / 100, `Question ${point}`, point],
      );
      questions.push(row.rows[0]);
    }
    return {
      gameId: game.rows[0].id,
      categoryId: category.rows[0].id,
      questionIds: questions.map((question) => question.id),
    };
  }

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
    for (const migration of [
      "0001_init.sql",
      "0002_rls.sql",
      "0012_swap_point_value.sql",
      "0015_question_generation_reports.sql",
      "0016_question_generation_reports_privileges.sql",
      "0019_question_generation_jobs.sql",
      "0020_question_generation_jobs_advisor_fixes.sql",
      "0021_live_security_gate.sql",
      "0029_generation_attempt_fencing.sql",
    ]) {
      await db.exec(readFileSync(path.join(MIGRATIONS, migration), "utf8"));
    }
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

  test("serializes the category before locking and re-reading the canonical game state", async () => {
    const functionDefinition = await db.query<{ definition: string }>(
      `select pg_get_functiondef(p.oid) as definition
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'swap_point_value'`,
    );
    const definition = functionDefinition.rows[0]?.definition.toLowerCase() ?? "";
    const advisoryLock = definition.indexOf("pg_advisory_xact_lock");
    const canonicalStateRead = definition.indexOf("g.state", advisoryLock);
    const canonicalGameLock = definition.indexOf("for update of g", advisoryLock);
    const firstQuestionMutation = definition.indexOf("update public.questions");

    expect(advisoryLock).toBeGreaterThan(-1);
    expect(canonicalStateRead).toBeGreaterThan(advisoryLock);
    expect(canonicalGameLock).toBeGreaterThan(canonicalStateRead);
    expect(firstQuestionMutation).toBeGreaterThan(canonicalGameLock);
  });

  test("waits safely before row mutation but fails prompt direct-write inversions", async () => {
    const functionDefinitions = await db.query<{
      proname: string;
      definition: string;
    }>(
      `select pg_get_functiondef(p.oid) as definition
              , p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in (
            '_lock_board_authoring_game',
            '_try_lock_board_authoring_game',
            '_fence_question_authoring',
            '_fence_category_authoring'
          )`,
    );
    const byName = new Map(
      functionDefinitions.rows.map((row) => [
        row.proname,
        row.definition.toLowerCase(),
      ]),
    );

    expect(byName.get("_lock_board_authoring_game")).toContain("for update");
    expect(byName.get("_lock_board_authoring_game")).not.toContain("nowait");
    expect(byName.get("_try_lock_board_authoring_game")).toContain(
      "for update nowait",
    );
    expect(byName.get("_fence_question_authoring")).toContain(
      "_try_lock_board_authoring_game",
    );
    expect(byName.get("_fence_category_authoring")).toContain(
      "_try_lock_board_authoring_game",
    );
  });

  test("keeps parallel unpicked-candidate generation off the shared game lock", async () => {
    const functions = await db.query<{ proname: string; definition: string }>(
      `select p.proname, pg_get_functiondef(p.oid) as definition
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in (
            '_fence_question_authoring',
            '_fence_category_authoring'
          )`,
    );
    const byName = new Map(
      functions.rows.map((row) => [row.proname, row.definition.toLowerCase()]),
    );
    const questionFence = byName.get("_fence_question_authoring") ?? "";
    const categoryFence = byName.get("_fence_category_authoring") ?? "";

    expect(questionFence.indexOf("not new.is_picked")).toBeGreaterThan(-1);
    expect(questionFence.indexOf("not new.is_picked")).toBeLessThan(
      questionFence.indexOf("_lock_board_authoring_game"),
    );
    expect(categoryFence.indexOf("'draft', 'generating', 'review'")).toBeGreaterThan(-1);
    expect(categoryFence.indexOf("'draft', 'generating', 'review'")).toBeLessThan(
      categoryFence.indexOf("_lock_board_authoring_game"),
    );
  });

  test("rejects a direct content save after the game starts", async () => {
    const fixture = await seedAuthoringCategory("FENCE1");
    await db.query("update games set state = 'live' where id = $1", [
      fixture.gameId,
    ]);

    await expect(
      db.query("update questions set prompt = 'Changed live' where id = $1", [
        fixture.questionIds[0],
      ]),
    ).rejects.toThrow(/board cannot change after its game starts/i);
  });

  test("rejects a direct unpick after the game starts", async () => {
    const fixture = await seedAuthoringCategory("FENCE2");
    await db.query("update games set state = 'live' where id = $1", [
      fixture.gameId,
    ]);

    await expect(
      db.query(
        "update questions set is_picked = false, point_value = null where id = $1",
        [fixture.questionIds[0]],
      ),
    ).rejects.toThrow(/board cannot change after its game starts/i);
  });

  test("rejects direct reorder writes after the game starts", async () => {
    const fixture = await seedAuthoringCategory("FENCE3");
    await db.query("update games set state = 'live' where id = $1", [
      fixture.gameId,
    ]);

    await expect(
      db.query(
        "update questions set point_value = null where category_id = $1",
        [fixture.categoryId],
      ),
    ).rejects.toThrow(/board cannot change after its game starts/i);
  });

  test("rejects direct bulk-pick writes after the game starts", async () => {
    const fixture = await seedAuthoringCategory("FENCE4");
    await db.query("update games set state = 'live' where id = $1", [
      fixture.gameId,
    ]);

    await expect(
      db.query(
        "update questions set is_picked = false, point_value = null where category_id = $1",
        [fixture.categoryId],
      ),
    ).rejects.toThrow(/board cannot change after its game starts/i);
  });

  test("keeps live-runtime question timestamps writable", async () => {
    const fixture = await seedAuthoringCategory("FENCE5");
    await db.query("update games set state = 'live' where id = $1", [
      fixture.gameId,
    ]);

    await db.query(
      "update questions set played_at = now(), finished_at = now() where id = $1",
      [fixture.questionIds[0]],
    );

    const question = await db.query<{
      played_at: string | null;
      finished_at: string | null;
    }>(
      "select played_at, finished_at from questions where id = $1",
      [fixture.questionIds[0]],
    );
    expect(question.rows[0].played_at).not.toBeNull();
    expect(question.rows[0].finished_at).not.toBeNull();
  });

  test("fences picked inserts, picked deletes, and public category edits once live", async () => {
    const fixture = await seedAuthoringCategory("FENCE6");
    await db.query("update games set state = 'live' where id = $1", [
      fixture.gameId,
    ]);

    await expect(
      db.query(
        `insert into questions
          (category_id, difficulty, prompt, options, correct_index, is_picked)
         values ($1, 1, 'Late picked question', '["A","B","C","D"]'::jsonb, 0, true)`,
        [fixture.categoryId],
      ),
    ).rejects.toThrow(/board cannot change after its game starts/i);
    await expect(
      db.query("delete from questions where id = $1", [fixture.questionIds[0]]),
    ).rejects.toThrow(/board cannot change after its game starts/i);
    await expect(
      db.query("update categories set topic = 'Changed live' where id = $1", [
        fixture.categoryId,
      ]),
    ).rejects.toThrow(/board cannot change after its game starts/i);
  });

  test("allows parallel-generation candidate work that cannot change the live board", async () => {
    const fixture = await seedAuthoringCategory("FENCE7");
    const candidate = await db.query<{ id: string }>(
      `insert into questions
        (category_id, difficulty, prompt, options, correct_index, source, is_picked)
       values ($1, 4, 'Candidate', '["A","B","C","D"]'::jsonb, 0, 'ai', false)
       returning id`,
      [fixture.categoryId],
    );
    await db.query("update games set state = 'live' where id = $1", [
      fixture.gameId,
    ]);

    await db.query(
      "update questions set prompt = 'Certified candidate' where id = $1",
      [candidate.rows[0].id],
    );
    await db.query("delete from questions where id = $1", [candidate.rows[0].id]);

    const remaining = await db.query<{ count: number }>(
      "select count(*)::integer as count from questions where id = $1",
      [candidate.rows[0].id],
    );
    expect(remaining.rows[0].count).toBe(0);
  });

  test("saves content and slot placement as one database operation", async () => {
    const fixture = await seedAuthoringCategory("ATOMIC1");
    const candidate = await db.query<{ id: string }>(
      `insert into questions
        (category_id, difficulty, prompt, options, correct_index, source, is_picked, point_value)
       values ($1, 7, 'Old prompt', '["A","B","C","D"]'::jsonb, 0, 'ai', false, null)
       returning id`,
      [fixture.categoryId],
    );

    await db.query(
      `select apply_question_authoring_patch(
        $1,
        '{"prompt":"Heather final","source":"host-edit","point_value":700}'::jsonb
      )`,
      [candidate.rows[0].id],
    );

    const rows = await db.query<{
      id: string;
      prompt: string;
      source: string;
      is_picked: boolean;
      point_value: number | null;
    }>(
      `select id, prompt, source, is_picked, point_value
         from questions
        where id in ($1, $2)`,
      [candidate.rows[0].id, fixture.questionIds[6]],
    );
    const byId = new Map(rows.rows.map((row) => [row.id, row]));
    expect(byId.get(candidate.rows[0].id)).toMatchObject({
      prompt: "Heather final",
      source: "host-edit",
      is_picked: true,
      point_value: 700,
    });
    expect(byId.get(fixture.questionIds[6])).toMatchObject({
      is_picked: false,
      point_value: null,
    });
  });

  test("reorders the whole picked board transactionally", async () => {
    const fixture = await seedAuthoringCategory("ATOMIC2");
    const assignments = fixture.questionIds.map((id, index) => ({
      id,
      pointValue: 700 - index * 100,
    }));

    await db.query("select reorder_category_board($1, $2::jsonb)", [
      fixture.categoryId,
      JSON.stringify(assignments),
    ]);

    const rows = await db.query<{ id: string; point_value: number }>(
      "select id, point_value from questions where category_id = $1",
      [fixture.categoryId],
    );
    const byId = new Map(rows.rows.map((row) => [row.id, row.point_value]));
    for (const assignment of assignments) {
      expect(byId.get(assignment.id)).toBe(assignment.pointValue);
    }
  });

  test("rejects an incomplete reorder without partially clearing the board", async () => {
    const fixture = await seedAuthoringCategory("ATOMIC3");
    const incomplete = fixture.questionIds.slice(0, 6).map((id, index) => ({
      id,
      pointValue: (index + 1) * 100,
    }));

    await expect(
      db.query("select reorder_category_board($1, $2::jsonb)", [
        fixture.categoryId,
        JSON.stringify(incomplete),
      ]),
    ).rejects.toThrow(/cover every picked question/i);

    const remaining = await db.query<{ count: number }>(
      `select count(*)::integer as count
         from questions
        where category_id = $1
          and is_picked
          and point_value is not null`,
      [fixture.categoryId],
    );
    expect(remaining.rows[0].count).toBe(7);
  });

  test("applies all seven picks and ready state in one transaction", async () => {
    const fixture = await seedAuthoringCategory("ATOMIC4");
    const candidate = await db.query<{ id: string }>(
      `insert into questions
        (category_id, difficulty, prompt, options, correct_index, source, is_picked, point_value)
       values ($1, 7, 'Replacement', '["A","B","C","D"]'::jsonb, 0, 'host-edit', false, null)
       returning id`,
      [fixture.categoryId],
    );
    const selectedIds = [...fixture.questionIds.slice(0, 6), candidate.rows[0].id];
    const assignments = selectedIds.map((id, index) => ({
      id,
      pointValue: (index + 1) * 100,
    }));

    await db.query("select apply_category_picks($1, $2::jsonb)", [
      fixture.categoryId,
      JSON.stringify(assignments),
    ]);

    const picked = await db.query<{
      id: string;
      is_picked: boolean;
      point_value: number | null;
    }>(
      "select id, is_picked, point_value from questions where category_id = $1",
      [fixture.categoryId],
    );
    const byId = new Map(picked.rows.map((row) => [row.id, row]));
    expect(byId.get(fixture.questionIds[6])).toMatchObject({
      is_picked: false,
      point_value: null,
    });
    expect(byId.get(candidate.rows[0].id)).toMatchObject({
      is_picked: true,
      point_value: 700,
    });
    expect(picked.rows.filter((row) => row.is_picked)).toHaveLength(7);
  });

  test("replaces a manual category and marks it ready in one transaction", async () => {
    const fixture = await seedAuthoringCategory("MANUAL1");
    await db.query("update categories set state = 'draft' where id = $1", [
      fixture.categoryId,
    ]);
    const questions = Array.from({ length: 7 }, (_, index) => ({
      category_id: fixture.categoryId,
      prompt: `Heather manual ${index + 1}`,
      options: ["A", "B", "C", "D"],
      correct_index: index % 4,
      difficulty: index + 1,
      point_value: (index + 1) * 100,
      source: "host-edit",
      is_picked: true,
      image_url: null,
      image_source: null,
      image_attribution: null,
    }));

    const result = await db.query<{ result: { questions: unknown[] } }>(
      "select replace_category_with_manual_questions($1, $2::jsonb) as result",
      [fixture.categoryId, JSON.stringify(questions)],
    );

    expect(result.rows[0].result.questions).toHaveLength(7);
    const saved = await db.query<{
      prompt: string;
      point_value: number;
      source: string;
      is_picked: boolean;
    }>(
      `select prompt, point_value, source, is_picked
         from questions
        where category_id = $1
        order by point_value`,
      [fixture.categoryId],
    );
    expect(saved.rows).toHaveLength(7);
    expect(saved.rows[0]).toMatchObject({
      prompt: "Heather manual 1",
      point_value: 100,
      source: "host-edit",
      is_picked: true,
    });
    const category = await db.query<{ state: string }>(
      "select state from categories where id = $1",
      [fixture.categoryId],
    );
    expect(category.rows[0].state).toBe("ready");
  });

  test("rejects manual replacement after Start without deleting the saved board", async () => {
    const fixture = await seedAuthoringCategory("MANUAL2");
    await db.query("update games set state = 'live' where id = $1", [
      fixture.gameId,
    ]);
    const questions = Array.from({ length: 7 }, (_, index) => ({
      category_id: fixture.categoryId,
      prompt: `Late manual ${index + 1}`,
      options: ["A", "B", "C", "D"],
      correct_index: 0,
      difficulty: index + 1,
      point_value: (index + 1) * 100,
      source: "host-edit",
      is_picked: true,
      image_url: null,
      image_source: null,
      image_attribution: null,
    }));

    await expect(
      db.query(
        "select replace_category_with_manual_questions($1, $2::jsonb)",
        [fixture.categoryId, JSON.stringify(questions)],
      ),
    ).rejects.toThrow(/board cannot change after its game starts/i);

    const saved = await db.query<{ count: number; late: number }>(
      `select count(*)::integer as count,
              count(*) filter (where prompt like 'Late manual%')::integer as late
         from questions
        where category_id = $1`,
      [fixture.categoryId],
    );
    expect(saved.rows[0]).toEqual({ count: 7, late: 0 });
  });
});
