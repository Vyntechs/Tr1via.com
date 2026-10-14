// @vitest-environment node

// A typo fix on the topic screen: an EMPTY category takes the new topic in
// place (lib/host/retopicEmptyCategory.ts). Runs against a throwaway Postgres
// (pglite) with the real migrations, so the 0029 attempt fencing and the 0031
// board guard are the real ones. The old topic's generation must not be able to
// write anything into the renamed row afterwards.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { retopicEmptyCategory, type RetopicTarget } from "@/lib/host/retopicEmptyCategory";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
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
  "0031_atomic_board_slot_selection.sql",
];

let db: PGlite;
let gameId: string;
/** Runs once, right after the first question count (to land a write mid-way). */
let afterFirstCount: (() => Promise<void>) | null = null;

// The few supabase-js call shapes retopicEmptyCategory uses, over pglite.
function table(name: string) {
  let op: "select" | "update" = "select";
  let columns = "*";
  let head = false;
  let patch: Record<string, unknown> = {};
  const filters: Array<[string, unknown]> = [];

  async function exec() {
    const offset = op === "update" ? Object.keys(patch).length : 0;
    const where = filters.map(([c], i) => `${c} = $${i + 1 + offset}`).join(" and ");
    const values = filters.map(([, v]) => v);
    try {
      if (op === "update") {
        const keys = Object.keys(patch);
        const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
        const r = await db.query(`update ${name} set ${sets} where ${where} returning *`, [
          ...keys.map((k) => patch[k]),
          ...values,
        ]);
        return { rows: r.rows as Record<string, unknown>[], count: null, error: null };
      }
      if (head) {
        const r = await db.query<{ n: number }>(
          `select count(*)::int n from ${name} where ${where}`,
          values,
        );
        const count = r.rows[0].n;
        if (name === "questions" && afterFirstCount) {
          const hook = afterFirstCount;
          afterFirstCount = null;
          await hook();
        }
        return { rows: [], count, error: null };
      }
      const r = await db.query(`select ${columns} from ${name} where ${where}`, values);
      return { rows: r.rows as Record<string, unknown>[], count: null, error: null };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      return { rows: [], count: null, error: { code: e.code, message: e.message ?? String(err) } };
    }
  }

  const builder = {
    select(cols: string, opts?: { head?: boolean }) {
      if (op === "select") columns = cols;
      if (opts?.head) head = true;
      return builder;
    },
    update(values: Record<string, unknown>) {
      op = "update";
      patch = values;
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return builder;
    },
    async maybeSingle() {
      const { rows, error } = await exec();
      return { data: error ? null : (rows[0] ?? null), error };
    },
    then(resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) {
      return exec().then(
        ({ rows, count, error }) => resolve({ data: error ? null : rows, count, error }),
        reject,
      );
    },
  };
  return builder;
}

const admin = { from: (name: string) => table(name) } as unknown as Parameters<
  typeof retopicEmptyCategory
>[0];
const noWait = async () => undefined;

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
  for (const m of CHAIN) await db.exec(readFileSync(path.join(MIGRATIONS, m), "utf8"));
  const user = await db.query<{ id: string }>("insert into auth.users default values returning id");
  const host = await db.query<{ id: string }>(
    "insert into hosts (user_id, display_name) values ($1, 'Heather') returning id",
    [user.rows[0].id],
  );
  const night = await db.query<{ id: string }>(
    "insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', 'PF8NVJ') returning id",
    [host.rows[0].id],
  );
  const g = await db.query<{ id: string }>(
    "insert into games (night_id, game_no) values ($1, 1) returning id",
    [night.rows[0].id],
  );
  gameId = g.rows[0].id;
  afterFirstCount = null;
});

afterEach(async () => {
  await db.close();
});

async function seedCategory(state = "draft", topic = "Ghost Storys"): Promise<RetopicTarget> {
  const r = await db.query<RetopicTarget>(
    `insert into categories (game_id, name, topic, position, state)
     values ($1, $2, $2, 3, $3) returning id, game_id, name, topic, position, state`,
    [gameId, topic, state],
  );
  return r.rows[0];
}

