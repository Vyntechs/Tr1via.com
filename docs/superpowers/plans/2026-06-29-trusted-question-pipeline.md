# Trusted Question Pipeline v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a non-blocking quality/cost audit report for each new AI category generation and surface a compact host review summary without changing Heather's Classic gameplay.

**Architecture:** Add an append-only `question_generation_reports` table, pure report/risk helpers, optional tracing hooks around the existing generate -> verify -> refill loop, and best-effort report persistence inside the existing generation route. The host pick page server-loads the latest report on refresh, while the generation `done` broadcast carries the same compact audit summary for the live transition from loading to review.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Supabase Postgres/RLS/admin client, Anthropic usage accounting, Vitest, pglite integration tests.

## Global Constraints

- No destructive database migration.
- No table drops, column drops, renames, or backfills.
- No production data cleanup.
- No change to scoring, reveal, lock-in, timers, answer submission, or live-game flow.
- No change to which questions players see during a live game.
- No report write can block a successful generation.
- If the additive report table is unavailable or a report insert fails, generation continues and logs a warning.
- If implementation discovers a non-additive database change is required, stop and redesign or move to a staging branch.
- No production API calls.
- No production database migration during development.
- Do not hand-edit the generated section of `lib/supabase/types.ts`; use `npm run typegen` after adding the migration.
- Keep this packet separate from question bank, model routing, Room Magic, and GTM work.

---

## File Structure

- `lib/ai/question-risk-flags.ts` - pure deterministic risk scanner for accepted questions.
- `lib/ai/question-generation-report.ts` - pure report types, accumulator, DB insert mapper, and host summary mapper.
- `lib/ai/question-generation-report-store.ts` - server-only best-effort Supabase insert helper for reports.
- `supabase/migrations/0015_question_generation_reports.sql` - additive report table, indexes, RLS, and grants.
- `lib/ai/generate-questions.ts` - optional invalid-candidate callback; return behavior unchanged.
- `lib/ai/collect-verified-questions.ts` - optional per-round trace callback; return behavior unchanged.
- `app/api/categories/[id]/generate/route.ts` - creates the report accumulator, records cost/round/image details, persists best-effort, and includes audit summary in `done`.
- `lib/api/broadcast.ts` - adds typed audit summary shape for category `done` payload.
- `components/host/gen/HostGenAuditSummary.tsx` - compact host-facing review summary.
- `components/host/gen/HostGenPick.tsx` - accepts and renders optional audit summary.
- `app/host/setup/[nightId]/pick/[categoryId]/page.tsx` - server-loads latest report on hard refresh.
- `app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient.tsx` - stores initial audit summary and updates it from the `done` broadcast.
- Tests under `tests/unit`, `tests/component`, and `tests/integration`.

---

### Task 1: Pure Risk Flags and Report Accumulator

**Files:**
- Create: `lib/ai/question-risk-flags.ts`
- Create: `lib/ai/question-generation-report.ts`
- Test: `tests/unit/question-risk-flags.test.ts`
- Test: `tests/unit/question-generation-report.test.ts`

**Interfaces:**
- Produces: `riskFlagsForQuestion(question): QuestionRiskFlag[]`
- Produces: `createQuestionGenerationReportAccumulator(input): QuestionGenerationReportAccumulator`
- Produces: `hostAuditSummaryFromSnapshot(snapshot): HostQuestionAuditSummary`
- Produces: `questionGenerationReportInsertFromSnapshot(context, snapshot): QuestionGenerationReportInsert`
- Consumes later: `TokenUsage`, `costUsd`, `GeneratedQuestion`, and Supabase `Json`.

- [ ] **Step 1: Write the failing risk-flag tests**

Create `tests/unit/question-risk-flags.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { riskFlagsForQuestion } from "@/lib/ai/question-risk-flags";

const base = {
  prompt: "Which movie features a character named Buzz Lightyear?",
  options: ["Toy Story", "Shrek", "Cars", "Frozen"] as [string, string, string, string],
  factBlurb: "Toy Story introduced Buzz Lightyear in 1995.",
};

describe("riskFlagsForQuestion", () => {
  it("returns no flags for ordinary stable wording", () => {
    expect(riskFlagsForQuestion(base)).toEqual([]);
  });

  it("flags time-sensitive, ranking, and geography-sensitive wording", () => {
    const flags = riskFlagsForQuestion({
      ...base,
      prompt: "As of 2026, what is the largest country by area in the world?",
      factBlurb: "Russia is commonly listed as the largest country by area.",
    });

    expect(flags).toEqual([
      "time_sensitive",
      "ranking_or_superlative",
      "geography_sensitive",
    ]);
  });

  it("flags subjective and multiple-answer-risk wording", () => {
    const flags = riskFlagsForQuestion({
      ...base,
      prompt: "Which of these is often called the best movie except by critics?",
      options: ["Movie A", "Movie B", "Movie C", "Movie D"],
    });

    expect(flags).toContain("subjective_wording");
    expect(flags).toContain("multiple_answer_risk");
  });
});
```

- [ ] **Step 2: Run the risk-flag test and verify it fails**

Run: `npx vitest run tests/unit/question-risk-flags.test.ts`

Expected: FAIL with an import error for `@/lib/ai/question-risk-flags`.

- [ ] **Step 3: Implement the risk-flag helper**

Create `lib/ai/question-risk-flags.ts`:

```ts
import type { GeneratedQuestion } from "./generate-questions";

export type QuestionRiskFlag =
  | "time_sensitive"
  | "ranking_or_superlative"
  | "geography_sensitive"
  | "subjective_wording"
  | "multiple_answer_risk";

type RiskScanQuestion = Pick<
  GeneratedQuestion,
  "prompt" | "options" | "factBlurb"
>;

const RULES: Array<{ flag: QuestionRiskFlag; pattern: RegExp }> = [
  {
    flag: "time_sensitive",
    pattern: /\b(current|currently|today|newest|latest|as of|record|modern|recent|now)\b/i,
  },
  {
    flag: "ranking_or_superlative",
    pattern: /\b(first|largest|oldest|biggest|smallest|longest|shortest|most|least|best|only|record)\b/i,
  },
  {
    flag: "geography_sensitive",
    pattern: /\b(country|countries|capital|state|city|world|national|continent|territory|province|region)\b/i,
  },
  {
    flag: "subjective_wording",
    pattern: /\b(best|greatest|favorite|famous|popular|iconic|legendary|often called)\b/i,
  },
  {
    flag: "multiple_answer_risk",
    pattern: /\b(except|not|all of these|both|either|neither|which of these)\b/i,
  },
];

function scanText(question: RiskScanQuestion): string {
  return [question.prompt, ...question.options, question.factBlurb]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function riskFlagsForQuestion(
  question: RiskScanQuestion,
): QuestionRiskFlag[] {
  const text = scanText(question);
  return RULES.filter((rule) => rule.pattern.test(text)).map(
    (rule) => rule.flag,
  );
}
```

- [ ] **Step 4: Run the risk-flag test and verify it passes**

Run: `npx vitest run tests/unit/question-risk-flags.test.ts`

