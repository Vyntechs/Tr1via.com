# Trusted Question Pipeline v1 - Design

**Date:** 2026-06-29
**Status:** Draft for product review
**Capability packet:** Content Quality and Cost Control

## 1. Recommendation

Plan the first capability packet as **Trusted Question Pipeline v1**.

This packet should make the existing AI generation pipeline measurable, auditable, and safer for host review without changing Heather's Classic gameplay. It is the right first packet because it protects the trust problem Brandon has already seen in live trivia: wrong, ambiguous, or arguable questions embarrass the host faster than almost any visual polish issue, and API/image spend is already expensive enough to need real accounting.

The first build should not try to create the full future question bank. It should create the quality and cost ledger that future question reuse depends on.

## 2. Product Goal

When a host generates a category, TR1VIA should be able to answer four questions:

1. How many candidate questions were generated?
2. How many survived verification, and why did the others fail?
3. Which accepted questions still deserve human attention because their wording is riskier?
4. What did this usable category cost in model calls, tokens, and image work?

The host experience should stay calm: a compact audit summary in setup/review, not a new moderation workflow.

## 3. Safety Boundary

This packet must be production-safe by design.

- No destructive database migration.
- No table drops, column drops, renames, or backfills.
- No production data cleanup.
- No change to scoring, reveal, lock-in, timers, answer submission, or live-game flow.
- No change to which questions players see during a live game.
- No report write can block a successful generation.
- If the additive report table is unavailable or a report insert fails, generation continues and logs a warning.
- If implementation discovers a non-additive database change is required, stop and redesign or move to a staging branch.

`main` remains the production branch. The implementation can be PR-first to `main` only if the migration remains additive and gameplay behavior remains unchanged.

## 4. Current System Facts

The current pipeline already does several important things right:

- `generateQuestions` writes structured candidate questions with Sonnet and drops invalid schema items.
- `collectVerifiedQuestions` runs generate -> verify -> refill until it reaches the target or exhausts bounded rounds.
- `verifyAnswers` uses Opus as an independent checker and returns minimal verdicts: marked answer correct, ambiguous, and index.
- The generation route inserts only verified questions, so the host does not see unverified candidates.
- The route logs aggregate model cost in memory with `[generation-cost]`.
- Auto-build mode picks 7 questions before photo attachment, avoiding wasted Pexels calls.
- Manual review still attaches photos to the full generated pool so the host can review/swap visually.

The gap is not basic verification. The gap is that the system does not persist a durable quality/cost record, does not classify rejection reasons, and does not surface risk flags that help a host audit questions before showtime.

## 5. Scope

### In Scope

- Append-only generation quality reports for new AI generation runs.
- Rejection taxonomy for generated candidates.
- Cost accounting persisted per generation run.
- Risk flags for accepted questions that deserve human review.
- Compact host-facing audit summary in setup/review.
- Tests proving reporting is best-effort and non-blocking.

### Out of Scope

- Approved question bank.
- Cross-night content reuse.
- Model switching or cheaper-model routing.
- Rewriting accepted questions automatically.
- Source citation retrieval.
- Live-game verification.
- Player-facing quality labels.
- Open player chat or reactions.
- Changing Heather's Classic gameplay.
- Production backfill for old generations.

## 6. Data Design

Add one append-only table, tentatively named `question_generation_reports`.

Recommended columns:

