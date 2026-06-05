# Answer Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No factually-wrong or ambiguous AI question can reach a live game — by writing on Sonnet and running an independent Opus fact-check that regenerates anything it can't verify, all before the host ever sees the batch.

**Architecture:** Two coupled backend changes in the generation pipeline. (1) Default writer model Haiku → Sonnet. (2) A new Opus verifier + a bounded generate→verify→regenerate loop wired into the existing background `runGenerationJob`, *between* generation and the DB insert — so only verified questions are ever inserted/broadcast, and the category flips to host-visible (`review`) only after. Spec: `docs/superpowers/specs/2026-06-05-answer-correctness-design.md`.

**Tech Stack:** Next 16 (App Router, `after()`), Anthropic SDK (`@anthropic-ai/sdk`), Supabase admin client, Zod, vitest. Models: `claude-sonnet-4-6` (writer), `claude-opus-4-8` (verifier — **rejects the `temperature` param**, omit it).

**Scope note (vs spec):** The "honest edit screen" piece is dropped — `components/host/gen/HostGenEdit.tsx` already marks the correct answer with a "✓ CORRECT" pill. The "structural anti-drift" piece is deferred — the verifier already catches a drifted answer (it reads as "marked answer wrong" → regenerated). This plan is the full remaining build.

---

### Task 1: Switch the writer model to Sonnet

**Files:**
- Modify: `lib/ai/generate-questions.ts:191`
- Modify: `lib/ai/generate-questions.ts:26-34` (stale Haiku comment)
- Test: `tests/unit/generate-questions.test.ts`

- [ ] **Step 1: Write the failing test** — append inside the `describe("generateQuestions", …)` block in `tests/unit/generate-questions.test.ts`:

```ts
  it("defaults to Sonnet 4.6 as the writer model", () => {
    expect(DEFAULT_MODEL).toBe("claude-sonnet-4-6");
  });
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/unit/generate-questions.test.ts -t "defaults to Sonnet"`
Expected: FAIL — received `"claude-haiku-4-5-20251001"`.

- [ ] **Step 3: Make the change** — in `lib/ai/generate-questions.ts:191`:

```ts
export const DEFAULT_MODEL = "claude-sonnet-4-6";
```

Replace the now-stale "Why Haiku over Sonnet" comment block (lines 26-34) with:

```ts
// Model: claude-sonnet-4-6. A 2026-06-05 benchmark (scripts/benchmark-answer-correctness.mjs)
// showed Haiku 4.5 wrote 6.4% factually-wrong + 19/78 ambiguous questions (and reproduced a
// live mis-key), vs Sonnet 2.5% (arguable edge-cases) / 10. Haiku is removed for generation.
// An independent Opus fact-check (lib/ai/verify-answers.ts) gates the output regardless.
```

- [ ] **Step 4: Run the full file, verify green** (the existing tests reference `DEFAULT_MODEL`, so they still pass)

Run: `npx vitest run tests/unit/generate-questions.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/generate-questions.ts tests/unit/generate-questions.test.ts
git commit -m "feat(ai): write questions on Sonnet 4.6, not Haiku"
```

---

### Task 2: The independent answer verifier (`verifyAnswers`)