Expected: PASS.

- [ ] **Step 5: Write the failing report accumulator tests**

Create `tests/unit/question-generation-report.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createQuestionGenerationReportAccumulator,
  hostAuditSummaryFromSnapshot,
  questionGenerationReportInsertFromSnapshot,
} from "@/lib/ai/question-generation-report";
import type { GeneratedQuestion } from "@/lib/ai/generate-questions";

function q(prompt: string): GeneratedQuestion {
  return {
    prompt,
    options: ["A", "B", "C", "D"],
    correctIndex: 0,
    difficulty: 4,
    factBlurb: "A stable fact blurb.",
    photoQuery: "photo query",
  };
}

describe("question generation report accumulator", () => {
  it("aggregates usage, round results, image counts, and risk flags", () => {
    const acc = createQuestionGenerationReportAccumulator({
      requestedCount: 20,
      verifyPasses: 2,
    });

    acc.recordUsage("claude-sonnet-4-6", {
      input_tokens: 1_000,
      output_tokens: 500,
    });
    acc.recordRound({
      round: 1,
      requested: 20,
      generated: 3,
      accepted: 1,
      rejected: [
        { prompt: "wrong", reasons: ["verifier_wrong"] },
        { prompt: "ambiguous", reasons: ["verifier_ambiguous"] },
      ],
    });
    acc.recordAcceptedQuestions([
      q("As of 2026, what is the largest country by area in the world?"),
    ]);
    acc.recordImageTargets(2);
    acc.recordImageAttached();

    const snapshot = acc.snapshot("partial");

    expect(snapshot.acceptedCount).toBe(1);
    expect(snapshot.generatedCount).toBe(3);
    expect(snapshot.rejectedCount).toBe(2);
    expect(snapshot.rounds).toBe(1);
    expect(snapshot.llmCalls).toBe(1);
    expect(snapshot.tokensIn).toBe(1_000);
    expect(snapshot.tokensOut).toBe(500);
    expect(snapshot.imageTargetCount).toBe(2);
    expect(snapshot.imageAttachedCount).toBe(1);
    expect(snapshot.imageSkippedCount).toBe(1);
    expect(snapshot.riskFlagCount).toBe(3);
    expect(snapshot.report.reasonCounts).toEqual({
      verifier_wrong: 1,
      verifier_ambiguous: 1,
      max_rounds_exhausted: 1,
    });
  });

  it("maps a snapshot to host summary and database insert shape", () => {
    const acc = createQuestionGenerationReportAccumulator({
      requestedCount: 20,
      verifyPasses: 2,
    });
    acc.recordRound({
      round: 1,
      requested: 20,
      generated: 20,
      accepted: 20,
      rejected: [],
    });
    acc.recordAcceptedQuestions([q("Which state is Alaska?")]);
    acc.recordImageTargets(20);
    acc.recordImageAttached();
    const snapshot = acc.snapshot("completed");

    expect(hostAuditSummaryFromSnapshot(snapshot)).toMatchObject({
      acceptedCount: 20,
      generatedCount: 20,
      verifyPasses: 2,
      imageTargetCount: 20,
      imageAttachedCount: 1,
    });

    const insert = questionGenerationReportInsertFromSnapshot(
      {
        categoryId: "11111111-1111-1111-1111-111111111111",
        gameId: "22222222-2222-2222-2222-222222222222",
        nightId: "33333333-3333-3333-3333-333333333333",
        hostId: "44444444-4444-4444-4444-444444444444",
        categoryName: "Movies",
        topic: "Pixar Movies",
        mode: "initial",
      },
      snapshot,
    );

    expect(insert.status).toBe("completed");
    expect(insert.topic).toBe("Pixar Movies");
    expect(insert.report).toMatchObject({ reasonCounts: {} });
  });
});
```

- [ ] **Step 6: Run the report accumulator test and verify it fails**

Run: `npx vitest run tests/unit/question-generation-report.test.ts`

Expected: FAIL with an import error for `@/lib/ai/question-generation-report`.

- [ ] **Step 7: Implement the report accumulator**

Create `lib/ai/question-generation-report.ts`:

