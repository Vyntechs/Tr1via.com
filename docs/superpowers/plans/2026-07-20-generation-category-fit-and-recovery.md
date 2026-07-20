# Generation Category Fit and Automatic Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent off-category questions from reaching Heather and automatically finish resumable partial generation jobs without making her repeatedly press Continue.

**Architecture:** Extend the existing independent verifier with the requested topic and a fail-closed `fitsRequestedTopic` verdict, then reject/refill mismatches through the existing collection loop. Extend durable generation progress with the server attempt number and let the host setup client automatically resume a bounded number of `needs_attention` jobs while preserving the current manual fallback. Make the generate route use the same derived stale-job decision as the client so both sides agree when a job is resumable.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Anthropic SDK, Supabase, Vitest, Testing Library.

**Execution status (2026-07-20):** Tasks 1, 2, and 2A are implemented,
independently reviewed, and verified. Heather's existing unopened Game 1 was
also corrected with guarded production data edits. PR and production release
remain the only gates.

## Global Constraints

- Heather's setup sequence and controls remain unchanged when generation succeeds.
- Existing certified questions remain durable and are never regenerated on resume.
- Automatic recovery is bounded to three total server attempts, including jobs that saved zero choices; after that, the existing Continue/manual-entry recovery remains available.
- Category fit must honor qualifiers and exclusions such as `non-`, `only`, geography, era, age group, and stated omissions.
- Original-mode questions must remain answerable without an image.
- No database migration is required.

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

- [ ] **Step 1: Write failing verifier contract tests**

Add a test that calls `verifyAnswers` with `topic: "Non-venomous snakes"`, then asserts every verifier payload contains that topic and the tool schema requires `fitsRequestedTopic`.

- [ ] **Step 2: Write the failing final-gate regression**

Add `rejects a venomous species question from the Non-venomous snakes category even when its answer is correct` to `tests/unit/collect-verified-questions.test.ts`. Supply an otherwise-clean verdict with `fitsRequestedTopic: false`; expect no accepted question and a `category_mismatch` rejection.

- [ ] **Step 3: Run tests and verify RED**

Run: `npx vitest run tests/unit/verify-answers.test.ts tests/unit/collect-verified-questions.test.ts`

Expected: FAIL because the verdict/tool contract has no topic-fit field and the collection gate accepts the mismatched question.

- [ ] **Step 4: Implement the minimal verifier and gate changes**

Require `topic` in `VerifyAnswersOptions`, include `requestedTopic` in each chunk payload, instruct the verifier to fail category membership when qualifiers or exclusions are violated, require `fitsRequestedTopic` in the tool schema, fail closed while parsing, and reject false values as `category_mismatch`. Pass `opts.topic` from the generation route.

- [ ] **Step 5: Run focused tests and verify GREEN**

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

- [ ] **Step 1: Write failing progress and policy tests**

Assert that progress exposes the durable attempt number and that auto-resume is allowed only for `needs_attention`, a positive remaining count, and attempts below three. Cover both zero saved choices after a provider timeout and 19 saved choices with one remaining. Assert attempt three remains a manual recovery screen.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run tests/unit/generation-job.test.ts tests/unit/generation-auto-resume.test.ts tests/unit/generation-heartbeat.test.ts tests/component/HostSetupPickClient-auto-resume.test.tsx`

Expected: FAIL because progress does not expose `attempt`, no bounded policy exists, heartbeat writes are not drainable, and the host client does not resume automatically.

- [ ] **Step 3: Implement the pure bounded policy**

Add `attempt` to `generationProgressFromRow` and implement `shouldAutoResumeGeneration` with a three-attempt ceiling. Add a single-flight durable-heartbeat gate whose `drain()` waits for the current write before terminal job state can be recorded.

- [ ] **Step 4: Wire the host client to resume once per durable attempt**

When polling returns an eligible `needs-attention` result, keep the calm loading view mounted, show the certified count and shortfall, and call the existing resume POST once for that durable attempt. Retain `HostGenError` after the ceiling or an unrecoverable response. A 409 must never be treated as a successful restart or hide the Continue control.

- [ ] **Step 5: Align the API's stale-job decision**

Use `generationProgressFromRow(existingJob).phase` when deciding whether a `generating` category is resumable so a dead worker cannot be rejected as merely “already generating” after the client has correctly identified it as stale. Drain any in-flight nonterminal heartbeat write before `runGenerationJob` returns or throws so it cannot overwrite the terminal `needs_attention` update.

- [ ] **Step 6: Run focused tests and verify GREEN**

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

- [ ] **Step 1: Add failing fencing tests**

Assert the resume claim compares the exact observed heartbeat as well as the
attempt and raw phase. Assert a worker update conditioned on the old attempt
loses after a replacement claim and cannot mutate the new attempt.

- [ ] **Step 2: Pass the claimed attempt into the worker**

Capture the row returned by initial begin or resume claim and pass its `attempt`
to `runGenerationJob`.

- [ ] **Step 3: Fence progress writes and side-effect checkpoints**

Condition worker progress writes on category plus claimed attempt. Before
question inserts, image writes, category finalization, and terminal failure
handling, refresh/check the same fencing token. A superseded worker exits
quietly and does not broadcast a false failure.

- [ ] **Step 4: Re-run focused recovery tests and re-review**

Expected: one recovery claimant, revived old-worker writes rejected, and no
regression to partial-question preservation or bounded automatic recovery.

### Task 3: Validate and release safely

**Files:**
- Review all files changed by Tasks 1-2.

**Interfaces:**
- Consumes: completed implementation and clean production baseline.
- Produces: reviewable PR with production evidence and no unrelated changes.

- [ ] **Step 1: Run full static and runtime validation**

Run: `npx tsc --noEmit`, `npm test`, and `npm run build`.

Expected: no new failures; any documented baseline TypeScript noise is identified separately.

- [ ] **Step 2: Run focused code review and verification agents**

Review category-fit fail-closed behavior, retry bounds, duplicate POST prevention, and preservation of certified rows.

- [ ] **Step 3: Commit, push, and open a PR**

Commit only the scoped implementation, tests, and this plan. Push `fix/category-fit-certification` and open a PR targeting `main`.

- [ ] **Step 4: Request the exact production release gate**

Production remains unchanged until founder approval to merge. After approval, merge the PR, confirm the production deployment, and verify the category-generate route.

- [ ] **Step 5: Repair Heather's existing mismatched saved question**

After the release is live, use a read-before-write production query to locate the King-cobra question in Heather's `non-Venomous snakes` category and remove only that candidate if it has not been played. Preserve the rest of the category, then have the released resume path refill and certify the replacement.