**Files:**
- Create: `lib/ai/verify-answers.ts`
- Test: `tests/unit/verify-answers.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/unit/verify-answers.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { verifyAnswers, VERIFIER_MODEL } from "@/lib/ai/verify-answers";
import type { GeneratedQuestion } from "@/lib/ai/generate-questions";

function q(over: Partial<GeneratedQuestion> = {}): GeneratedQuestion {
  return {
    prompt: "Demi Moore was married to which actor?",
    options: ["Bruce Willis", "Van Damme", "Seagal", "Arnold"],
    correctIndex: 0,
    difficulty: 4,
    factBlurb: "They married in 1987.",
    photoQuery: "1980s hollywood couple",
    ...over,
  };
}

interface Call { params: Record<string, unknown>; options?: Record<string, unknown> }

function mockClient(verdicts: unknown, capture: Call[]) {
  return {
    messages: {
      create: vi.fn(async (params: Record<string, unknown>, options?: Record<string, unknown>) => {
        capture.push({ params, options });
        return {
          content: [{ type: "tool_use", name: "verdicts", id: "t", input: { verdicts } }],
        };
      }),
    },
  };
}

describe("verifyAnswers", () => {
  it("returns the verdict array and forces the verdicts tool", async () => {
    const capture: Call[] = [];
    const client = mockClient(
      [{ index: 0, markedAnswerIsCorrect: true, ambiguous: false, trueAnswer: "Bruce Willis" }],
      capture,
    );
    // @ts-expect-error — narrowing to Pick<Anthropic,"messages"> in tests
    const out = await verifyAnswers([q()], { client });
    expect(out).toHaveLength(1);
    expect(out[0]?.markedAnswerIsCorrect).toBe(true);
    expect(capture[0]!.params.tool_choice).toEqual({ type: "tool", name: "verdicts" });
  });

  it("sends the MARKED answer (options[correctIndex]) for each question", async () => {
    const capture: Call[] = [];
    const client = mockClient([], capture);
    // @ts-expect-error — narrowing
    await verifyAnswers([q({ correctIndex: 3 })], { client });
    const content = (capture[0]!.params.messages as Array<{ content: string }>)[0]!.content;
    expect(content).toContain('"markedAnswer": "Arnold"');
  });

  it("omits temperature for Opus 4.8 (the param is deprecated there)", async () => {
    const capture: Call[] = [];
    const client = mockClient([], capture);
    // @ts-expect-error — narrowing
    await verifyAnswers([q()], { client, model: VERIFIER_MODEL });
    expect(capture[0]!.params).not.toHaveProperty("temperature");
  });

  it("returns [] for an empty batch without calling the API", async () => {
    const capture: Call[] = [];
    const client = mockClient([], capture);
    // @ts-expect-error — narrowing
    const out = await verifyAnswers([], { client });
    expect(out).toEqual([]);
    expect(capture).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/unit/verify-answers.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/verify-answers`.

- [ ] **Step 3: Write the implementation** — `lib/ai/verify-answers.ts`:

