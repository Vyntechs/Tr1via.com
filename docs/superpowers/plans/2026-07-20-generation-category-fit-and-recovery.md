# Generation Category Fit and Automatic Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent off-category questions from reaching Heather and automatically finish resumable partial generation jobs without making her repeatedly press Continue.

**Architecture:** Extend the existing independent verifier with the requested topic and a fail-closed `fitsRequestedTopic` verdict, then reject/refill mismatches through the existing collection loop. Extend durable generation progress with the server attempt number and let the host setup client automatically resume a bounded number of `needs_attention` jobs while preserving the current manual fallback. Make the generate route use the same derived stale-job decision as the client so both sides agree when a job is resumable.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Anthropic SDK, Supabase, Vitest, Testing Library.

**Execution status (2026-07-20):** Tasks 1, 2, 2A, and 2B are implemented and
verified. All durable generation effects now validate the attempt inside the
same locked database transaction. Full tests, typecheck, build, static review,
security review, and runtime validation pass. Heather's existing unopened Game
1 was also corrected with guarded production data edits. PR #154 is open;
migration-first production release remains.

## Global Constraints

- Heather's setup sequence and controls remain unchanged when generation succeeds.
- Existing certified questions remain durable and are never regenerated on resume.
- Automatic recovery is bounded to three total server attempts, including jobs that saved zero choices; after that, the existing Continue/manual-entry recovery remains available.
- Category fit must honor qualifiers and exclusions such as `non-`, `only`, geography, era, age group, and stated omissions.
- Original-mode questions must remain answerable without an image.
- Task 2B uses one additive database migration. It changes no existing rows and
  exposes service-role-only transactional generation functions.

---

### Task 1: Make category fit part of independent certification

**Files:**
- Modify: `tests/unit/verify-answers.test.ts`
- Modify: `tests/unit/collect-verified-questions.test.ts`
- Modify: `lib/ai/verify-answers.ts`
- Modify: `lib/ai/collect-verified-questions.ts`
- Modify: `lib/ai/question-generation-report.ts`
- Modify: `app/api/categories/[id]/generate/route.ts`

**Interfaces:**
- Consumes: category topic already available as `opts.topic` in `runGenerationJob`.
- Produces: `AnswerVerdict.fitsRequestedTopic: boolean`, `VerifyAnswersOptions.topic: string`, and rejection reason `category_mismatch`.

- [x] **Step 1: Write failing verifier contract tests**

Add a test that calls `verifyAnswers` with `topic: "Non-venomous snakes"`, then asserts every verifier payload contains that topic and the tool schema requires `fitsRequestedTopic`.

- [x] **Step 2: Write the failing final-gate regression**

Add `rejects a venomous species question from the Non-venomous snakes category even when its answer is correct` to `tests/unit/collect-verified-questions.test.ts`. Supply an otherwise-clean verdict with `fitsRequestedTopic: false`; expect no accepted question and a `category_mismatch` rejection.

- [x] **Step 3: Run tests and verify RED**

Run: `npx vitest run tests/unit/verify-answers.test.ts tests/unit/collect-verified-questions.test.ts`

Expected: FAIL because the verdict/tool contract has no topic-fit field and the collection gate accepts the mismatched question.

- [x] **Step 4: Implement the minimal verifier and gate changes**

Require `topic` in `VerifyAnswersOptions`, include `requestedTopic` in each chunk payload, instruct the verifier to fail category membership when qualifiers or exclusions are violated, require `fitsRequestedTopic` in the tool schema, fail closed while parsing, and reject false values as `category_mismatch`. Pass `opts.topic` from the generation route.

