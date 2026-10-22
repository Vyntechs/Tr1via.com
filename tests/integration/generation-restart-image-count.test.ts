// @vitest-environment node
//
// Restarting ("Continue") a question build that was killed after its photos had
// started. The database refuses a row where image_count > certified_count
// (constraint question_generation_jobs_check1). A restart used to rewrite
// certified_count to 0 while the killed run's image_count was still on the row,
// so every Continue failed instantly with that constraint error.
//
// These tests run the REAL generate route against a real Postgres (pglite) with
// the real migrations. Only the outside services (Anthropic, Pexels, realtime
// broadcast, sign-in) are replaced.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

const h = vi.hoisted(() => {
  const state = {
    db: null as import("@electric-sql/pglite").PGlite | null,
    afterTasks: [] as Array<() => Promise<void>>,
    owned: null as unknown,
    generateQuestions: vi.fn(),
    verifyAnswers: vi.fn(),
    autoAttachPhoto: vi.fn(),
    broadcast: vi.fn(async () => undefined),
  };

  // Casts for the generation RPC arguments (named-argument call, so the order
  // in the route does not matter).
  const CAST: Record<string, string> = {
    p_category_id: "uuid",
    p_question_id: "uuid",
    p_attempt: "smallint",
    p_observed_attempt: "smallint",
    p_target_count: "smallint",
    p_written_count: "smallint",
    p_certified_count: "smallint",
    p_image_count: "smallint",
    p_flavor: "jsonb",
    p_questions: "jsonb",
    p_report: "jsonb",
    p_assignments: "jsonb",
    p_delete_ids: "uuid[]",
    p_observed_heartbeat_at: "timestamptz",
  };

  async function run(sql: string, params: unknown[]) {
    try {
      const result = await state.db!.query(sql, params);
      return { rows: result.rows as Record<string, unknown>[], error: null };
    } catch (err) {
      return {
        rows: [] as Record<string, unknown>[],
        error: { message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  // The few supabase-js call shapes the generate route uses.
  function table(name: string) {
    let op: "select" | "update" = "select";
    let columns = "*";
    let patch: Record<string, unknown> = {};
    const filters: Array<[string, unknown]> = [];

    async function exec() {
      const where = filters
        .map(([column], i) => `${column} = $${i + 1 + Object.keys(patch).length}`)
        .join(" and ");
      const values = filters.map(([, value]) => value);
      if (op === "update") {
        const keys = Object.keys(patch);
        const sets = keys.map((key, i) => `${key} = $${i + 1}`).join(", ");
        return run(
          `update ${name} set ${sets} where ${where} returning *`,
          [...keys.map((key) => patch[key]), ...values],
        );
      }
      return run(`select ${columns} from ${name} where ${where}`, values);
    }

    const builder = {
      select(cols: string) {
        if (op === "select") columns = cols;
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
      then(
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) {
        return exec().then(
          ({ rows, error }) => resolve({ data: error ? null : rows, error }),
          reject,
        );
      },
    };
    return builder;
  }

  const admin = {
    from: (name: string) => table(name),
    async rpc(name: string, args: Record<string, unknown>) {
      const keys = Object.keys(args);
      const named = keys
        .map((key, i) => `${key} => $${i + 1}::${CAST[key] ?? "text"}`)
        .join(", ");
      const params = keys.map((key) => {
        const value = args[key];
        if (value !== null && typeof value === "object" && key !== "p_delete_ids") {
          return JSON.stringify(value);
        }
        return value;
      });
      const { rows, error } = await run(
        `select public.${name}(${named}) as result`,
        params,
      );
      return { data: error ? null : rows[0]?.result, error };
    },
  };

  return { ...state, state, admin };
});

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  // Run the background work when the test says so, not after a real response.
  after: (task: () => Promise<void>) => {
    h.state.afterTasks.push(task);
  },
}));
vi.mock("@/lib/api/auth", () => ({
  requireOwnedCategory: vi.fn(async () => h.state.owned),
}));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => h.admin }));
vi.mock("@/lib/api/broadcast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/broadcast")>()),
  broadcastToCategory: h.state.broadcast,
}));
vi.mock("@/lib/ai/generate-questions", () => ({
  generateQuestions: h.state.generateQuestions,
}));
vi.mock("@/lib/ai/verify-answers", () => ({
  verifyAnswers: h.state.verifyAnswers,
}));
vi.mock("@/lib/ai/auto-attach-photo", () => ({
  autoAttachPhoto: h.state.autoAttachPhoto,
}));