```ts
// Independent answer fact-checker. Given generated questions, a strong model
// (Opus) re-derives each answer COLD — without trusting the marked one — and
// reports whether the marked answer is correct and whether the question is
// ambiguous. Used to gate generation so no wrong/ambiguous question ships.
//
// Opus 4.8 REJECTS the `temperature` param ("deprecated for this model"), so
// we omit it for that model.

import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { GeneratedQuestion } from "./generate-questions";

export const VERIFIER_MODEL = "claude-opus-4-8";

export interface AnswerVerdict {
  index: number;
  markedAnswerIsCorrect: boolean;
  ambiguous: boolean;
  trueAnswer: string;
}

export interface VerifyAnswersOptions {
  client?: Pick<Anthropic, "messages">;
  model?: string;
}

const VERDICTS_TOOL_NAME = "verdicts";

const verdictsTool = {
  name: VERDICTS_TOOL_NAME,
  description: "Independent fact-check verdicts, one per question.",
  input_schema: {
    type: "object" as const,
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            markedAnswerIsCorrect: { type: "boolean" },
            ambiguous: { type: "boolean" },
            trueAnswer: { type: "string" },
          },
          required: ["index", "markedAnswerIsCorrect", "ambiguous", "trueAnswer"],
          additionalProperties: false,
        },
      },
    },
    required: ["verdicts"],
    additionalProperties: false,
  },
};

const VERIFIER_SYSTEM =
  "You are a meticulous, independent trivia fact-checker. For each question, " +
  "work out the correct answer from your OWN knowledge. Do NOT assume the " +
  "markedAnswer is right. Set markedAnswerIsCorrect=true only if the marked " +
  "answer is unambiguously the single correct option. Set ambiguous=true if " +
  "two or more options are defensibly correct, or the question has no single " +
  "defensible answer.";

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function isVerdicts(value: unknown): value is { verdicts: AnswerVerdict[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "verdicts" in value &&
    Array.isArray((value as { verdicts: unknown }).verdicts)
  );
}

export async function verifyAnswers(
  questions: GeneratedQuestion[],
  opts: VerifyAnswersOptions = {},
): Promise<AnswerVerdict[]> {
  if (questions.length === 0) return [];

  const client =
    opts.client ?? new Anthropic({ apiKey: getEnv("ANTHROPIC_API_KEY") });
  const model = opts.model ?? VERIFIER_MODEL;

  const payload = questions.map((q, i) => ({
    index: i,
    prompt: q.prompt,
    options: q.options,
    markedAnswer: q.options[q.correctIndex],
  }));

  const response = await client.messages.create(
    {
      model,
      max_tokens: 4_000,
      // Opus 4.8 rejects `temperature`; other models keep deterministic 0.
      ...(model.includes("opus-4-8") ? {} : { temperature: 0 }),
      system: VERIFIER_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Fact-check these ${payload.length} questions:\n${JSON.stringify(
            payload,
            null,
            1,
          )}`,
        },
      ],
      tools: [verdictsTool],
      tool_choice: { type: "tool", name: VERDICTS_TOOL_NAME },
    },
    { timeout: 60_000 },
  );

  const block = response.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> =>
      b.type === "tool_use" && b.name === VERDICTS_TOOL_NAME,
  );
  if (!block || !isVerdicts(block.input)) {
    throw new Error("verifyAnswers: no verdicts returned");
  }
  return block.input.verdicts;
}
```

- [ ] **Step 4: Run it, verify green**

Run: `npx vitest run tests/unit/verify-answers.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/verify-answers.ts tests/unit/verify-answers.test.ts
git commit -m "feat(ai): independent Opus answer verifier (verifyAnswers)"
```

---

### Task 3: The generate→verify→regenerate loop (`collectVerifiedQuestions`)

**Files:**
- Create: `lib/ai/collect-verified-questions.ts`
- Test: `tests/unit/collect-verified-questions.test.ts`

This is pure orchestration with **injected** `generate`/`verify` functions so it tests with no network. Keeps only questions the verifier marks correct AND not ambiguous; regenerates (avoiding already-seen prompts) until `target` is reached or `maxRounds` is exhausted; returns however many passed (emit-fewer, never wrong).

- [ ] **Step 1: Write the failing test** — `tests/unit/collect-verified-questions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { collectVerifiedQuestions } from "@/lib/ai/collect-verified-questions";
import type { GeneratedQuestion } from "@/lib/ai/generate-questions";
import type { AnswerVerdict } from "@/lib/ai/verify-answers";

function q(prompt: string): GeneratedQuestion {
  return { prompt, options: ["a", "b", "c", "d"], correctIndex: 0, difficulty: 4, factBlurb: "blurb here", photoQuery: "q" };
}
const ok = (i: number): AnswerVerdict => ({ index: i, markedAnswerIsCorrect: true, ambiguous: false, trueAnswer: "a" });
const wrong = (i: number): AnswerVerdict => ({ index: i, markedAnswerIsCorrect: false, ambiguous: false, trueAnswer: "b" });
const ambig = (i: number): AnswerVerdict => ({ index: i, markedAnswerIsCorrect: true, ambiguous: true, trueAnswer: "a" });

it("keeps only correct, non-ambiguous questions", async () => {
  const batch = [q("k1"), q("wrong"), q("amb"), q("k2")];
  const out = await collectVerifiedQuestions({
    target: 10,
    maxRounds: 1,
    generate: async () => batch,
    verify: async () => [ok(0), wrong(1), ambig(2), ok(3)],
  });
  expect(out.map((x) => x.prompt)).toEqual(["k1", "k2"]);
});