```ts
import type { GeneratedQuestion } from "./generate-questions";
import { riskFlagsForQuestion, type QuestionRiskFlag } from "./question-risk-flags";
import { costUsd, type TokenUsage } from "./usage-cost";
import type { Json } from "@/lib/supabase/types";

export type QuestionGenerationMode =
  | "initial"
  | "reroll"
  | "auto_build"
  | "unknown";

export type QuestionGenerationStatus = "completed" | "partial" | "failed";

export type QuestionRejectionReason =
  | "invalid_schema"
  | "verifier_wrong"
  | "verifier_ambiguous"
  | "missing_verdict"
  | "duplicate_prompt"
  | "generation_empty"
  | "max_rounds_exhausted";

export interface RejectedCandidateTrace {
  prompt: string;
  reasons: QuestionRejectionReason[];
}

export interface GenerationRoundTrace {
  round: number;
  requested: number;
  generated: number;
  accepted: number;
  rejected: RejectedCandidateTrace[];
}

export interface QuestionRiskTrace {
  prompt: string;
  flags: QuestionRiskFlag[];
}

export interface QuestionGenerationReportJson {
  reasonCounts: Partial<Record<QuestionRejectionReason, number>>;
  rounds: GenerationRoundTrace[];
  invalidCandidates: RejectedCandidateTrace[];
  riskFlags: QuestionRiskTrace[];
}

export interface QuestionGenerationReportSnapshot {
  status: QuestionGenerationStatus;
  requestedCount: number;
  acceptedCount: number;
  generatedCount: number;
  rejectedCount: number;
  rounds: number;
  verifyPasses: number;
  llmCalls: number;
  tokensIn: number;
  tokensOut: number;
  estimatedCostUsd: number;
  imageTargetCount: number;
  imageAttachedCount: number;
  imageSkippedCount: number;
  riskFlagCount: number;
  report: QuestionGenerationReportJson;
}

export interface HostQuestionAuditSummary {
  acceptedCount: number;
  generatedCount: number;
  verifyPasses: number;
  estimatedCostUsd: number;
  imageTargetCount: number;
  imageAttachedCount: number;
  riskFlagCount: number;
}

export interface QuestionGenerationReportContext {
  categoryId: string;
  gameId: string;
  nightId: string;
  hostId: string;
  categoryName: string;
  topic: string;
  mode: QuestionGenerationMode;
}

export interface QuestionGenerationReportInsert {
  category_id: string | null;
  game_id: string | null;
  night_id: string | null;
  host_id: string | null;
  category_name: string | null;
  topic: string;
  mode: QuestionGenerationMode;
  status: QuestionGenerationStatus;
  requested_count: number;
  accepted_count: number;
  generated_count: number;
  rejected_count: number;
  rounds: number;
  verify_passes: number;
  llm_calls: number;
  tokens_in: number;
  tokens_out: number;
  estimated_cost_usd: number;
  image_target_count: number;
  image_attached_count: number;
  image_skipped_count: number;
  risk_flag_count: number;
  report: Json;
}

export interface QuestionGenerationReportAccumulator {
  recordUsage(model: string, usage: TokenUsage): void;
  recordRound(round: GenerationRoundTrace): void;
  recordInvalidCandidate(prompt: string, issues: string[]): void;
  recordAcceptedQuestions(questions: GeneratedQuestion[]): void;
  recordImageTargets(count: number): void;
  recordImageAttached(): void;
  snapshot(status: QuestionGenerationStatus): QuestionGenerationReportSnapshot;
}

export function createQuestionGenerationReportAccumulator(input: {
  requestedCount: number;
  verifyPasses: number;
}): QuestionGenerationReportAccumulator {
  const rounds: GenerationRoundTrace[] = [];
  const invalidCandidates: RejectedCandidateTrace[] = [];
  const reasonCounts: Partial<Record<QuestionRejectionReason, number>> = {};
  const riskFlags: QuestionRiskTrace[] = [];
  let llmCalls = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let estimatedCostUsd = 0;
  let imageTargetCount = 0;
  let imageAttachedCount = 0;

  const countReason = (reason: QuestionRejectionReason) => {
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  };

  return {
    recordUsage(model, usage) {
      llmCalls += 1;
      tokensIn +=
        (usage.input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0);
      tokensOut += usage.output_tokens ?? 0;
      estimatedCostUsd += costUsd(model, usage);
    },
    recordRound(round) {
      rounds.push(round);
      for (const rejected of round.rejected) {
        for (const reason of rejected.reasons) countReason(reason);
      }
      if (round.generated === 0) countReason("generation_empty");
    },
    recordInvalidCandidate(prompt, _issues) {
      countReason("invalid_schema");
      invalidCandidates.push({ prompt, reasons: ["invalid_schema"] });
    },
    recordAcceptedQuestions(questions) {
      riskFlags.length = 0;
      for (const question of questions) {
        const flags = riskFlagsForQuestion(question);
        if (flags.length > 0) riskFlags.push({ prompt: question.prompt, flags });
      }
    },
    recordImageTargets(count) {
      imageTargetCount = count;
    },
    recordImageAttached() {
      imageAttachedCount += 1;
    },
    snapshot(status) {
      const generatedCount =
        rounds.reduce((sum, round) => sum + round.generated, 0) +
        invalidCandidates.length;
      const acceptedCount = rounds.reduce((sum, round) => sum + round.accepted, 0);
      const rejectedCount =
        rounds.reduce((sum, round) => sum + round.rejected.length, 0) +
        invalidCandidates.length;
      const imageSkippedCount = Math.max(0, imageTargetCount - imageAttachedCount);
      const snapshotReasonCounts = { ...reasonCounts };
      if (status === "partial" && acceptedCount < input.requestedCount) {
        snapshotReasonCounts.max_rounds_exhausted =
          (snapshotReasonCounts.max_rounds_exhausted ?? 0) + 1;
      }
      return {
        status,
        requestedCount: input.requestedCount,
        acceptedCount,
        generatedCount,
        rejectedCount,
        rounds: rounds.length,
        verifyPasses: input.verifyPasses,
        llmCalls,
        tokensIn,
        tokensOut,
        estimatedCostUsd,
        imageTargetCount,
        imageAttachedCount,
        imageSkippedCount,
        riskFlagCount: riskFlags.reduce((sum, item) => sum + item.flags.length, 0),
        report: {
          reasonCounts: snapshotReasonCounts,
          rounds,
          invalidCandidates,
          riskFlags,
        },
      };
    },
  };
}

export function hostAuditSummaryFromSnapshot(
  snapshot: QuestionGenerationReportSnapshot,
): HostQuestionAuditSummary {
  return {
    acceptedCount: snapshot.acceptedCount,
    generatedCount: snapshot.generatedCount,
    verifyPasses: snapshot.verifyPasses,
    estimatedCostUsd: snapshot.estimatedCostUsd,
    imageTargetCount: snapshot.imageTargetCount,
    imageAttachedCount: snapshot.imageAttachedCount,
    riskFlagCount: snapshot.riskFlagCount,
  };
}

export function questionGenerationReportInsertFromSnapshot(
  context: QuestionGenerationReportContext,
  snapshot: QuestionGenerationReportSnapshot,
): QuestionGenerationReportInsert {
  return {
    category_id: context.categoryId,
    game_id: context.gameId,
    night_id: context.nightId,
    host_id: context.hostId,
    category_name: context.categoryName,
    topic: context.topic,
    mode: context.mode,
    status: snapshot.status,
    requested_count: snapshot.requestedCount,
    accepted_count: snapshot.acceptedCount,
    generated_count: snapshot.generatedCount,
    rejected_count: snapshot.rejectedCount,
    rounds: snapshot.rounds,
    verify_passes: snapshot.verifyPasses,
    llm_calls: snapshot.llmCalls,
    tokens_in: snapshot.tokensIn,
    tokens_out: snapshot.tokensOut,
    estimated_cost_usd: Number(snapshot.estimatedCostUsd.toFixed(4)),
    image_target_count: snapshot.imageTargetCount,
    image_attached_count: snapshot.imageAttachedCount,
    image_skipped_count: snapshot.imageSkippedCount,
    risk_flag_count: snapshot.riskFlagCount,
    report: snapshot.report as unknown as Json,
  };
}
```

- [ ] **Step 8: Run the Task 1 tests**

Run:

```bash
npx vitest run tests/unit/question-risk-flags.test.ts tests/unit/question-generation-report.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add lib/ai/question-risk-flags.ts lib/ai/question-generation-report.ts tests/unit/question-risk-flags.test.ts tests/unit/question-generation-report.test.ts
git commit -m "feat(ai): add question quality report primitives"
```

---

### Task 2: Add the Append-Only Report Table

**Files:**
- Create: `supabase/migrations/0015_question_generation_reports.sql`
- Modify: `lib/supabase/types.ts` using `npm run typegen`
- Test: `tests/integration/question-generation-reports-schema.test.ts`

**Interfaces:**
- Consumes: report insert shape from Task 1.
- Produces: `question_generation_reports` table.
- Produces: generated Supabase table type and hand-maintained aliases:
  - `QuestionGenerationReportRow`
  - `QuestionGenerationReportInsert`
  - `QuestionGenerationReportUpdate`

- [ ] **Step 1: Write the failing integration schema/RLS test**

Create `tests/integration/question-generation-reports-schema.test.ts`:

