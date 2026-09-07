import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { GeneratedQuestion, GenerateQuestionsOptions } from "@/lib/ai/generate-questions";
import type { AnswerVerdict } from "@/lib/ai/verify-answers";
import type { QuestionGenerationJobRow } from "@/lib/ai/generation-job";

const harness = vi.hoisted(() => ({
  after: [] as Array<() => Promise<void>>,
  rows: [] as Array<Record<string, unknown>>,
  state: "draft",
  sequence: 100,
  generate: vi.fn(),
  verify: vi.fn(),
  commit: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  job: {} as QuestionGenerationJobRow,
}));

vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: (callback: () => Promise<void>) => { harness.after.push(callback); },
}));
vi.mock("@/lib/api/auth", () => ({
  requireOwnedCategory: async () => ({
    ok: true,
    host: { id: "host", role: "founder", is_paywall_bypassed: true },
    night: { id: "night", theme_key: "house" },
    category: { id: "category", game_id: "game", state: harness.state, name: "Space", topic: "Space" },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== "questions") throw new Error(`Unexpected table ${table}`);
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters.push((row) => row[key] === value);
          return query;
        },
        in: (key: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[key]));
          return query;
        },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({
          data: harness.rows.filter((row) => filters.every((filter) => filter(row))), error: null,
        }).then(resolve),
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/api/broadcast", () => ({ broadcastToCategory: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/generate-questions", () => ({ generateQuestions: harness.generate }));
vi.mock("@/lib/ai/verify-answers", () => ({ verifyAnswers: harness.verify }));
vi.mock("@/lib/ai/auto-attach-photo", () => ({
  autoAttachPhoto: vi.fn(async () => ({ imageUrl: null, attribution: null })),
}));
vi.mock("@/lib/ai/generation-job", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/generation-job")>(),
  readGenerationJob: async () => harness.job,
  updateGenerationJobForAttempt: vi.fn(async () => true),
}));
vi.mock("@/lib/ai/generation-effects", () => ({
  beginQuestionGeneration: async () => harness.job,
  claimQuestionGenerationResume: async () => harness.job,
  commitGenerationQuestions: harness.commit,
  commitGenerationPhoto: vi.fn(async () => true),
  completeQuestionGeneration: harness.complete,
  failQuestionGeneration: harness.fail,
}));

import { POST } from "@/app/api/categories/[id]/generate/route";

function question(difficulty: GeneratedQuestion["difficulty"], label: string): GeneratedQuestion {
  return {
    prompt: `Which familiar space fact belongs to ${label}?`,
    options: ["Alpha", "Bravo", "Charlie", "Delta"],
    correctIndex: 0,
    difficulty,
    factBlurb: "A verified explanation for this fixture.",
    photoQuery: "night sky",
  };
}

function row(q: GeneratedQuestion, id = crypto.randomUUID()): Record<string, unknown> {
  return {
    id, category_id: "category", prompt: q.prompt, options: q.options,
    correct_index: q.correctIndex, difficulty: q.difficulty, fact_blurb: q.factBlurb,
    photo_query: q.photoQuery, image_url: null, point_value: null,
    source: "ai", is_picked: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.after = [];
  harness.rows = [];
  harness.state = "draft";
  harness.sequence = 100;
  harness.job = {
    id: "job", category_id: "category", game_id: "game", night_id: "night", host_id: "host",
    phase: "needs_attention", target_count: 20, written_count: 0, certified_count: 0,
    image_count: 0, attempt: 2, last_error: null,
    heartbeat_at: "2020-01-01T00:00:00Z", created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-01T00:00:00Z",
  };
  harness.generate.mockImplementation(async (opts: GenerateQuestionsOptions) => {
    const mix = opts.difficultyMix!;
    return [
      ...Array.from({ length: mix.approachable }, () => question(2, String(harness.sequence++))),
      ...Array.from({ length: mix.moderate }, () => question(4, String(harness.sequence++))),
      ...Array.from({ length: mix.stretch }, () => question(6, String(harness.sequence++))),
    ];
  });
  harness.verify.mockImplementation(async (questions: GeneratedQuestion[]): Promise<AnswerVerdict[]> =>
    questions.map((_, index) => ({
      index, markedAnswerIsCorrect: true, ambiguous: false, factBlurbIsCorrect: true,
      answerableWithoutImage: true, fitsRequestedTopic: true,
    })),
  );
  harness.commit.mockImplementation(async (_client, input: { questions: GeneratedQuestion[]; deleteIds?: string[] }) => {
    harness.rows = harness.rows.filter((item) => !input.deleteIds?.includes(item.id as string));
    return input.questions.map((q) => {
      const stored = row(q);
      harness.rows.push(stored);
      return { id: stored.id, q, imageUrl: null };
    });
  });
  harness.complete.mockResolvedValue(true);
  harness.fail.mockResolvedValue(true);
});