| Column | Purpose |
| --- | --- |
| `id uuid primary key default gen_random_uuid()` | Stable report id. |
| `category_id uuid references categories on delete set null` | Link to the generated category when it still exists. |
| `game_id uuid references games on delete set null` | Easier host/night lookup. |
| `night_id uuid references nights on delete set null` | Easier host/night lookup and future rollups. |
| `host_id uuid references hosts on delete set null` | Host ownership for RLS/server reads. |
| `category_name text` | Snapshot because category rows may later change or be deleted. |
| `topic text not null` | Snapshot of the prompt topic used. |
| `mode text not null` | `initial`, `reroll`, `auto_build`, or `unknown`. |
| `status text not null` | `completed`, `partial`, or `failed`. |
| `requested_count smallint not null` | Target accepted count. |
| `accepted_count smallint not null` | Questions inserted or accepted. |
| `generated_count smallint not null` | Total candidate questions produced by generation. |
| `rejected_count smallint not null` | Total candidates not accepted. |
| `rounds smallint not null` | Generation/refill rounds attempted. |
| `verify_passes smallint not null` | Verification pass count. |
| `llm_calls integer not null default 0` | Generate plus verify calls. |
| `tokens_in integer not null default 0` | Input/cache tokens counted for cost. |
| `tokens_out integer not null default 0` | Output tokens counted for cost. |
| `estimated_cost_usd numeric(10,4) not null default 0` | Canonical estimate from `lib/ai/usage-cost.ts`. |
| `image_target_count smallint not null default 0` | Questions attempted for photo attachment. |
| `image_attached_count smallint not null default 0` | Questions that received a photo. |
| `image_skipped_count smallint not null default 0` | Questions without a final photo. |
| `risk_flag_count integer not null default 0` | Count of accepted question risk flags. |
| `report jsonb not null default '{}'::jsonb` | Structured detail for candidates, flags, and reason counts. |
| `created_at timestamptz not null default now()` | Report timestamp. |

RLS should be enabled. The safest v1 read path is a server route or server component that first proves category/night ownership using existing host auth helpers, then reads reports with the admin client. If direct Supabase client reads are added, policies must mirror host ownership through `host_id` or `night_id`.

No player route should read this table.

## 7. Rejection Taxonomy

Persist reason counts in `report.reasonCounts` and candidate-level status in `report.candidates`.

Initial reason set:

| Reason | Meaning |
| --- | --- |
| `invalid_schema` | The generator emitted an item that failed Zod validation. |
| `verifier_wrong` | At least one verify pass said the marked answer was not correct. |
| `verifier_ambiguous` | At least one verify pass said the question was ambiguous. |
| `missing_verdict` | A verify pass did not return a verdict for that candidate. |
| `duplicate_prompt` | The collector rejected or skipped a prompt already seen in the run. |
| `generation_empty` | A round returned no valid candidates. |
| `max_rounds_exhausted` | The run ended before the requested clean count was reached. |

This taxonomy is operational. It does not need to be perfect on day one; it needs to be stable enough to explain why questions are being lost and where cost is going.

## 8. Risk Flags

Risk flags should be deterministic and cheap in v1. Do not add another AI call for this packet.

Create a pure helper, for example `lib/ai/question-risk-flags.ts`, that scans accepted prompts, answer options, and fact blurbs.

Initial flags:

| Flag | Trigger examples | Host meaning |
| --- | --- | --- |
| `time_sensitive` | current, today, newest, latest, as of, record | Check whether the answer can go stale. |
| `ranking_or_superlative` | first, largest, oldest, biggest, most, best, only | Check wording carefully. |
| `geography_sensitive` | country, capital, state, city, world, national | Check jurisdiction/wording. |
| `subjective_wording` | best, greatest, most popular, famous | Might be arguable. |
| `multiple_answer_risk` | except, not, all of these, both, either | Check whether multiple options can be defended. |

Risk flags do not reject questions in v1. They guide host review.

## 9. Pipeline Design

Extend the current pipeline instead of replacing it.

### 9.1 Generation Detail

`generateQuestions` currently returns only valid questions and logs dropped invalid items. Add an optional callback, for example:

```ts
onRejectedCandidate?: (event: {
  index: number;
  reason: "invalid_schema";
  issues: string[];
}) => void;
```

This preserves existing call sites and tests. The function still returns `GeneratedQuestion[]`.

### 9.2 Verification Detail

Keep `verifyAnswers` minimal. Its current verdict shape is intentionally reliable.

