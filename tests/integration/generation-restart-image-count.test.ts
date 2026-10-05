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
});
