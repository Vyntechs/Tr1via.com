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
const FENCE_PATH = path.join(
  MIGRATIONS_DIR,
  "0029_generation_attempt_fencing.sql",
);
const fenceSql = existsSync(FENCE_PATH) ? readFileSync(FENCE_PATH, "utf8") : "";
const PHOTO_QUERY_PATH = path.join(
  MIGRATIONS_DIR,
  "0030_questions_photo_query.sql",
);
const photoQuerySql = existsSync(PHOTO_QUERY_PATH)
  ? readFileSync(PHOTO_QUERY_PATH, "utf8")
  : "";
const BOARD_SLOT_FIX_PATH = path.join(
  MIGRATIONS_DIR,
  "0031_atomic_board_slot_selection.sql",
);
const boardSlotFixSql = existsSync(BOARD_SLOT_FIX_PATH)
  ? readFileSync(BOARD_SLOT_FIX_PATH, "utf8")
  : "";

interface FunctionSecurity {
  owner: string;
  security_definer: boolean;
  config: string[] | null;
  anon_can_execute: boolean;
  authenticated_can_execute: boolean;
  service_role_can_execute: boolean;
}

describe("generation attempt transactional fencing", () => {
  let db: PGlite | null = null;
  let categoryId = "";
  let gameId = "";
  let nightId = "";
  let hostId = "";
  let securityBeforePhotoQuery: FunctionSecurity | null = null;
  let securityAfterPhotoQuery: FunctionSecurity | null = null;

  beforeAll(async () => {
    if (!fenceSql) return;
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
      "0015_question_generation_reports.sql",
      "0016_question_generation_reports_privileges.sql",
      "0019_question_generation_jobs.sql",
      "0020_question_generation_jobs_advisor_fixes.sql",
    ]) {
      await db.exec(readFileSync(path.join(MIGRATIONS_DIR, migration), "utf8"));
    }
    await db.exec(fenceSql);
    const readFunctionSecurity = async () =>
      (
        await db!.query<FunctionSecurity>(`
          select
            pg_get_userbyid(p.proowner) as owner,
            p.prosecdef as security_definer,
            p.proconfig as config,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
            has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
          from pg_proc p
          where p.oid = 'public.commit_generation_questions(uuid,smallint,jsonb,uuid[])'::regprocedure
        `)
      ).rows[0]!;
    securityBeforePhotoQuery = await readFunctionSecurity();
    await db.exec(photoQuerySql);
    securityAfterPhotoQuery = await readFunctionSecurity();
    await db.exec(boardSlotFixSql);

    const one = async <T>(sql: string, params: unknown[] = []) =>
      (await db!.query<T>(sql, params)).rows[0]!;
    const id = async (sql: string, params: unknown[] = []) =>
      (await one<{ id: string }>(`${sql} returning id`, params)).id;
    const userId = await id("insert into auth.users default values");
    hostId = await id(
      "insert into hosts (user_id, display_name) values ($1, 'Heather')",
      [userId],
    );
    nightId = await id(
      "insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', 'FENCE1')",
      [hostId],
    );
    gameId = await id("insert into games (night_id, game_no) values ($1, 1)", [nightId]);
    categoryId = await id(
      "insert into categories (game_id, name, topic, position, state) values ($1, 'Snakes', 'Non-venomous snakes', 0, 'generating')",
      [gameId],
    );
    await db.query(
      `insert into question_generation_jobs (
        category_id, game_id, night_id, host_id, phase, attempt
      ) values ($1, $2, $3, $4, 'writing', 1)`,
      [categoryId, gameId, nightId, hostId],
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  test("the additive fencing migration exists and is private", async () => {
    expect(fenceSql).toContain("commit_generation_questions");
    expect(fenceSql).toContain("commit_generation_photo");
    expect(fenceSql).toContain("complete_question_generation");
    expect(fenceSql).toContain("fail_question_generation");
    expect(fenceSql).toContain("revoke all on function");
  });

  test("the photo-query replacement preserves the fenced function security contract", () => {
    expect(photoQuerySql).not.toBe("");
    expect(securityAfterPhotoQuery).toEqual(securityBeforePhotoQuery);
    expect(securityAfterPhotoQuery).toMatchObject({
      security_definer: true,
      anon_can_execute: false,
      authenticated_can_execute: false,
      service_role_can_execute: true,
    });
    expect(securityAfterPhotoQuery?.config).toContain(
      "search_path=pg_catalog, public",
    );
  });

  test("serializes auto-pick completion on the game before selected-row writes", async () => {
    expect(db).not.toBeNull();
    if (!db) return;

    const functionDefinition = await db.query<{ definition: string }>(
      `select pg_get_functiondef(
         'public.complete_question_generation(uuid,smallint,jsonb,jsonb,text,smallint,smallint,smallint)'::regprocedure
       ) as definition`,
    );
    const definition = functionDefinition.rows[0]?.definition.toLowerCase() ?? "";
    const gameLock = definition.indexOf("_lock_board_authoring_game");
    const firstQuestionMutation = definition.indexOf("update public.questions");

    expect(gameLock).toBeGreaterThan(-1);
    expect(firstQuestionMutation).toBeGreaterThan(gameLock);
  });

  test("a certified batch commits only for the current attempt", async () => {
    expect(db).not.toBeNull();
    if (!db) return;
    const currentQuestionId = crypto.randomUUID();
    const staleQuestionId = crypto.randomUUID();
    const question = (id: string, prompt: string, photoQuery: string) =>
      JSON.stringify([
        {
          id,
          prompt,
          options: ["A", "B", "C", "D"],
          correctIndex: 0,
          difficulty: 4,
          factBlurb: "Verified fact.",
          photoQuery,
        },
      ]);

    const current = await db.query<{ result: { applied: boolean; code: string } }>(
      "select commit_generation_questions($1, 1::smallint, $2::jsonb, '{}'::uuid[]) as result",
      [
        categoryId,
        question(
          currentQuestionId,
          "Current worker question",
          "surveillance television studio",
        ),
      ],
    );
    expect(current.rows[0]?.result).toMatchObject({ applied: true, code: "applied" });

    const observed = await db.query<{ heartbeat_at: string }>(
      `update question_generation_jobs
       set heartbeat_at = now() - interval '2 minutes'
       where category_id = $1
       returning heartbeat_at`,
      [categoryId],
    );
    const claim = await db.query<{ result: { applied: boolean; job: { attempt: number } } }>(
      `select claim_question_generation_resume(
        $1, 1::smallint, 'writing', $2::timestamptz, '{}'::jsonb
      ) as result`,
      [categoryId, observed.rows[0]!.heartbeat_at],
    );
    expect(claim.rows[0]?.result).toMatchObject({
      applied: true,
      job: { attempt: 2 },
    });
    const stale = await db.query<{ result: { applied: boolean; code: string } }>(
      "select commit_generation_questions($1, 1::smallint, $2::jsonb, '{}'::uuid[]) as result",
      [
        categoryId,
        question(staleQuestionId, "Stale worker question", "stale visual query"),
      ],
    );
    expect(stale.rows[0]?.result).toEqual({ applied: false, code: "stale" });

    const rows = await db.query<{ id: string; photo_query: string | null }>(
      "select id, photo_query from questions where category_id = $1 order by id",
      [categoryId],
    );
    expect(rows.rows).toEqual([
      {
        id: currentQuestionId,
        photo_query: "surveillance television studio",
      },
    ]);
  });

  test("stale photo, completion, and failure effects change no durable state", async () => {
    expect(db).not.toBeNull();
    if (!db) return;
    const question = await db.query<{ id: string; image_url: string | null }>(
      "select id, image_url from questions where category_id = $1 limit 1",
      [categoryId],
    );
    const questionId = question.rows[0]!.id;

    const photo = await db.query<{ result: { applied: boolean; code: string } }>(
      "select commit_generation_photo($1, 1::smallint, $2, 'https://stale.example/photo.jpg', 'Stale', 'pexels') as result",
      [categoryId, questionId],
    );
    expect(photo.rows[0]?.result).toEqual({ applied: false, code: "stale" });

    const report = JSON.stringify({
      mode: "initial",
      status: "completed",
      requested_count: 20,
      accepted_count: 20,
      generated_count: 20,
      rejected_count: 0,
      rounds: 1,
      verify_passes: 2,
      llm_calls: 3,
      tokens_in: 100,
      tokens_out: 100,
      estimated_cost_usd: 0.01,
      image_target_count: 20,
      image_attached_count: 0,
      image_skipped_count: 20,
      risk_flag_count: 0,
      report: {},
    });
    const complete = await db.query<{ result: { applied: boolean; code: string } }>(
      "select complete_question_generation($1, 1::smallint, $2::jsonb, null, 'review', 20::smallint, 20::smallint, 0::smallint) as result",
      [categoryId, report],
    );
    expect(complete.rows[0]?.result).toEqual({ applied: false, code: "stale" });
    const fail = await db.query<{ result: { applied: boolean; code: string } }>(
      "select fail_question_generation($1, 1::smallint, null, 'stale failure') as result",
      [categoryId],
    );
    expect(fail.rows[0]?.result).toEqual({ applied: false, code: "stale" });

    const state = await db.query<{ state: string; phase: string; reports: number; image_url: string | null }>(
      `select c.state, j.phase,
        (select count(*)::int from question_generation_reports where category_id = c.id) as reports,
        (select image_url from questions where id = $2) as image_url
       from categories c
       join question_generation_jobs j on j.category_id = c.id
       where c.id = $1`,
      [categoryId, questionId],
    );
    expect(state.rows[0]).toEqual({
      state: "generating",
      phase: "queued",
      reports: 0,
      image_url: null,
    });
  });

  test("the current attempt atomically picks and completes while fresh runs stay monotonic", async () => {
    expect(db).not.toBeNull();
    if (!db) return;
    const extra = Array.from({ length: 6 }, (_, index) => ({
      id: crypto.randomUUID(),
      prompt: `Current question ${index + 2}`,
      options: ["A", "B", "C", "D"],
      correctIndex: 0,
      difficulty: index + 1,
      factBlurb: "Verified fact.",
    }));
    const insert = await db.query<{ result: { applied: boolean } }>(
      "select commit_generation_questions($1, 2::smallint, $2::jsonb, '{}'::uuid[]) as result",
      [categoryId, JSON.stringify(extra)],
    );
    expect(insert.rows[0]?.result.applied).toBe(true);

    const all = await db.query<{ id: string }>(
      "select id from questions where category_id = $1 order by id",
      [categoryId],
    );
    const assignments = all.rows.map((row, index) => ({
      id: row.id,
      pointValue: (index + 1) * 100,
    }));
    const report = JSON.stringify({
      mode: "auto_build",
      status: "completed",
      requested_count: 20,
      accepted_count: 20,
      generated_count: 20,
      rejected_count: 0,
      rounds: 1,
      verify_passes: 2,
      llm_calls: 3,
      tokens_in: 100,
      tokens_out: 100,
      estimated_cost_usd: 0.01,
      image_target_count: 7,
      image_attached_count: 0,
      image_skipped_count: 7,
      risk_flag_count: 0,
      report: {},
    });
    const complete = await db.query<{ result: { applied: boolean } }>(
      "select complete_question_generation($1, 2::smallint, $2::jsonb, $3::jsonb, 'ready', 20::smallint, 20::smallint, 0::smallint) as result",
      [categoryId, report, JSON.stringify(assignments)],
    );
    expect(complete.rows[0]?.result.applied).toBe(true);

    const completed = await db.query<{ state: string; phase: string; picked: number; reports: number }>(
      `select c.state, j.phase,
        (select count(*)::int from questions where category_id = c.id and is_picked) as picked,
        (select count(*)::int from question_generation_reports where category_id = c.id) as reports
       from categories c join question_generation_jobs j on j.category_id = c.id
       where c.id = $1`,
      [categoryId],
    );
    expect(completed.rows[0]).toEqual({
      state: "ready",
      phase: "ready",
      picked: 7,
      reports: 1,
    });

    await db.query("update categories set state = 'review' where id = $1", [categoryId]);
    const begun = await db.query<{ result: { applied: boolean; job: { attempt: number } } }>(
      `select begin_question_generation(
        $1, 20::smallint, '{}'::jsonb
      ) as result`,
      [categoryId],
    );
    expect(begun.rows[0]?.result).toMatchObject({
      applied: true,
      job: { attempt: 3 },
    });
  });
});