async function rpc(name: string, sql: string, params: unknown[]) {
  const r = await db.query<{ result: { applied: boolean; code: string } }>(
    `select public.${name}(${sql}) as result`,
    params,
  );
  return r.rows[0].result;
}

/** What the generate route does to start a build: state 'generating', job queued. */
async function beginBuild(categoryId: string) {
  const r = await rpc(
    "begin_question_generation",
    "$1::uuid, 20::smallint, '{}'::jsonb",
    [categoryId],
  );
  expect(r.applied).toBe(true);
  return job(categoryId);
}

async function job(categoryId: string) {
  const r = await db.query<{ attempt: number; phase: string }>(
    "select attempt, phase from question_generation_jobs where category_id = $1",
    [categoryId],
  );
  return r.rows[0];
}

/** The old worker saving candidate questions, fenced on its attempt. */
async function workerCommits(categoryId: string, attempt: number, count = 1) {
  const items = Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    prompt: `Old topic Q${i}`,
    options: ["A", "B", "C", "D"],
    correctIndex: 0,
    difficulty: 1,
    factBlurb: null,
  }));
  return rpc(
    "commit_generation_questions",
    "$1::uuid, $2::smallint, $3::jsonb",
    [categoryId, attempt, JSON.stringify(items)],
  );
}

async function row(categoryId: string) {
  const r = await db.query<{ name: string; topic: string; state: string }>(
    "select name, topic, state from categories where id = $1",
    [categoryId],
  );
  return r.rows[0];
}

async function questionCount(categoryId: string) {
  const r = await db.query<{ n: number }>(
    "select count(*)::int n from questions where category_id = $1",
    [categoryId],
  );
  return r.rows[0].n;
}

const NEW = { topic: "Ghost Stories", name: "Ghost Stories" };