```ts
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

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
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
  await db.exec(readFileSync(path.join(MIGRATIONS_DIR, "0001_init.sql"), "utf8"));
  await db.exec(readFileSync(path.join(MIGRATIONS_DIR, "0015_question_generation_reports.sql"), "utf8"));
  await db.exec("grant usage on schema public to anon, authenticated, service_role;");
  return db;
}

describe("question_generation_reports schema", () => {
  let db: PGlite;
  let hostUserId: string;
  let reportId: string;

  async function runAs(role: "anon" | "authenticated", authUid: string | null, sql: string) {
    await db.exec(`select set_config('test.auth_uid', '${authUid ?? ""}', false);`);
    await db.exec(`set role ${role};`);
    try {
      return await db.query(sql);
    } finally {
      await db.exec(`reset role; select set_config('test.auth_uid', '', false);`);
    }
  }

  beforeAll(async () => {
    db = await freshDb();
    const one = async <T>(sql: string, params: unknown[] = []) =>
      (await db.query<T>(sql, params)).rows[0];
    const id = async (sql: string, params: unknown[] = []) =>
      (await one<{ id: string }>(sql + " returning id", params)).id;

    hostUserId = (await one<{ id: string }>("insert into auth.users default values returning id")).id;
    const hostId = await id("insert into hosts (user_id, display_name) values ($1, 'Host')", [hostUserId]);
    const nightId = await id("insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', 'ROOM01')", [hostId]);
    const gameId = await id("insert into games (night_id, game_no) values ($1, 1)", [nightId]);
    const categoryId = await id("insert into categories (game_id, name, topic, position) values ($1, 'Cat', 'Topic', 0)", [gameId]);

    reportId = await id(
      `insert into question_generation_reports (
         category_id, game_id, night_id, host_id, category_name, topic, mode, status,
         requested_count, accepted_count, generated_count, rejected_count, rounds,
         verify_passes, llm_calls, tokens_in, tokens_out, estimated_cost_usd,
         image_target_count, image_attached_count, image_skipped_count,
         risk_flag_count, report
       ) values (
         $1, $2, $3, $4, 'Cat', 'Topic', 'initial', 'completed',
         20, 20, 22, 2, 2, 2, 4, 100, 50, 0.1234,
         20, 18, 2, 3, '{"reasonCounts":{}}'::jsonb
       )`,
      [categoryId, gameId, nightId, hostId],
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  test("the additive report table exists with RLS enabled", async () => {
    const r = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname = 'question_generation_reports'",
    );
    expect(r.rows[0]?.relrowsecurity).toBe(true);
  });

  test("the owning authenticated host can read the report", async () => {
    const r = await runAs(
      "authenticated",
      hostUserId,
      `select id from question_generation_reports where id = '${reportId}'`,
    );
    expect(r.rows).toHaveLength(1);
  });

  test("anon cannot read reports", async () => {
    await expect(
      runAs("anon", null, "select id from question_generation_reports"),
    ).rejects.toThrow(/permission denied|violates row-level security/i);
  });
});
```

- [ ] **Step 2: Run the integration test and verify it fails**

Run: `npx vitest run tests/integration/question-generation-reports-schema.test.ts`

Expected: FAIL because migration `0015_question_generation_reports.sql` does not exist.

- [ ] **Step 3: Add the migration**

Create `supabase/migrations/0015_question_generation_reports.sql`:

```sql
-- 0015_question_generation_reports.sql
--
-- Append-only quality/cost ledger for AI category generation.
--
-- SAFE / ADDITIVE:
--   - One new table, no rewrite of existing tables.
--   - Nullable foreign keys with ON DELETE SET NULL keep historical report
--     summaries without preventing category/night cleanup.
--   - RLS enabled. Hosts can read their own reports; players/anon cannot.
--   - Writes are server-only through the service-role admin client.

set search_path = public, extensions;

create table question_generation_reports (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references categories on delete set null,
  game_id uuid references games on delete set null,
  night_id uuid references nights on delete set null,
  host_id uuid references hosts on delete set null,
  category_name text,
  topic text not null,
  mode text not null default 'unknown'
    check (mode in ('initial', 'reroll', 'auto_build', 'unknown')),
  status text not null
    check (status in ('completed', 'partial', 'failed')),
  requested_count smallint not null check (requested_count >= 0),
  accepted_count smallint not null check (accepted_count >= 0),
  generated_count smallint not null check (generated_count >= 0),
  rejected_count smallint not null check (rejected_count >= 0),
  rounds smallint not null check (rounds >= 0),
  verify_passes smallint not null check (verify_passes >= 0),
  llm_calls integer not null default 0 check (llm_calls >= 0),
  tokens_in integer not null default 0 check (tokens_in >= 0),
  tokens_out integer not null default 0 check (tokens_out >= 0),
  estimated_cost_usd numeric(10,4) not null default 0 check (estimated_cost_usd >= 0),
  image_target_count smallint not null default 0 check (image_target_count >= 0),
  image_attached_count smallint not null default 0 check (image_attached_count >= 0),
  image_skipped_count smallint not null default 0 check (image_skipped_count >= 0),
  risk_flag_count integer not null default 0 check (risk_flag_count >= 0),
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index question_generation_reports_category_created_idx
  on question_generation_reports (category_id, created_at desc);

create index question_generation_reports_host_created_idx
  on question_generation_reports (host_id, created_at desc);

alter table question_generation_reports enable row level security;

create policy question_generation_reports_host_read
  on question_generation_reports
  for select
  using (
    exists (
      select 1
      from hosts h
      where h.id = question_generation_reports.host_id
        and h.user_id = auth.uid()
    )
  );

revoke all on question_generation_reports from anon;
grant select on question_generation_reports to authenticated;
grant all on question_generation_reports to service_role;

comment on table question_generation_reports is
  'Append-only AI generation quality/cost report. Written server-side; read by the owning host only.';
```

- [ ] **Step 4: Run the integration test and verify it passes**

Run: `npx vitest run tests/integration/question-generation-reports-schema.test.ts`

Expected: PASS.

- [ ] **Step 5: Regenerate Supabase types**

Run: `npm run typegen`

Expected: `lib/supabase/types.ts` updates generated table definitions for `question_generation_reports`.

If local Supabase is not running, start it with `supabase start`, then re-run `npm run typegen`. Do not hand-edit the generated table section.

- [ ] **Step 6: Add hand-maintained aliases at the bottom of `lib/supabase/types.ts`**

Append below the existing convenience aliases:

```ts
export type QuestionGenerationReportRow = Tables<"question_generation_reports">
export type QuestionGenerationReportInsert = TablesInsert<"question_generation_reports">
export type QuestionGenerationReportUpdate = TablesUpdate<"question_generation_reports">
```

- [ ] **Step 7: Run type and migration checks**

Run:

```bash
npx vitest run tests/integration/question-generation-reports-schema.test.ts
npx tsc --noEmit
```

Expected:
- Integration test: PASS.
- TypeScript: PASS, except for the documented pre-existing `HostHomeClient-founder-build.test.tsx` baseline errors if they are still present. If those appear, record the exact errors in the PR notes.

- [ ] **Step 8: Commit Task 2**

```bash
git add supabase/migrations/0015_question_generation_reports.sql lib/supabase/types.ts tests/integration/question-generation-reports-schema.test.ts
git commit -m "feat(db): add question generation report ledger"
```

---

### Task 3: Add Generation and Verification Tracing Hooks

**Files:**
- Modify: `lib/ai/generate-questions.ts`
- Modify: `lib/ai/collect-verified-questions.ts`
- Modify: `tests/unit/generate-questions.test.ts`
- Modify: `tests/unit/collect-verified-questions.test.ts`