- [x] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/verify-answers.test.ts tests/unit/collect-verified-questions.test.ts tests/unit/ai-prompts.test.ts`

Expected: all tests pass.

### Task 2: Automatically resume partial certified generation

**Files:**
- Modify: `tests/unit/generation-job.test.ts`
- Create: `tests/unit/generation-auto-resume.test.ts`
- Create: `tests/unit/generation-heartbeat.test.ts`
- Create: `tests/component/HostSetupPickClient-auto-resume.test.tsx`
- Modify: `lib/ai/generation-job.ts`
- Create: `lib/ai/generation-heartbeat.ts`
- Create: `lib/host/generationAutoResume.ts`
- Modify: `app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient.tsx`
- Modify: `app/api/categories/[id]/generate/route.ts`

**Interfaces:**
- Consumes: `GenerationJobProgress` from durable polling.
- Produces: `GenerationJobProgress.attempt` and `shouldAutoResumeGeneration(progress)`.

- [x] **Step 1: Write failing progress and policy tests**

Assert that progress exposes the durable attempt number and that auto-resume is allowed only for `needs_attention`, a positive remaining count, and attempts below three. Cover both zero saved choices after a provider timeout and 19 saved choices with one remaining. Assert attempt three remains a manual recovery screen.

- [x] **Step 2: Run tests and verify RED**

Run: `npx vitest run tests/unit/generation-job.test.ts tests/unit/generation-auto-resume.test.ts tests/unit/generation-heartbeat.test.ts tests/component/HostSetupPickClient-auto-resume.test.tsx`

Expected: FAIL because progress does not expose `attempt`, no bounded policy exists, heartbeat writes are not drainable, and the host client does not resume automatically.

- [x] **Step 3: Implement the pure bounded policy**

Add `attempt` to `generationProgressFromRow` and implement `shouldAutoResumeGeneration` with a three-attempt ceiling. Add a single-flight durable-heartbeat gate whose `drain()` waits for the current write before terminal job state can be recorded.

- [x] **Step 4: Wire the host client to resume once per durable attempt**

When polling returns an eligible `needs-attention` result, keep the calm loading view mounted, show the certified count and shortfall, and call the existing resume POST once for that durable attempt. Retain `HostGenError` after the ceiling or an unrecoverable response. A 409 must never be treated as a successful restart or hide the Continue control.

- [x] **Step 5: Align the API's stale-job decision**

Use `generationProgressFromRow(existingJob).phase` when deciding whether a `generating` category is resumable so a dead worker cannot be rejected as merely “already generating” after the client has correctly identified it as stale. Drain any in-flight nonterminal heartbeat write before `runGenerationJob` returns or throws so it cannot overwrite the terminal `needs_attention` update.

- [x] **Step 6: Run focused tests and verify GREEN**

Run: `npx vitest run tests/unit/generation-job.test.ts tests/unit/generation-auto-resume.test.ts tests/unit/generation-heartbeat.test.ts tests/unit/useGenerationStatus.test.tsx tests/component/HostGenError.test.tsx tests/component/HostSetupPickClient-auto-resume.test.tsx`

Expected: all tests pass.

### Task 2A: Fence a revived stale worker from its replacement attempt

**Architecture stop:** Focused re-review found that atomic resume admission alone
does not stop the prior worker from waking and writing after its replacement has
claimed the category. Treat the durable `attempt` as a fencing token for every
worker-side progress mutation and side-effect checkpoint.

**Files:**
- Modify: `lib/ai/generation-job.ts`
- Modify: `app/api/categories/[id]/generate/route.ts`
- Modify: `tests/unit/generation-job.test.ts`
- Modify: `tests/unit/api-generate-resume-claim-contract.test.ts`

- [x] **Step 1: Add failing fencing tests**

Assert the resume claim compares the exact observed heartbeat as well as the
attempt and raw phase. Assert a worker update conditioned on the old attempt
loses after a replacement claim and cannot mutate the new attempt.

- [x] **Step 2: Pass the claimed attempt into the worker**

Capture the row returned by initial begin or resume claim and pass its `attempt`
to `runGenerationJob`.

- [x] **Step 3: Fence progress writes and side-effect checkpoints**

Condition worker progress writes on category plus claimed attempt. Before
question inserts, image writes, category finalization, and terminal failure
handling, refresh/check the same fencing token. A superseded worker exits
quietly and does not broadcast a false failure.

- [x] **Step 4: Re-run focused recovery tests and re-review**

Expected: one recovery claimant, revived old-worker writes rejected, and no
regression to partial-question preservation or bounded automatic recovery.

### Task 2B: Bind the fencing token to every durable side effect

**Architecture stop:** A final adversarial review demonstrated a valid
lease-expiry ordering: the old worker can pass an application fence, block on a
separate database mutation for over 90 seconds, and then commit after a new
attempt claims the job. The ownership check and mutation must therefore share
one database transaction and one lock on the generation-job row.

**Files:**
- Create: `supabase/migrations/0029_generation_attempt_fencing.sql`
- Create: `tests/integration/generation-attempt-fencing.test.ts`
- Create: `lib/ai/generation-effects.ts`
- Modify: `app/api/categories/[id]/generate/route.ts`
- Modify: `lib/host/pickQuestions.ts`
- Modify: focused contract/unit tests as required

- [x] **Step 1: Write the database concurrency proof**

Prove that a side-effect transaction and replacement claim serialize on the
same job row: an effect holding the row lock completes before the claim, while
an effect reaching the lock after the claim receives `stale` and changes no
question/category/report row.

- [x] **Step 2: Add guarded service-role-only database functions**

Add transactional functions for certified batch persistence (including atomic
reroll cleanup), photo attachment, automatic pick, generation completion/report
persistence, and failure finalization. Each function locks the job row, compares
the attempt, and either applies the complete effect or returns `stale` without
mutating anything.

- [x] **Step 3: Route all worker writes through the guarded functions**

Replace application check-then-write pairs with the guarded functions. Treat a
`stale` result as a quiet superseded-worker exit. Keep Realtime best-effort and
durable database state authoritative.

- [x] **Step 4: Focused re-review of the exact lease-expiry ordering**

Review every worker mutation and prove there is no remaining durable write
outside a transaction that locks and validates the attempt.

### Task 3: Validate and release safely

**Files:**
- Review all files changed by Tasks 1-2.

**Interfaces:**
- Consumes: completed implementation and clean production baseline.
- Produces: reviewable PR with production evidence and no unrelated changes.

- [x] **Step 1: Run full static and runtime validation**

Run: `npx tsc --noEmit`, `npm test`, and `npm run build`.

Expected: no new failures; any documented baseline TypeScript noise is identified separately.

- [x] **Step 2: Run focused code review and verification agents**

Review category-fit fail-closed behavior, retry bounds, duplicate POST prevention, and preservation of certified rows.

- [x] **Step 3: Commit, push, and open a PR**

Commit only the scoped implementation, tests, and this plan. Push `fix/category-fit-certification` and open a PR targeting `main`.

- [ ] **Step 4: Request the exact production release gate**

Production remains unchanged until founder approval to merge. After approval, merge the PR, confirm the production deployment, and verify the category-generate route.

- [x] **Step 5: Repair Heather's existing mismatched saved question**

Completed before release with a read-before-write guarded production query: the
unplayed King-cobra candidate was removed from Heather's `non-Venomous snakes`
category while the remaining category and unopened Game 1 were preserved.