Extend `collectVerifiedQuestions` with optional tracing:

```ts
onRoundComplete?: (event: {
  round: number;
  requested: number;
  generated: number;
  accepted: number;
  rejected: Array<{
    prompt: string;
    reasons: Array<
      "verifier_wrong" |
      "verifier_ambiguous" |
      "missing_verdict"
    >;
  }>;
}) => void;
```

The collector remains backward compatible: default behavior and return type do not change.

### 9.3 Report Assembly

In `runGenerationJob`, create a local report accumulator:

- Start the report before generation.
- Track token usage through the existing `trackUsage`.
- Track collector rounds through `onRoundComplete`.
- Run risk flags on accepted questions before insert.
- Track image targets and successful photo attachments.
- Write the final report after generation completes.
- Also attempt a failure report from the route catch path when the job fails before completion.

All report writes must be wrapped in `try/catch`.

### 9.4 Host Audit Summary

Add a compact setup/review summary, probably near `HostGenPick`, using a server-loaded report for the category.

Suggested copy style:

- `20 accepted from 27 candidates`
- `2 verification passes`
- `Estimated AI cost: $0.14`
- `Images: 20 attempted, 18 attached`
- `3 wording flags to review`

Question-level badges can be small:

- `Verified`
- `Review wording`
- `Image fallback`

Do not introduce alarming language unless a question truly failed. Rejected candidates are not shown to the host by default; they are operational detail.

## 10. Failure Modes

- **Report insert fails:** log warning, keep category generation success.
- **Report read fails:** hide the audit summary or show neutral unavailable state; do not block picking.
- **Generation fails before report creation:** existing rollback behavior remains; best-effort failure report may be written.
- **Pexels rate limit:** existing behavior remains; report records fewer attached images.
- **Reroll cleanup warning:** existing behavior remains; report mode records `reroll`.
- **Old category has no report:** UI works normally with no audit summary.

## 11. Implementation Plan Shape

The follow-up implementation plan should be split into small PR-safe tasks:

1. Add report types, risk flag helper, and unit tests.
2. Add additive migration and RLS/read strategy.
3. Add collector/generator tracing callbacks and tests.
4. Wire report assembly into the generation route as best-effort.
5. Add host setup/review summary UI.
6. Add focused verification and PR.

Do not combine this with question bank, model-routing, or Room Magic.

## 12. Test Plan

Required tests before implementation PR is ready:

- Unit: risk flag helper returns expected flags and avoids false positives on ordinary prompts.
- Unit: `collectVerifiedQuestions` reports wrong, ambiguous, and missing-verdict candidates through tracing.
- Unit: `generateQuestions` reports invalid schema candidates through callback while preserving existing return behavior.
- Unit or integration: report accumulator computes reason counts, accepted count, token totals, image counts, and estimated cost.
- Route-level test: report write failure does not fail category generation.
- Migration check: additive report table exists with RLS enabled.
- UI/component test: audit summary renders when report exists and stays absent/neutral when no report exists.

Standard verification:

- `npm test` for focused tests and any touched component tests.
- `npx tsc --noEmit`; if the known `HostHomeClient-founder-build.test.tsx` baseline errors remain, report them explicitly.
- No production API calls.
- No production database migration during development.

## 13. Done Criteria

The packet is done when:

- New AI category generations persist a quality/cost report.
- Existing categories with no report still work.
- Host review can see a compact quality/cost summary.
- Accepted questions can carry risk flags without changing gameplay.
- Report write/read failures are non-blocking.
- The implementation PR contains only additive schema changes and no live gameplay contract changes.

## 14. Decision Gate

Approve this design before writing the implementation plan.

The real gate is whether this packet should include the host-facing audit summary in v1 or keep v1 backend-only. My recommendation is to include the compact host summary because Brandon's stated pain is not just data quality in the abstract; it is catching bad or arguable questions before a live show.