**Interfaces:**
- Consumes: `QuestionRejectionReason` from `lib/ai/question-generation-report.ts`.
- Produces: optional `GenerateQuestionsOptions.onRejectedCandidate`.
- Produces: optional `CollectVerifiedOptions.onRoundComplete`.
- Preserves: existing return values and behavior for all callers that omit callbacks.

- [ ] **Step 1: Add failing generate callback test**

Append to `tests/unit/generate-questions.test.ts` inside `describe("generateQuestions", ...)`:

```ts
  it("reports invalid schema candidates through the optional callback", async () => {
    const capture: MockClientCall[] = [];
    const rejected: Array<{ index: number; reason: string; issues: string[] }> = [];
    const client = makeMockClient(
      {
        questions: [
          validQuestion(),
          validQuestion({
            prompt: "Bad item three options total",
            options: ["alpha", "bravo", "charlie"],
          }),
        ],
      },
      capture,
    );

    const out = await generateQuestions({
      topic: "US states",
      onRejectedCandidate: (event) => rejected.push(event),
      // @ts-expect-error - narrowing
      client,
    });

    expect(out).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      index: 1,
      reason: "invalid_schema",
    });
    expect(rejected[0]?.issues.join(" ")).toMatch(/4|length|items/i);
  });
```

- [ ] **Step 2: Run the generate callback test and verify it fails**

Run: `npx vitest run tests/unit/generate-questions.test.ts -t "reports invalid schema"`

Expected: FAIL because `onRejectedCandidate` is not in `GenerateQuestionsOptions`.

- [ ] **Step 3: Implement the generate callback**

In `lib/ai/generate-questions.ts`, extend `GenerateQuestionsOptions`:

```ts
  /** Optional: observe candidates dropped by local validation. Return value unchanged. */
  onRejectedCandidate?: (event: {
    index: number;
    reason: "invalid_schema";
    issues: string[];
    prompt?: string;
  }) => void;
```

Inside the invalid `safeParse` branch, before `continue`, add:

```ts
      opts.onRejectedCandidate?.({
        index: i,
        reason: "invalid_schema",
        issues: parsed.error.issues.map((iss) => iss.message),
        prompt:
          typeof input.questions[i] === "object" &&
          input.questions[i] !== null &&
          "prompt" in input.questions[i] &&
          typeof (input.questions[i] as { prompt?: unknown }).prompt === "string"
            ? (input.questions[i] as { prompt: string }).prompt
            : undefined,
      });
```

- [ ] **Step 4: Run the generate callback test and verify it passes**

Run: `npx vitest run tests/unit/generate-questions.test.ts -t "reports invalid schema"`

Expected: PASS.

- [ ] **Step 5: Add failing collector tracing tests**

Append to `tests/unit/collect-verified-questions.test.ts`:

```ts
it("reports per-round wrong, ambiguous, and missing-verdict rejections", async () => {
  const events: Array<{
    round: number;
    requested: number;
    generated: number;
    accepted: number;
    rejected: Array<{ prompt: string; reasons: string[] }>;
  }> = [];

  const out = await collectVerifiedQuestions({
    target: 10,
    maxRounds: 1,
    generate: async () => [q("good"), q("wrong"), q("ambiguous"), q("missing")],
    verify: async () => [ok(0), wrong(1), ambig(2)],
    onRoundComplete: (event) => events.push(event),
  });

  expect(out.map((x) => x.prompt)).toEqual(["good"]);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    round: 1,
    requested: 10,
    generated: 4,
    accepted: 1,
  });
  expect(events[0]?.rejected).toEqual([
    { prompt: "wrong", reasons: ["verifier_wrong"] },
    { prompt: "ambiguous", reasons: ["verifier_ambiguous"] },
    { prompt: "missing", reasons: ["missing_verdict"] },
  ]);
});

it("reports an empty generation round before stopping", async () => {
  const events: Array<{ generated: number; accepted: number; rejected: unknown[] }> = [];

  const out = await collectVerifiedQuestions({
    target: 20,
    maxRounds: 1,
    generate: async () => [],
    verify: async () => [],
    onRoundComplete: (event) => events.push(event),
  });

  expect(out).toEqual([]);
  expect(events).toEqual([{ round: 1, requested: 20, generated: 0, accepted: 0, rejected: [] }]);
});
```

- [ ] **Step 6: Run collector tracing tests and verify they fail**

Run: `npx vitest run tests/unit/collect-verified-questions.test.ts -t "reports"`

Expected: FAIL because `onRoundComplete` is not in `CollectVerifiedOptions`.

- [ ] **Step 7: Implement collector tracing**

In `lib/ai/collect-verified-questions.ts`, add exports near the interfaces:

```ts
export type CollectVerifiedRejectionReason =
  | "verifier_wrong"
  | "verifier_ambiguous"
  | "missing_verdict";

export interface CollectVerifiedRoundEvent {
  round: number;
  requested: number;
  generated: number;
  accepted: number;
  rejected: Array<{
    prompt: string;
    reasons: CollectVerifiedRejectionReason[];
  }>;
}
```

Extend `CollectVerifiedOptions`:

```ts
  /** Optional observability hook. Does not affect returned clean questions. */
  onRoundComplete?: (event: CollectVerifiedRoundEvent) => void;
```

Inside the loop, replace the `if (batch.length === 0) break;` branch with:

```ts
    if (batch.length === 0) {
      opts.onRoundComplete?.({
        round: round + 1,
        requested: need,
        generated: 0,
        accepted: 0,
        rejected: [],
      });
      break;
    }
```

After `cleanByPass` is created, replace the current `batch.forEach` block with:

```ts
    const rejected: CollectVerifiedRoundEvent["rejected"] = [];
    let accepted = 0;
    batch.forEach((q, i) => {
      const reasons = new Set<CollectVerifiedRejectionReason>();
      for (const verdicts of passResults) {
        const v = new Map(verdicts.map((item) => [item.index, item])).get(i);
        if (!v) {
          reasons.add("missing_verdict");
        } else {
          if (!v.markedAnswerIsCorrect) reasons.add("verifier_wrong");
          if (v.ambiguous) reasons.add("verifier_ambiguous");
        }
      }
      if (reasons.size === 0 && cleanByPass.every((isClean) => isClean(i))) {
        clean.push(q);
        accepted += 1;
      } else {
        rejected.push({ prompt: q.prompt, reasons: [...reasons] });
      }
    });
    opts.onRoundComplete?.({
      round: round + 1,
      requested: need,
      generated: batch.length,
      accepted,
      rejected,
    });
```

- [ ] **Step 8: Run tracing tests**

Run:

```bash
npx vitest run tests/unit/generate-questions.test.ts tests/unit/collect-verified-questions.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add lib/ai/generate-questions.ts lib/ai/collect-verified-questions.ts tests/unit/generate-questions.test.ts tests/unit/collect-verified-questions.test.ts
git commit -m "feat(ai): trace question generation quality"
```

---

### Task 4: Persist Reports from the Generation Route