import { POST } from "@/app/api/categories/[id]/generate/route";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);
// Same migration list the fencing tests use for the generation functions.
const MIGRATIONS = [
  "0001_init.sql",
  "0015_question_generation_reports.sql",
  "0016_question_generation_reports_privileges.sql",
  "0019_question_generation_jobs.sql",
  "0020_question_generation_jobs_advisor_fixes.sql",
  "0029_generation_attempt_fencing.sql",
  "0030_questions_photo_query.sql",
  "0031_atomic_board_slot_selection.sql",
  "20260831135541_host_image_authority.sql",
];

const PAUSED_TEXT = "The question builder paused before it finished.";

interface JobRow {
  phase: string;
  attempt: number;
  certified_count: number;
  image_count: number;
  written_count: number;
  last_error: string | null;
}

describe("restarting a build killed after its photos had started", () => {
  let db: PGlite;
  let hostId = "";
  let nightId = "";
  let gameId = "";
  let position = 0;
  let consoleError: ReturnType<typeof vi.spyOn>;
  let clockSkewMs = 0;

  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows[0]!;

  beforeAll(async () => {
    db = new PGlite();
    h.state.db = db;
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
    for (const migration of MIGRATIONS) {
      await db.exec(readFileSync(path.join(MIGRATIONS_DIR, migration), "utf8"));
    }
    const user = await one<{ id: string }>(
      "insert into auth.users default values returning id",
    );
    hostId = (
      await one<{ id: string }>(
        "insert into hosts (user_id, display_name) values ($1, 'Test Host') returning id",
        [user.id],
      )
    ).id;
    nightId = (
      await one<{ id: string }>(
        "insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', 'RESTRT') returning id",
        [hostId],
      )
    ).id;
    gameId = (
      await one<{ id: string }>(
        "insert into games (night_id, game_no) values ($1, 1) returning id",
        [nightId],
      )
    ).id;
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  beforeEach(() => {
    h.state.afterTasks.length = 0;
    h.state.generateQuestions.mockReset();
    h.state.verifyAnswers.mockReset();
    h.state.autoAttachPhoto.mockReset();
    h.state.broadcast.mockClear();
    clockSkewMs = 0;
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + clockSkewMs);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // Every check passes unless a test says a prompt is rejected.
    h.state.verifyAnswers.mockImplementation(
      async (
        questions: Array<{ prompt: string }>,
        opts: { mode?: string },
      ) =>
        questions.map((question, index) => ({
          index,
          markedAnswerIsCorrect: !question.prompt.includes("REJECTME"),
          ambiguous: false,
          factBlurbIsCorrect: opts.mode === "adversarial" ? true : null,
          answerableWithoutImage: true,
          fitsRequestedTopic: true,
        })),
    );
    let photoNo = 0;
    h.state.autoAttachPhoto.mockImplementation(async () => {
      photoNo += 1;
      return {
        imageUrl: `https://images.pexels.com/new-photo-${photoNo}.jpg`,
        attribution: "Pexels test",
        alternatives: [],
        source: "primary",
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * The exact shape a real build was left in after the platform cut it off:
   * 20 saved questions, 16 already carrying a photo, and a job row saying
   * 20 certified / 16 images, stopped in the photo step.
   */
  async function seedStuckBuild(opts: {
    questions?: number;
    withPhoto?: number;
    certifiedCount?: number;
    imageCount?: number;
    promptFor?: (n: number) => string;
  } = {}) {
    const total = opts.questions ?? 20;
    const withPhoto = opts.withPhoto ?? 16;
    const category = await one<{ id: string }>(
      `insert into categories (game_id, name, topic, position, state)
       values ($1, 'Sample Topic', 'Sample Topic', $2, 'generating')
       returning id`,
      [gameId, position++],
    );
    const questionIds: string[] = [];
    for (let n = 0; n < total; n++) {
      const row = await one<{ id: string }>(
        `insert into questions (
           category_id, prompt, options, correct_index, difficulty, fact_blurb,
           source, is_picked, photo_query, image_url, image_source
         ) values ($1, $2, '["Alpha","Bravo","Charlie","Delta"]'::jsonb, 0, $3,
           'A saved fact.', 'ai', false, $4, $5, $6)
         returning id`,
        [
          category.id,
          opts.promptFor?.(n) ?? `Saved question number ${n} about this topic`,
          (n % 7) + 1,
          `saved scene ${n}`,
          n < withPhoto ? `https://images.pexels.com/saved-${n}.jpg` : null,
          n < withPhoto ? "pexels" : null,
        ],
      );
      questionIds.push(row.id);
    }
    await db.query(
      `insert into question_generation_jobs (
         category_id, game_id, night_id, host_id, phase, target_count,
         written_count, certified_count, image_count, attempt, last_error,
         heartbeat_at
       ) values ($1, $2, $3, $4, 'needs_attention', 20, 20, $5, $6, 2,
         $7, now() - interval '5 minutes')`,
      [
        category.id,
        gameId,
        nightId,
        hostId,
        opts.certifiedCount ?? total,
        opts.imageCount ?? withPhoto,
        PAUSED_TEXT,
      ],
    );
    h.state.owned = {
      ok: true,
      host: {
        id: hostId,
        role: "host",
        is_paywall_bypassed: true,
        trial_ends_at: null,
        subscription_status: null,
      },
      night: { id: nightId, theme_key: "house" },
      category: {
        id: category.id,
        game_id: gameId,
        name: "Sample Topic",
        topic: "Sample Topic",
        state: "generating",
      },
    };
    return { categoryId: category.id, questionIds };
  }

  async function pressContinue(categoryId: string) {
    const res = await POST(
      new NextRequest(`http://test/api/categories/${categoryId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ id: categoryId }) },
    );
    // The background work the route schedules after it answers.
    for (const task of h.state.afterTasks.splice(0)) await task();
    return res;
  }

  const readJob = (categoryId: string) =>
    one<JobRow>(
      `select phase, attempt, certified_count, image_count, written_count, last_error
       from question_generation_jobs where category_id = $1`,
      [categoryId],
    );
  const readCategoryState = async (categoryId: string) =>
    (
      await one<{ state: string }>("select state from categories where id = $1", [
        categoryId,
      ])
    ).state;
  const photoCount = async (categoryId: string) =>
    Number(
      (
        await one<{ n: string }>(
          "select count(*) as n from questions where category_id = $1 and image_url is not null",
          [categoryId],
        )
      ).n,
    );

  test("the database still refuses more photos than certified questions", async () => {
    const { categoryId } = await seedStuckBuild();
    await expect(
      db.query(
        `update question_generation_jobs set certified_count = 0 where category_id = $1`,
        [categoryId],
      ),
    ).rejects.toThrow(/question_generation_jobs_check1/);
  });

  test("Continue on the stuck build (20 certified, 16 photos) finishes it", async () => {
    const { categoryId } = await seedStuckBuild();

    const res = await pressContinue(categoryId);
    expect(res.status).toBe(202);

    // The old failure, word for word, must be gone.
    const logged = consoleError.mock.calls.map((call) => String(call[1] ?? call[0]));
    expect(logged.join("\n")).not.toContain("question_generation_jobs_check1");

    const job = await readJob(categoryId);
    expect(job.phase).toBe("ready");
    expect(job.last_error).toBeNull();
    expect(job.certified_count).toBe(20);
    expect(job.attempt).toBe(3);
    expect(await readCategoryState(categoryId)).toBe("review");

    // No new writing is paid for: the 20 saved questions are re-checked, then
    // only the 4 that still have no photo are looked up.
    expect(h.state.generateQuestions).not.toHaveBeenCalled();
    expect(h.state.autoAttachPhoto).toHaveBeenCalledTimes(4);
    expect(job.image_count).toBe(20);
    expect(await photoCount(categoryId)).toBe(20);
  });

  test("a re-check that drops photographed questions still restarts cleanly", async () => {
    // 6 of the 16 photographed questions fail the re-check, leaving 14
    // certified (below the 16 photos the killed run recorded).
    const { categoryId } = await seedStuckBuild({
      promptFor: (n) =>
        n < 6 ? `Saved question number ${n} REJECTME` : `Saved question number ${n} about this topic`,
    });
    h.state.generateQuestions.mockImplementation(
      async (opts: { count: number }) =>
        Array.from({ length: opts.count }, (_, n) => ({
          prompt: `Fresh replacement number ${n} about this topic`,
          options: ["Alpha", "Bravo", "Charlie", "Delta"],
          correctIndex: 0,
          difficulty: 3,
          factBlurb: "A fresh fact.",
          photoQuery: `fresh scene ${n}`,
        })),
    );

    await pressContinue(categoryId);

    const logged = consoleError.mock.calls.map((call) => String(call[1] ?? call[0]));
    expect(logged.join("\n")).not.toContain("question_generation_jobs_check1");
    const job = await readJob(categoryId);
    expect(job.phase).toBe("ready");
    expect(job.certified_count).toBe(20);
    // The re-check's own failure count reaches the host with its round end.
    expect(
      progressPayloads().some(
        (p) => p.phase === "repairing" && p.clean === 14 && p.failedLastRound === 6,
      ),
    ).toBe(true);
    expect(job.image_count).toBeLessThanOrEqual(job.certified_count);
    // Only the shortfall is written, not a whole new set.
    expect(h.state.generateQuestions).toHaveBeenCalledTimes(1);
    expect(h.state.generateQuestions.mock.calls[0]![0].count).toBe(7);
    const remaining = await one<{ n: string }>(
      "select count(*) as n from questions where category_id = $1",
      [categoryId],
    );
    expect(Number(remaining.n)).toBe(20);
  });

  const progressPayloads = () =>
    h.state.broadcast.mock.calls
      .filter((call: unknown[]) => call[1] === "progress")
      .map(
        (call: unknown[]) =>
          call[2] as {
            phase: string;
            clean?: number;
            failedLastRound?: number;
          },
      );

  test("a 3-round build tells the host exactly how many failed each round", async () => {
    // Round 1 writes 20 and 3 fail (17 clean). Round 2 writes 4 for the 3
    // gaps and 2 of them fail (19 clean). Round 3 writes 2 and both pass.
    // The host used to see "1 failed" after round 2 (20 - 19); the server
    // now says the real number.
    const category = await one<{ id: string }>(
      `insert into categories (game_id, name, topic, position, state)
       values ($1, 'Three Rounds', 'Three Rounds', $2, 'draft')
       returning id`,
      [gameId, position++],
    );
    h.state.owned = {
      ok: true,
      host: {
        id: hostId,
        role: "host",
        is_paywall_bypassed: true,
        trial_ends_at: null,
        subscription_status: null,
      },
      night: { id: nightId, theme_key: "house" },
      category: {
        id: category.id,
        game_id: gameId,
        name: "Three Rounds",
        topic: "Three Rounds",
        state: "draft",
      },
    };
    const failing = [3, 2, 0];
    let round = 0;
    h.state.generateQuestions.mockImplementation(async (opts: { count: number }) => {
      const r = round++;
      return Array.from({ length: opts.count }, (_, n) => ({
        prompt:
          n < (failing[r] ?? 0)
            ? `Round ${r + 1} question ${n} REJECTME`
            : `Round ${r + 1} question ${n} about this topic`,
        options: ["Alpha", "Bravo", "Charlie", "Delta"],
        correctIndex: 0,
        difficulty: 3,
        factBlurb: "A fresh fact.",
        photoQuery: `round ${r + 1} scene ${n}`,
      }));
    });

    await pressContinue(category.id);

    expect(h.state.generateQuestions.mock.calls.map((c: unknown[]) => (c[0] as { count: number }).count)).toEqual([20, 4, 2]);
    const job = await readJob(category.id);
    expect(job.phase).toBe("ready");
    expect(job.certified_count).toBe(20);

    const payloads = progressPayloads();
    const firstWithField = payloads.findIndex((p) => p.failedLastRound !== undefined);
    expect(firstWithField).toBeGreaterThan(0);
    // Nothing claims a failure count before round 1 has ended.
    expect(payloads.slice(0, firstWithField).every((p) => (p.clean ?? 0) === 0)).toBe(true);
    // Each count goes with its own round: 3 at 17 clean, 2 at 19 clean.
    for (const p of payloads) {
      if (p.failedLastRound === undefined) continue;
      if (p.clean === 17) expect(p.failedLastRound).toBe(3);
      if (p.clean === 19) expect(p.failedLastRound).toBe(2);
    }
    // Every round end is announced as "repairing" (not overtaken by the
    // next round's "writing"), and then the replacement writing starts with
    // the same number on it.
    const idx = (phase: string, clean: number, failed: number) =>
      payloads.findIndex(
        (p) => p.phase === phase && p.clean === clean && p.failedLastRound === failed,
      );
    expect(idx("repairing", 17, 3)).toBeGreaterThan(-1);
    expect(idx("writing", 17, 3)).toBeGreaterThan(idx("repairing", 17, 3));
    expect(idx("repairing", 19, 2)).toBeGreaterThan(idx("writing", 17, 3));
    expect(idx("writing", 19, 2)).toBeGreaterThan(idx("repairing", 19, 2));
    // The false "1 failed" never goes out.
    expect(payloads.some((p) => p.failedLastRound === 1)).toBe(false);
  });

  async function draftCategory(name: string) {
    const category = await one<{ id: string }>(
      `insert into categories (game_id, name, topic, position, state)
       values ($1, $2, $2, $3, 'draft')
       returning id`,
      [gameId, name, position++],
    );
    h.state.owned = {
      ok: true,
      host: {
        id: hostId,
        role: "host",
        is_paywall_bypassed: true,
        trial_ends_at: null,
        subscription_status: null,
      },
      night: { id: nightId, theme_key: "house" },
      category: {
        id: category.id,
        game_id: gameId,
        name,
        topic: name,
        state: "draft",
      },
    };
    return category.id;
  }

  const roundQuestions = (failing: number[]) => {
    let round = 0;
    return async (opts: { count: number }) => {
      const r = round++;
      return Array.from({ length: opts.count }, (_, n) => ({
        prompt:
          n < (failing[r] ?? 0)
            ? `Round ${r + 1} question ${n} REJECTME`
            : `Round ${r + 1} question ${n} about this topic`,
        options: ["Alpha", "Bravo", "Charlie", "Delta"],
        correctIndex: 0,
        difficulty: 3,
        factBlurb: "A fresh fact.",
        photoQuery: `round ${r + 1} scene ${n}`,
      }));
    };
  };

  // The "images" update the route sends itself, and the first photo lookup.
  const imagesSentBeforePhotos = () => {
    const calls = h.state.broadcast.mock.calls as unknown[][];
    const order = h.state.broadcast.mock.invocationCallOrder;
    const firstImages = calls.findIndex(
      (call) => call[1] === "progress" && (call[2] as { phase: string }).phase === "images",
    );
    if (firstImages < 0) return false;
    const firstPhoto = h.state.autoAttachPhoto.mock.invocationCallOrder[0];
    return firstPhoto === undefined || order[firstImages]! < firstPhoto;
  };

  test("a build that runs out of rounds short of 20 stops saying it is writing more", async () => {
    // 4 rounds (the limit), each leaving gaps: 15, 18, 18, 18 clean.
    // Refill rounds ask for one spare on top of the gap.
    const categoryId = await draftCategory("Out Of Rounds");
    h.state.generateQuestions.mockImplementation(roundQuestions([5, 3, 3, 3]));

    await pressContinue(categoryId);

    expect(
      h.state.generateQuestions.mock.calls.map((c: unknown[]) => (c[0] as { count: number }).count),
    ).toEqual([20, 6, 3, 3]);
    const job = await readJob(categoryId);
    expect(job.certified_count).toBe(18);
    const payloads = progressPayloads();
    const lastRepairing = payloads.map((p) => p.phase).lastIndexOf("repairing");
    const firstImages = payloads.findIndex((p) => p.phase === "images");
    expect(lastRepairing).toBeGreaterThan(-1);
    expect(firstImages).toBeGreaterThan(lastRepairing);
    // The photo step is announced before any photo is looked up, not left
    // to the poll, and nothing after it goes back to writing or repairing.
    expect(imagesSentBeforePhotos()).toBe(true);
    expect(
      payloads.slice(firstImages).every((p) => p.phase === "images"),
    ).toBe(true);
  });

  test("a 20/20 first build announces the photo step right away", async () => {
    const categoryId = await draftCategory("Clean First Time");
    h.state.generateQuestions.mockImplementation(roundQuestions([0]));

    await pressContinue(categoryId);

    expect(h.state.generateQuestions).toHaveBeenCalledTimes(1);
    expect((await readJob(categoryId)).phase).toBe("ready");
    expect(imagesSentBeforePhotos()).toBe(true);
  });

  test("the failure number stays on through both check passes of a refill", async () => {
    // Round 1: 3 fail (17 clean). Round 2 writes 4 and all pass. The second
    // check pass of round 2 finishes after the first, and its update must
    // still carry round 1's number (it used to be cleared mid-check).
    const categoryId = await draftCategory("Steady Headline");
    h.state.generateQuestions.mockImplementation(roundQuestions([3, 0]));
    h.state.verifyAnswers.mockImplementation(
      async (
        questions: Array<{ prompt: string }>,
        opts: {
          mode?: string;
          onChunkChecked?: (checked: number, total: number) => void;
        },
      ) => {
        if (opts.mode === "adversarial") {
          for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
        }
        opts.onChunkChecked?.(questions.length, questions.length);
        return questions.map((question, index) => ({
          index,
          markedAnswerIsCorrect: !question.prompt.includes("REJECTME"),
          ambiguous: false,
          factBlurbIsCorrect: opts.mode === "adversarial" ? true : null,
          answerableWithoutImage: true,
          fitsRequestedTopic: true,
        }));
      },
    );

    await pressContinue(categoryId);

    expect((await readJob(categoryId)).certified_count).toBe(20);
    const payloads = progressPayloads() as Array<{
      phase: string;
      clean?: number;
      failedLastRound?: number;
      checked?: number;
    }>;
    const round2Writing = payloads.findIndex(
      (p) => p.phase === "writing" && p.clean === 17 && p.failedLastRound === 3,
    );
    expect(round2Writing).toBeGreaterThan(-1);
    const round2Checks = payloads
      .slice(round2Writing)
      .filter((p) => p.phase === "checking");
    // Seeds plus one chunk per pass, all with the number on.
    expect(round2Checks.length).toBeGreaterThanOrEqual(3);
    expect(round2Checks.every((p) => p.failedLastRound === 3)).toBe(true);
    // Once round 2 saves, the old number is gone.
    const afterSave = payloads.slice(round2Writing).filter((p) => p.clean === 20);
    expect(afterSave.length).toBeGreaterThan(0);
    expect(afterSave.every((p) => p.failedLastRound !== 3)).toBe(true);
  });

  test("a build already killed with no photos or counters still restarts", async () => {
    const { categoryId } = await seedStuckBuild({
      withPhoto: 0,
      certifiedCount: 0,
      imageCount: 0,
    });
    await pressContinue(categoryId);
    const job = await readJob(categoryId);
    expect(job.phase).toBe("ready");
    expect(job.certified_count).toBe(20);
    expect(h.state.autoAttachPhoto).toHaveBeenCalledTimes(20);
  });

  test("a run that is running out of time stops adding photos and still finishes", async () => {
    // Vercel ends the function at 300 seconds. Photos are optional, so the
    // build stops adding them near the end and saves what it has instead of
    // being killed and left unfinished.
    const { categoryId } = await seedStuckBuild({
      withPhoto: 0,
      certifiedCount: 20,
      imageCount: 0,
    });
    h.state.autoAttachPhoto.mockImplementation(async () => {
      clockSkewMs += 100_000; // each photo "takes" 100 seconds
      return {
        imageUrl: `https://images.pexels.com/slow-${clockSkewMs}.jpg`,
        attribution: "Pexels test",
        alternatives: [],
        source: "primary",
      };
    });

    await pressContinue(categoryId);

    const job = await readJob(categoryId);
    expect(job.phase).toBe("ready");
    expect(await readCategoryState(categoryId)).toBe("review");
    // 0s, 100s, 200s start under the limit; the 4th would start at 300s.
    expect(h.state.autoAttachPhoto).toHaveBeenCalledTimes(3);
    expect(job.image_count).toBe(3);
    expect(job.certified_count).toBe(20);
  });

  test("a build that starts after a typo fix writes about the NEW topic, not a stale copy", async () => {
    // The request read the row before the topic screen swapped "Ghost Storys"
    // for "Ghost Stories" in place, and only then started the build. The worker
    // must use the topic the row holds once this attempt owns the job.
    const category = await one<{ id: string }>(
      `insert into categories (game_id, name, topic, position, state)
       values ($1, 'Ghost Stories', 'Ghost Stories', $2, 'draft')
       returning id`,
      [gameId, position++],
    );
    h.state.owned = {
      ok: true,
      host: {
        id: hostId,
        role: "host",
        is_paywall_bypassed: true,
        trial_ends_at: null,
        subscription_status: null,
      },
      night: { id: nightId, theme_key: "house" },
      category: {
        id: category.id,
        game_id: gameId,
        name: "Ghost Storys",
        topic: "Ghost Storys",
        state: "draft",
      },
    };
    h.state.generateQuestions.mockRejectedValue(new Error("stop after the first call"));
    const res = await pressContinue(category.id);
    expect(res.status).toBe(202);
    expect(h.state.generateQuestions).toHaveBeenCalled();
    const topics = h.state.generateQuestions.mock.calls.map(
      (call: unknown[]) => (call[0] as { topic: string }).topic,
    );
    expect(new Set(topics)).toEqual(new Set(["Ghost Stories"]));
  });
});