async function run(body: Record<string, unknown>) {
  const response = await POST(new NextRequest("http://localhost/api/categories/category/generate", {
    method: "POST", body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: "category" }) });
  expect(response.status).toBe(202);
  expect(harness.after).toHaveLength(1);
  await harness.after[0]!();
}

describe("generation route difficulty balance", () => {
  it("auto-builds the real seven assignments from a balanced pool", async () => {
    await run({ autoPick: true });
    expect(harness.fail).not.toHaveBeenCalled();
    const completed = harness.complete.mock.calls[0]![1];
    expect(completed.categoryState).toBe("ready");
    expect(completed.assignments).toHaveLength(7);
    expect(completed.assignments.map((pick: { id: string }) =>
      harness.rows.find((item) => item.id === pick.id)!.difficulty)).toEqual([2, 2, 2, 4, 4, 4, 6]);
    expect(completed.certifiedCount).toBe(20);
  });

  it("finishes a reroll atomically after validation, preserving the host's kept question", async () => {
    harness.state = "review";
    const kept = row(question(7, "kept"));
    const discarded = row(question(7, "old-choice"));
    harness.rows = [kept, discarded];
    await run({ keptIds: [kept.id] });
    expect(harness.fail).not.toHaveBeenCalled();
    expect(harness.commit).toHaveBeenCalledTimes(1);
    expect(harness.commit.mock.calls[0]![1].questions).toHaveLength(20);
    expect(harness.commit.mock.calls[0]![1].deleteIds).toEqual([discarded.id]);
    expect(harness.rows).toContain(kept);
    expect(harness.rows).not.toContain(discarded);
    expect(harness.complete.mock.calls[0]![1].categoryState).toBe("review");
  });

  it("resumes an old all-hard checkpoint by replacing surplus unpicked rows and filling missing bands", async () => {
    harness.state = "generating";
    harness.rows = Array.from({ length: 20 }, (_, i) => row(question(7, `old-${i}`)));
    harness.rows[0]!.point_value = 100;
    const picked = { ...row(question(7, "already-picked")), is_picked: true };
    harness.rows.push(picked);
    await run({ autoPick: true });
    expect(harness.fail).not.toHaveBeenCalled();
    expect(harness.generate.mock.calls[0]![0]).toMatchObject({
      count: 17, difficultyMix: { approachable: 8, moderate: 9, stretch: 0 },
    });
    expect(harness.commit.mock.calls[0]![1].deleteIds).toHaveLength(17);
    expect(harness.rows).toContain(picked);
    expect(harness.complete.mock.calls[0]![1].certifiedCount).toBe(20);
    const opening = harness.complete.mock.calls[0]![1].assignments.filter(
      (pick: { pointValue: number }) => pick.pointValue <= 300,
    );
    expect(opening.map((pick: { id: string }) => harness.rows.find((item) => item.id === pick.id)!.difficulty)).toEqual([2, 2, 2]);
  });

  it("keeps an unbalanced partial run resumable instead of marking it ready", async () => {
    harness.generate.mockImplementation(async () => Array.from({ length: 20 }, (_, i) => question(4, `hard-only-${i}`)));
    await run({ autoPick: true });
    expect(harness.generate).toHaveBeenCalledTimes(4);
    expect(harness.complete).not.toHaveBeenCalled();
    expect(harness.fail.mock.calls[0]![1]).toMatchObject({
      restoreState: null, error: expect.stringContaining("balanced set"),
    });
    expect(harness.rows).toHaveLength(9);
  });
});