describe("retopicEmptyCategory (real 0029 fencing + 0031 guard on pglite)", () => {
  test("an empty draft row takes the new topic in place, same id", async () => {
    const cat = await seedCategory("draft");
    const out = await retopicEmptyCategory(admin, cat, NEW, noWait);
    expect(out).toMatchObject({ kind: "retopicked", category: { id: cat.id, state: "draft" } });
    expect(await row(cat.id)).toEqual({ name: "Ghost Stories", topic: "Ghost Stories", state: "draft" });
  });

  test("a build in flight for the old topic is fenced: its late writes change nothing", async () => {
    const cat = await seedCategory("draft");
    const old = await beginBuild(cat.id);
    expect(old).toEqual({ attempt: 1, phase: "queued" });

    const out = await retopicEmptyCategory(admin, { ...cat, state: "generating" }, NEW, noWait);
    expect(out.kind).toBe("retopicked");
    expect(await row(cat.id)).toMatchObject({ topic: "Ghost Stories", state: "draft" });
    expect(await job(cat.id)).toEqual({ attempt: 2, phase: "needs_attention" });

    // The old worker wakes up late with attempt 1.
    expect(await workerCommits(cat.id, 1, 5)).toMatchObject({ applied: false, code: "stale" });
    const progress = await db.query(
      "update question_generation_jobs set phase = 'writing' where category_id = $1 and attempt = 1 returning 1",
      [cat.id],
    );
    expect(progress.rows).toHaveLength(0);
    const failed = await rpc(
      "fail_question_generation",
      "$1::uuid, 1::smallint, null::text, 'boom'::text",
      [cat.id],
    );
    expect(failed.applied).toBe(false);
    expect(await questionCount(cat.id)).toBe(0);
    expect(await row(cat.id)).toMatchObject({ topic: "Ghost Stories", state: "draft" });

    // The new topic's build starts a fresh attempt and its writes land.
    const fresh = await beginBuild(cat.id);
    expect(fresh.attempt).toBe(3);
    expect(await workerCommits(cat.id, 3, 2)).toMatchObject({ applied: true });
    expect(await questionCount(cat.id)).toBe(2);
  });

  test("a paused build (question-writing failed, nothing saved) takes the new topic", async () => {
    const cat = await seedCategory("draft");
    await beginBuild(cat.id);
    await rpc("fail_question_generation", "$1::uuid, 1::smallint, null::text, 'wifi'::text", [cat.id]);
    expect(await job(cat.id)).toEqual({ attempt: 1, phase: "needs_attention" });

    const out = await retopicEmptyCategory(admin, { ...cat, state: "generating" }, NEW, noWait);
    expect(out.kind).toBe("retopicked");
    expect(await row(cat.id)).toMatchObject({ topic: "Ghost Stories", state: "draft" });
  });

  test("a row that already has questions keeps its topic", async () => {
    const cat = await seedCategory("draft");
    await beginBuild(cat.id);
    await workerCommits(cat.id, 1, 3);
    const out = await retopicEmptyCategory(admin, { ...cat, state: "generating" }, NEW, noWait);
    expect(out.kind).toBe("keep");
    expect(await row(cat.id)).toMatchObject({ topic: "Ghost Storys", state: "generating" });
    // Not paused: the build that has questions keeps running.
    expect(await job(cat.id)).toEqual({ attempt: 1, phase: "queued" });
  });

  test("questions saved just before the fence are seen, and the row keeps its topic", async () => {
    const cat = await seedCategory("draft");
    await beginBuild(cat.id);
    // The old worker saves 4 questions between the first count and the fence.
    afterFirstCount = async () => {
      expect(await workerCommits(cat.id, 1, 4)).toMatchObject({ applied: true });
    };
    const out = await retopicEmptyCategory(admin, { ...cat, state: "generating" }, NEW, noWait);
    expect(out.kind).toBe("keep");
    expect(await row(cat.id)).toMatchObject({ topic: "Ghost Storys" });
    expect(await questionCount(cat.id)).toBe(4);
    // The build is paused (resumable from the pick screen), not lost.
    expect(await job(cat.id)).toEqual({ attempt: 2, phase: "needs_attention" });
  });

  test("a locked row, or a game that has started, keeps its topic", async () => {
    const locked = await seedCategory("ready");
    expect((await retopicEmptyCategory(admin, locked, NEW, noWait)).kind).toBe("keep");
    expect(await row(locked.id)).toMatchObject({ topic: "Ghost Storys" });

    await db.query("delete from categories where id = $1", [locked.id]);
    const cat = await seedCategory("draft");
    for (const state of ["live", "done"]) {
      await db.query("update games set state = $2 where id = $1", [gameId, state]);
      expect((await retopicEmptyCategory(admin, cat, NEW, noWait)).kind).toBe("keep");
      expect(await row(cat.id)).toMatchObject({ topic: "Ghost Storys" });
    }
  });

  test("the board guard still refuses a topic change once the game starts", async () => {
    // Belt and braces: even if the game starts after the state check, the
    // update itself is refused (55000) and nothing changes.
    const cat = await seedCategory("draft");
    await db.query("update games set state = 'live' where id = $1", [gameId]);
    const err = await db
      .query("update categories set topic = 'x', name = 'x' where id = $1", [cat.id])
      .then(() => null, (e: { code?: string }) => e.code);
    expect(err).toBe("55000");
  });

  test("a row changed by someone else meanwhile is left alone (busy)", async () => {
    const cat = await seedCategory("draft");
    // Our copy says 'draft', but another tap already started a build.
    await beginBuild(cat.id);
    await db.query("update categories set topic = 'Something Else' where id = $1", [cat.id]);
    const out = await retopicEmptyCategory(admin, cat, NEW, noWait);
    expect(out.kind).toBe("busy");
    expect(await row(cat.id)).toMatchObject({ topic: "Something Else" });
  });
});