**Files:**
- Create: `lib/ai/question-generation-report-store.ts`
- Modify: `app/api/categories/[id]/generate/route.ts`
- Modify: `lib/api/broadcast.ts`
- Test: `tests/unit/question-generation-report-store.test.ts`
- Test: `tests/unit/category-generate-report-summary.test.ts`

**Interfaces:**
- Consumes: report accumulator and report insert mapper from Task 1.
- Consumes: collector/generator tracing hooks from Task 3.
- Produces: `persistQuestionGenerationReport(admin, insert): Promise<void>`.
- Produces: `CategoryDonePayload` with optional `auditSummary`.
- Preserves: category generation success when report insertion fails.

- [ ] **Step 1: Write the failing store test**

Create `tests/unit/question-generation-report-store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistQuestionGenerationReport } from "@/lib/ai/question-generation-report-store";
import type { QuestionGenerationReportInsert } from "@/lib/ai/question-generation-report";

const insert: QuestionGenerationReportInsert = {
  category_id: "11111111-1111-1111-1111-111111111111",
  game_id: "22222222-2222-2222-2222-222222222222",
  night_id: "33333333-3333-3333-3333-333333333333",
  host_id: "44444444-4444-4444-4444-444444444444",
  category_name: "Movies",
  topic: "Pixar",
  mode: "initial",
  status: "completed",
  requested_count: 20,
  accepted_count: 20,
  generated_count: 22,
  rejected_count: 2,
  rounds: 2,
  verify_passes: 2,
  llm_calls: 4,
  tokens_in: 100,
  tokens_out: 50,
  estimated_cost_usd: 0.1234,
  image_target_count: 20,
  image_attached_count: 18,
  image_skipped_count: 2,
  risk_flag_count: 3,
  report: { reasonCounts: {} },
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("persistQuestionGenerationReport", () => {
  it("inserts the report row", async () => {
    const insertMock = vi.fn(async () => ({ error: null }));
    const admin = { from: vi.fn(() => ({ insert: insertMock })) };

    await persistQuestionGenerationReport(admin, insert);

    expect(admin.from).toHaveBeenCalledWith("question_generation_reports");
    expect(insertMock).toHaveBeenCalledWith(insert);
  });

  it("swallows insert failures and logs a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const admin = {
      from: vi.fn(() => ({
        insert: vi.fn(async () => ({ error: { message: "table unavailable" } })),
      })),
    };

    await expect(persistQuestionGenerationReport(admin, insert)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[generate] question generation report write failed:",
      "table unavailable",
    );
  });
});
```

- [ ] **Step 2: Run the store test and verify it fails**

Run: `npx vitest run tests/unit/question-generation-report-store.test.ts`

Expected: FAIL with import error for `question-generation-report-store`.

- [ ] **Step 3: Implement best-effort report persistence**

Create `lib/ai/question-generation-report-store.ts`:

```ts
import "server-only";

import type { QuestionGenerationReportInsert } from "./question-generation-report";

interface ReportInsertClient {
  from(table: string): {
    insert(row: QuestionGenerationReportInsert): PromiseLike<{
      error: { message: string } | null;
    }>;
  };
}

export async function persistQuestionGenerationReport(
  admin: ReportInsertClient,
  insert: QuestionGenerationReportInsert,
): Promise<void> {
  try {
    const { error } = await admin
      .from("question_generation_reports")
      .insert(insert);
    if (error) {
      console.warn(
        "[generate] question generation report write failed:",
        error.message,
      );
    }
  } catch (err) {
    console.warn(
      "[generate] question generation report write failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
```

- [ ] **Step 4: Add the typed done payload**

In `lib/api/broadcast.ts`, import the host summary type:

```ts
import type { HostQuestionAuditSummary } from "@/lib/ai/question-generation-report";
```

Add below `CategoryProgressPayload`:

```ts
/** Payload for the category generation completion event. */
export interface CategoryDonePayload extends CategoryBroadcastPayload {
  count: number;
  auditSummary?: HostQuestionAuditSummary;
}
```

- [ ] **Step 5: Add a focused route summary mapper test**

Create `tests/unit/category-generate-report-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createQuestionGenerationReportAccumulator,
  hostAuditSummaryFromSnapshot,
} from "@/lib/ai/question-generation-report";
import type { GeneratedQuestion } from "@/lib/ai/generate-questions";

function q(prompt: string): GeneratedQuestion {
  return {
    prompt,
    options: ["A", "B", "C", "D"],
    correctIndex: 0,
    difficulty: 4,
    factBlurb: "A stable fact blurb.",
    photoQuery: "photo query",
  };
}

describe("generation done audit summary", () => {
  it("contains only compact host-safe metrics", () => {
    const acc = createQuestionGenerationReportAccumulator({
      requestedCount: 20,
      verifyPasses: 2,
    });
    acc.recordRound({
      round: 1,
      requested: 20,
      generated: 21,
      accepted: 20,
      rejected: [{ prompt: "wrong", reasons: ["verifier_wrong"] }],
    });
    acc.recordAcceptedQuestions([
      q("As of 2026, what is the largest country by area in the world?"),
    ]);
    acc.recordImageTargets(20);
    acc.recordImageAttached();
    const summary = hostAuditSummaryFromSnapshot(acc.snapshot("completed"));

    expect(summary).toEqual({
      acceptedCount: 20,
      generatedCount: 21,
      verifyPasses: 2,
      estimatedCostUsd: 0,
      imageTargetCount: 20,
      imageAttachedCount: 1,
      riskFlagCount: 3,
    });
  });
});
```

- [ ] **Step 6: Wire the route context and accumulator**

In `app/api/categories/[id]/generate/route.ts`, extend imports:

```ts
import {
  createQuestionGenerationReportAccumulator,
  hostAuditSummaryFromSnapshot,
  questionGenerationReportInsertFromSnapshot,
  type HostQuestionAuditSummary,
  type QuestionGenerationReportContext,
} from "@/lib/ai/question-generation-report";
import { persistQuestionGenerationReport } from "@/lib/ai/question-generation-report-store";
import type { CategoryDonePayload } from "@/lib/api/broadcast";
```

Add `reportContext` before `after(async () => {`:

```ts
  const reportContext: QuestionGenerationReportContext = {
    categoryId,
    gameId: category.game_id,
    nightId: owned.night.id,
    hostId: owned.host.id,
    categoryName: category.name,
    topic: category.topic,
    mode: parsed.data.autoPick
      ? "auto_build"
      : parsed.data.keptIds
        ? "reroll"
        : "initial",
  };
```

Pass it into `runGenerationJob`:

```ts
      reportContext,
```

Extend `runGenerationJob` options:

```ts
  reportContext: QuestionGenerationReportContext;
```

At the top of `runGenerationJob`, after `const admin = getSupabaseAdmin();`, add:

```ts
  const qualityReport = createQuestionGenerationReportAccumulator({
    requestedCount: 20,
    verifyPasses: 2,
  });
  let auditSummary: HostQuestionAuditSummary | undefined;
```

Inside `trackUsage`, after cost accounting, add:

```ts
    qualityReport.recordUsage(model, u);
```

Inside `generateQuestions({...})`, add:

```ts
          onRejectedCandidate: (event) => {
            qualityReport.recordInvalidCandidate(
              event.prompt ?? `candidate ${event.index}`,
              event.issues,
            );
          },
```

Inside `collectVerifiedQuestions({...})`, add:

```ts
      onRoundComplete: (event) => {
        qualityReport.recordRound({
          round: event.round,
          requested: event.requested,
          generated: event.generated,
          accepted: event.accepted,
          rejected: event.rejected.map((item) => ({
            prompt: item.prompt,
            reasons: item.reasons,
          })),
        });
      },
```

After `generated.length === 0` check and before insert rows, add:

```ts
  qualityReport.recordAcceptedQuestions(generated);
```

After `photoTargets` is finalized, before the photo loop, add:

```ts
  qualityReport.recordImageTargets(photoTargets.length);
```

Inside the successful `if (photo.imageUrl)` block, after the DB update, add:

```ts
        qualityReport.recordImageAttached();
```

Before broadcasting `"done"`, add:

```ts
  const reportSnapshot = qualityReport.snapshot(
    generated.length >= 20 ? "completed" : "partial",
  );
  auditSummary = hostAuditSummaryFromSnapshot(reportSnapshot);
  await persistQuestionGenerationReport(
    admin,
    questionGenerationReportInsertFromSnapshot(opts.reportContext, reportSnapshot),
  );
```

Replace the done payload with typed payload:

```ts
  const donePayload: CategoryDonePayload = {
    serverNow: new Date().toISOString(),
    count: inserted.length,
    auditSummary,
  };
  await broadcastToCategory(opts.categoryId, "done", donePayload).catch(
    () => undefined,
  );
```

- [ ] **Step 7: Run focused Task 4 tests**

Run:

```bash
npx vitest run tests/unit/question-generation-report-store.test.ts tests/unit/category-generate-report-summary.test.ts
npx tsc --noEmit
```

Expected:
- Unit tests: PASS.
- TypeScript: PASS, except for the documented pre-existing `HostHomeClient-founder-build.test.tsx` baseline errors if they are still present.

- [ ] **Step 8: Commit Task 4**

```bash
git add lib/ai/question-generation-report-store.ts lib/api/broadcast.ts app/api/categories/[id]/generate/route.ts tests/unit/question-generation-report-store.test.ts tests/unit/category-generate-report-summary.test.ts
git commit -m "feat(ai): persist generation quality reports"
```

---

### Task 5: Surface the Host Audit Summary in Setup Review

**Files:**
- Create: `components/host/gen/HostGenAuditSummary.tsx`
- Modify: `components/host/gen/index.ts`
- Modify: `components/host/gen/HostGenPick.tsx`
- Modify: `app/host/setup/[nightId]/pick/[categoryId]/page.tsx`
- Modify: `app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient.tsx`
- Test: `tests/component/HostGenAuditSummary.test.tsx`
- Modify: `tests/component/HostGenPick.test.tsx`

**Interfaces:**
- Consumes: `HostQuestionAuditSummary`.
- Produces: optional `auditSummary?: HostQuestionAuditSummary | null` prop on `HostGenPick`.
- Produces: optional `initialAuditSummary?: HostQuestionAuditSummary | null` prop on `HostSetupPickClient`.
- Preserves: no summary state for old categories with no report.

- [ ] **Step 1: Write failing component tests for the audit summary**

Create `tests/component/HostGenAuditSummary.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeProvider } from "@/components/system";
import { HostGenAuditSummary } from "@/components/host/gen/HostGenAuditSummary";

afterEach(cleanup);

describe("HostGenAuditSummary", () => {
  it("renders compact accepted, cost, image, and risk metrics", () => {
    render(
      <ThemeProvider themeKey="house">
        <HostGenAuditSummary
          summary={{
            acceptedCount: 20,
            generatedCount: 27,
            verifyPasses: 2,
            estimatedCostUsd: 0.1432,
            imageTargetCount: 20,
            imageAttachedCount: 18,
            riskFlagCount: 3,
          }}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("20 accepted from 27 candidates")).toBeInTheDocument();
    expect(screen.getByText("2 verification passes")).toBeInTheDocument();
    expect(screen.getByText("Estimated AI cost: $0.14")).toBeInTheDocument();
    expect(screen.getByText("Images: 20 attempted, 18 attached")).toBeInTheDocument();
    expect(screen.getByText("3 wording flags to review")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the component test and verify it fails**

Run: `npx vitest run tests/component/HostGenAuditSummary.test.tsx`

Expected: FAIL with import error for `HostGenAuditSummary`.

- [ ] **Step 3: Implement `HostGenAuditSummary`**

Create `components/host/gen/HostGenAuditSummary.tsx`:

```tsx
"use client";

import { Eyebrow, Numeric, useTheme } from "@/components/system";
import type { HostQuestionAuditSummary } from "@/lib/ai/question-generation-report";