it("regenerates avoiding seen prompts until target is reached", async () => {
  const seenByRound: string[][] = [];
  const out = await collectVerifiedQuestions({
    target: 2,
    maxRounds: 3,
    generate: async (avoid) => {
      seenByRound.push(avoid);
      const n = seenByRound.length;
      return [q(`r${n}-good`), q(`r${n}-bad`)];
    },
    verify: async () => [ok(0), wrong(1)],
  });
  expect(out.map((x) => x.prompt)).toEqual(["r1-good", "r2-good"]);
  expect(seenByRound[0]).toEqual([]);                       // round 1 avoids nothing
  expect(seenByRound[1]).toContain("r1-good");              // round 2 avoids round 1's prompts
  expect(seenByRound[1]).toContain("r1-bad");
});

it("emits fewer (never throws) when rounds are exhausted", async () => {
  const out = await collectVerifiedQuestions({
    target: 20,
    maxRounds: 2,
    generate: async () => [q("only-good"), q("only-bad")],
    verify: async () => [ok(0), wrong(1)],
  });
  expect(out).toHaveLength(2);                              // 1 good per round × 2 rounds
});

it("stops early when generation dries up", async () => {
  let calls = 0;
  const out = await collectVerifiedQuestions({
    target: 20,
    maxRounds: 5,
    generate: async () => { calls++; return calls === 1 ? [q("g")] : []; },
    verify: async () => [ok(0)],
  });
  expect(out).toHaveLength(1);
  expect(calls).toBe(2);                                    // round 2 returns empty → stop
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/unit/collect-verified-questions.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/collect-verified-questions`.

- [ ] **Step 3: Write the implementation** — `lib/ai/collect-verified-questions.ts`:

```ts
// Generate → verify → regenerate loop. Returns only questions an independent
// verifier marked correct AND non-ambiguous. Regenerates (avoiding prompts
// already shown to the verifier) until `target` clean questions exist or
// `maxRounds` is hit. Returns however many passed — fewer, never wrong.
//
// Pure orchestration: `generate` and `verify` are injected so this is unit-
// tested without the network. The route supplies the real implementations.

import type { GeneratedQuestion } from "./generate-questions";
import type { AnswerVerdict } from "./verify-answers";

export interface CollectVerifiedOptions {
  target: number;
  maxRounds: number;
  generate: (avoidPrompts: string[]) => Promise<GeneratedQuestion[]>;
  verify: (questions: GeneratedQuestion[]) => Promise<AnswerVerdict[]>;
}

export async function collectVerifiedQuestions(
  opts: CollectVerifiedOptions,
): Promise<GeneratedQuestion[]> {
  const clean: GeneratedQuestion[] = [];
  const seenPrompts: string[] = [];

  for (let round = 0; round < opts.maxRounds && clean.length < opts.target; round++) {
    const batch = await opts.generate([...seenPrompts]);
    if (batch.length === 0) break;
    for (const q of batch) seenPrompts.push(q.prompt);

    const verdicts = await opts.verify(batch);
    const byIndex = new Map(verdicts.map((v) => [v.index, v]));
    batch.forEach((q, i) => {
      const v = byIndex.get(i);
      if (v && v.markedAnswerIsCorrect && !v.ambiguous) clean.push(q);
    });
  }

  return clean.slice(0, opts.target);
}
```

- [ ] **Step 4: Run it, verify green**

Run: `npx vitest run tests/unit/collect-verified-questions.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/collect-verified-questions.ts tests/unit/collect-verified-questions.test.ts
git commit -m "feat(ai): bounded generate-verify-regenerate loop"
```

---

### Task 4: Wire the loop into the generation job + raise the time budget

**Files:**
- Modify: `app/api/categories/[id]/generate/route.ts:42` (maxDuration)
- Modify: `app/api/categories/[id]/generate/route.ts:20-32` (imports)
- Modify: `app/api/categories/[id]/generate/route.ts:186-197` (generation step)

- [ ] **Step 1: Raise `maxDuration`** — line 42:

```ts
// Generation now also runs an Opus verification pass (and may regenerate a
// round), so the background job needs more headroom than the old Haiku-only
// path. 300s is Vercel's hard max on most plans.
export const maxDuration = 300;
```

- [ ] **Step 2: Add imports** — alongside the existing `@/lib/ai/*` imports near line 30-32:

```ts
import { generateQuestions } from "@/lib/ai/generate-questions";
import { verifyAnswers } from "@/lib/ai/verify-answers";
import { collectVerifiedQuestions } from "@/lib/ai/collect-verified-questions";
```

(The first line already exists — keep one copy; add the two new ones.)

- [ ] **Step 3: Replace the generation step** — swap the current block at lines 186-197 (the `// Step 1: ask Claude` comment through the `if (generated.length === 0) { throw … }`) for:

```ts
  // Step 1: generate, then independently fact-check every answer on Opus.
  // Only questions the verifier marks correct AND non-ambiguous survive;
  // the rest are regenerated (avoiding repeats), bounded to a few rounds.
  // Nothing is inserted or broadcast until it has passed — the category is
  // still 'generating', so the host never sees an unverified question.
  const generated = await collectVerifiedQuestions({
    target: 20,
    maxRounds: 3,
    generate: (avoid) =>
      generateQuestions({
        topic: opts.topic,
        flavor: opts.flavor,
        difficulty: opts.difficulty,
        count: 20,
        themeKey: opts.themeKey,
        avoidPrompts: [...(reroll?.avoidPrompts ?? []), ...avoid],
      }),
    verify: (qs) => verifyAnswers(qs),
  });
  if (generated.length === 0) {
    throw new Error("no questions passed the answer check");
  }
```

- [ ] **Step 4: Type-check + full unit suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS (existing + the 3 new test files green).

- [ ] **Step 5: Lint**

Run: `npx eslint app/api/categories/\[id\]/generate/route.ts lib/ai/verify-answers.ts lib/ai/collect-verified-questions.ts`
Expected: 0 problems.

- [ ] **Step 6: Commit**

```bash
git add "app/api/categories/[id]/generate/route.ts"
git commit -m "feat(gen): gate generation on the Opus answer check, never show unverified"
```

---

### Task 5: Prove it end-to-end (real models)

**Files:** none (verification only)

- [ ] **Step 1: Re-run the correctness benchmark** (confirms Sonnet writer + Opus judge behave as designed)

Run: `node --env-file=.env.local --import tsx scripts/benchmark-answer-correctness.mjs`
Expected: Sonnet wrong-rate ≈ the 2.5% measured earlier; Opus judge runs clean (no 400s).

- [ ] **Step 2: Drive a real category through the live pipeline** against a `@tr1via.test` host (per the test-isolation rule), then re-verify every emitted question:

Run: `node scripts/full-flow-prod.mjs`
Expected: GREEN — generation completes (now slower, within the 300s budget), category reaches `review`, questions exist.

- [ ] **Step 3: Spot-check** the generated category in Supabase (read-only): confirm every emitted question's marked answer matches what an independent Opus check would say. (One `SELECT` of the new category's questions + eyeball, or extend the benchmark's judge over those rows.)

- [ ] **Step 4: Open the PR** (never merge — Brandon validates + merges):

```bash
gh pr create --base main \
  --title "Answer correctness: write on Sonnet, gate on an Opus fact-check" \
  --body "Stops wrong/ambiguous AI answers from reaching a live game. Sonnet writes; an independent Opus pass verifies every answer and regenerates anything it can't confirm, before the host ever sees the batch. Spec: docs/superpowers/specs/2026-06-05-answer-correctness-design.md"
```

---

## Self-review

- **Spec coverage:** writer model → Task 1; independent verification → Task 2; never-surface-unverified loop → Tasks 3-4 (runs while `generating`, inserts only after passing); emit-fewer-not-wrong → Task 3; build-time-only → Tasks 3-4 (in the generation job, nothing at game time); proof → Task 5. Honest-edit-screen + anti-drift: intentionally out of scope (already satisfied / subsumed — see Scope note).
- **Type consistency:** `AnswerVerdict` (Task 2) is consumed by `collectVerifiedQuestions` (Task 3) and the route (Task 4); `GeneratedQuestion` is the existing export. `verifyAnswers(questions, {client?})` and `collectVerifiedQuestions({target,maxRounds,generate,verify})` signatures match every call site.
- **No placeholders:** all code blocks are complete; commands have expected output.