export interface HostGenAuditSummaryProps {
  summary: HostQuestionAuditSummary;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function HostGenAuditSummary({ summary }: HostGenAuditSummaryProps) {
  const { t } = useTheme();
  const riskCopy =
    summary.riskFlagCount === 1
      ? "1 wording flag to review"
      : `${summary.riskFlagCount} wording flags to review`;

  const items = [
    `${summary.acceptedCount} accepted from ${summary.generatedCount} candidates`,
    `${summary.verifyPasses} verification passes`,
    `Estimated AI cost: ${money(summary.estimatedCostUsd)}`,
    `Images: ${summary.imageTargetCount} attempted, ${summary.imageAttachedCount} attached`,
    riskCopy,
  ];

  return (
    <section
      aria-label="Question quality summary"
      data-testid="host-gen-audit-summary"
      style={{
        marginBottom: 14,
        padding: "12px 14px",
        borderRadius: 8,
        border: `1px solid ${t.line}`,
        background: t.dark ? "rgba(255,255,255,.035)" : "rgba(255,255,255,.78)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <Eyebrow color={t.inkMid} size={9}>AI CHECK</Eyebrow>
      {items.map((item, index) => (
        <span
          key={item}
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: 6,
            color: index === 4 && summary.riskFlagCount > 0 ? t.accent : t.inkMid,
            fontSize: 11.5,
            fontWeight: 600,
          }}
        >
          <Numeric size={11} weight={700} color="currentColor">
            {index + 1}
          </Numeric>
          {item}
        </span>
      ))}
    </section>
  );
}
```

Export it from `components/host/gen/index.ts`:

```ts
export { HostGenAuditSummary } from "./HostGenAuditSummary";
export type { HostGenAuditSummaryProps } from "./HostGenAuditSummary";
```

- [ ] **Step 4: Run summary component test**

Run: `npx vitest run tests/component/HostGenAuditSummary.test.tsx`

Expected: PASS.

- [ ] **Step 5: Add failing HostGenPick integration test**

Append to `tests/component/HostGenPick.test.tsx`:

```tsx
  it("renders the audit summary above the candidate grid when provided", () => {
    const questions = clumpQuestions(3);

    render(
      <HostGenPick
        themeKey="house"
        topic="Grunge bands"
        questions={questions}
        auditSummary={{
          acceptedCount: 7,
          generatedCount: 9,
          verifyPasses: 2,
          estimatedCostUsd: 0.12,
          imageTargetCount: 7,
          imageAttachedCount: 6,
          riskFlagCount: 1,
        }}
      />,
    );

    expect(screen.getByTestId("host-gen-audit-summary")).toBeInTheDocument();
    expect(screen.getByText("7 accepted from 9 candidates")).toBeInTheDocument();
  });
```

- [ ] **Step 6: Wire `HostGenPick` prop and render**

In `components/host/gen/HostGenPick.tsx`, add import:

```ts
import { HostGenAuditSummary } from "./HostGenAuditSummary";
import type { HostQuestionAuditSummary } from "@/lib/ai/question-generation-report";
```

Extend `HostGenPickProps`:

```ts
  /** Compact AI quality/cost summary for the generated batch. Omitted for old categories. */
  auditSummary?: HostQuestionAuditSummary | null;
```

Destructure in `HostGenPickInner`:

```ts
  auditSummary = null,
```

Render above the question grid, inside the scrollable left column:

```tsx
          {auditSummary && <HostGenAuditSummary summary={auditSummary} />}
```

- [ ] **Step 7: Server-load latest report on hard refresh**

In `app/host/setup/[nightId]/pick/[categoryId]/page.tsx`, import:

```ts
import { hostAuditSummaryFromReportRow } from "@/lib/ai/question-generation-report";
import type { QuestionGenerationReportRow } from "@/lib/supabase/types";
```

Add this query after the questions query:

```ts
  const { data: reportRow } = await admin
    .from("question_generation_reports")
    .select("*")
    .eq("category_id", categoryId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const initialAuditSummary = reportRow
    ? hostAuditSummaryFromReportRow(reportRow as QuestionGenerationReportRow)
    : null;
```

Pass prop:

```tsx
      initialAuditSummary={initialAuditSummary}
```

Add `hostAuditSummaryFromReportRow` to `lib/ai/question-generation-report.ts`:

```ts
import type { QuestionGenerationReportRow } from "@/lib/supabase/types";

export function hostAuditSummaryFromReportRow(
  row: QuestionGenerationReportRow,
): HostQuestionAuditSummary {
  return {
    acceptedCount: row.accepted_count,
    generatedCount: row.generated_count,
    verifyPasses: row.verify_passes,
    estimatedCostUsd: Number(row.estimated_cost_usd),
    imageTargetCount: row.image_target_count,
    imageAttachedCount: row.image_attached_count,
    riskFlagCount: row.risk_flag_count,
  };
}
```

- [ ] **Step 8: Update the pick client to receive initial and broadcast summaries**

In `HostSetupPickClient.tsx`, import types:

```ts
import type { CategoryDonePayload } from "@/lib/api/broadcast";
import type { HostQuestionAuditSummary } from "@/lib/ai/question-generation-report";
```

Extend props:

```ts
  initialAuditSummary?: HostQuestionAuditSummary | null;
```

Destructure:

```ts
  initialAuditSummary = null,
```

Add state:

```ts
  const [auditSummary, setAuditSummary] = useState<HostQuestionAuditSummary | null>(
    initialAuditSummary,
  );
```

Update the `done` handler:

```ts
      .on("broadcast", { event: "done" }, (msg) => {
        if (cancelled) return;
        const payload = msg.payload as CategoryDonePayload;
        if (payload.auditSummary) setAuditSummary(payload.auditSummary);
        setGenPhase(null);
        setState("review");
        setRegenerating(false);
        void refetchQuestions();
      })
```

Pass to `HostGenPick`:

```tsx
        auditSummary={auditSummary}
```

- [ ] **Step 9: Run component and type checks**

Run:

```bash
npx vitest run tests/component/HostGenAuditSummary.test.tsx tests/component/HostGenPick.test.tsx
npx tsc --noEmit
```

Expected:
- Component tests: PASS.
- TypeScript: PASS, except for the documented pre-existing `HostHomeClient-founder-build.test.tsx` baseline errors if they are still present.

- [ ] **Step 10: Commit Task 5**

```bash
git add components/host/gen/HostGenAuditSummary.tsx components/host/gen/index.ts components/host/gen/HostGenPick.tsx app/host/setup/[nightId]/pick/[categoryId]/page.tsx app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient.tsx lib/ai/question-generation-report.ts tests/component/HostGenAuditSummary.test.tsx tests/component/HostGenPick.test.tsx
git commit -m "feat(host): show question generation audit summary"
```

---

### Task 6: Final Verification and PR Prep

**Files:**
- Modify only if needed: files touched by Tasks 1-5.
- No new feature scope.

**Interfaces:**
- Consumes: completed implementation from Tasks 1-5.
- Produces: verified branch ready for PR review.

- [ ] **Step 1: Run focused unit/component/integration tests**

Run:

```bash
npx vitest run \
  tests/unit/question-risk-flags.test.ts \
  tests/unit/question-generation-report.test.ts \
  tests/unit/question-generation-report-store.test.ts \
  tests/unit/category-generate-report-summary.test.ts \
  tests/unit/generate-questions.test.ts \
  tests/unit/collect-verified-questions.test.ts \
  tests/component/HostGenAuditSummary.test.tsx \
  tests/component/HostGenPick.test.tsx \
  tests/integration/question-generation-reports-schema.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full unit/component/integration suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Run TypeScript**

Run: `npx tsc --noEmit`

Expected: PASS, except for the documented pre-existing `HostHomeClient-founder-build.test.tsx` baseline errors if still present. If those errors appear, copy the exact file/error lines into the PR notes and mark them as pre-existing baseline noise per `AGENTS.md`.

- [ ] **Step 4: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Inspect production-safety diff**

Run:

```bash
git diff origin/main...HEAD -- supabase/migrations app/api/categories/[id]/generate/route.ts app/host/setup/[nightId]/pick/[categoryId] components/host/gen lib/ai lib/api/broadcast.ts
```

Expected:
- Only additive migration.
- No gameplay route changes for reveal, resolve, scoring, answers, lock-in, timers, or live room state.
- Report persistence wrapped as best-effort.
- No production secrets or PII.

- [ ] **Step 6: Commit any final fixes**

If Step 1-5 required fixes:

```bash
git add <fixed-files>
git commit -m "fix: stabilize trusted question pipeline report"
```

If no fixes were needed, do not create an empty commit.

- [ ] **Step 7: Push and open PR**

```bash
git status -sb
git push -u origin <branch-name>
gh pr create --fill
```

Expected:
- Branch is pushed.
- PR description includes:
  - Additive-only database migration.
  - Report writes are best-effort and non-blocking.
  - Heather's Classic gameplay unchanged.
  - Verification commands and outcomes.
  - Any known baseline TypeScript errors if present.

---

## Implementation Notes

- The implementation branch should start from current `origin/main` or from a docs-only branch after this plan/design PR is merged.
- Keep each task as its own commit.
- Do not combine this with approved question bank or GTM validation.
- Do not deploy or push to `main` directly.
- Do not run production migrations manually during implementation.
