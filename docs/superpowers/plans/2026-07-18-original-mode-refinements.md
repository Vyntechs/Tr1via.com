# Original Mode Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Original mode self-checking, recoverable, phone-polished, venue-legible, and transparently explained to authenticated hosts without changing Heather's operating flow.

**Architecture:** Add a versioned host-dashboard notice, strengthen the existing generate→verify→refill gate, persist generation job progress in Supabase, make phone shells scroll only when content needs it, and simplify TV question/reveal hierarchy. Existing APIs and state machines remain authoritative; new state is additive and fail-closed.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Supabase Postgres/RLS, Anthropic structured tool output, Vitest, Testing Library, Playwright.

## Global Constraints

- Original mode remains the default and the host workflow stays recognizable.
- Host phone use remains optional.
- Original questions must be answerable without images.
- Host-only release messaging must never render on player, TV, marketing, login, or join routes.
- Support copy must say that AI is not perfect and instruct the host to contact Brandon only after Retry does not resolve the issue.
- Supported phone widths are 280, 320, 360, 390, 430, and 480 CSS pixels in portrait, with landscape remaining usable.
- Production merge, migration application, and deployment require Brandon's approval.

---

### Task 1: Host-only What's New

**Files:**
- Create: `components/host/HostWhatsNew.tsx`
- Modify: `components/host/index.ts`
- Modify: `app/host/HostHomeClient.tsx`
- Test: `tests/component/HostWhatsNew.test.tsx`
- Test: `tests/unit/HostHomeClient-whats-new.test.tsx`

**Interfaces:**
- Consumes: authenticated `/host` rendering and `HostHomeClient.isFirstNightComplete`.
- Produces: `HostWhatsNew({ open, onClose })` and version key `tr1via-host-whats-new-original-v1`.

- [x] **Step 1: Write the failing component test**

```tsx
render(<HostWhatsNew open onClose={onClose} />);
expect(screen.getByRole("dialog", { name: /your games now protect themselves/i })).toBeVisible();
expect(screen.getByText(/no fact-check is perfect/i)).toBeVisible();
expect(screen.getByText(/contact Brandon/i)).toBeVisible();
fireEvent.click(screen.getByRole("button", { name: /got it/i }));
expect(onClose).toHaveBeenCalledOnce();
```

- [x] **Step 2: Run the test and confirm RED**

Run: `npx vitest run tests/component/HostWhatsNew.test.tsx`

Expected: FAIL because `HostWhatsNew` does not exist.

- [x] **Step 3: Implement the notice**

Create a modal/card with a restrained “certified question ticket” signature: a vertical stamped rule with `CHECKED`, `RECOVERABLE`, and `CLEARER AT THE VENUE`. Use existing theme tokens and typography; no new dependency. Render the approved support copy exactly and expose `Got it` plus a close control.

- [x] **Step 4: Write the failing host-home visibility and persistence tests**

```tsx
localStorage.clear();
renderThemed(<HostHomeClient {...baseProps} />);
expect(screen.getByRole("dialog")).toBeVisible();
fireEvent.click(screen.getByRole("button", { name: /got it/i }));
expect(localStorage.getItem("tr1via-host-whats-new-original-v1")).toBe("dismissed");
expect(screen.queryByRole("dialog")).toBeNull();
fireEvent.click(screen.getByRole("button", { name: /what's new/i }));
expect(screen.getByRole("dialog")).toBeVisible();
```

- [x] **Step 5: Run the host-home test and confirm RED**

Run: `npx vitest run tests/unit/HostHomeClient-whats-new.test.tsx`

Expected: FAIL because the dashboard has no versioned notice state or reopen control.

- [x] **Step 6: Wire the host-only notice and make both tests GREEN**

Initialize notice visibility in an effect after mount, write the versioned dismissal to local storage, and render a quiet fixed dashboard button labelled `What's new`. Do not add the component to layouts shared by player or TV routes.

- [x] **Step 7: Verify the slice**

Run: `npx vitest run tests/component/HostWhatsNew.test.tsx tests/unit/HostHomeClient-whats-new.test.tsx tests/unit/HostHomeClient-founder-build.test.tsx`

Expected: all tests pass.

---

### Task 2: Trusted content gate

**Files:**
- Modify: `lib/ai/verify-answers.ts`
- Modify: `lib/ai/collect-verified-questions.ts`
- Modify: `lib/ai/question-risk-flags.ts`
- Modify: `lib/ai/prompts.ts`
- Test: `tests/unit/verify-answers.test.ts`
- Test: `tests/unit/collect-verified-questions.test.ts`
- Test: `tests/unit/question-risk-flags.test.ts`
- Test: `tests/unit/ai-prompts.test.ts`

**Interfaces:**
- Consumes: `GeneratedQuestion.prompt`, `options`, `correctIndex`, `factBlurb`, and `photoQuery`.
- Produces: `AnswerVerdict` fields `markedAnswerIsCorrect`, `ambiguous`, `factBlurbIsCorrect`, and `answerableWithoutImage`.

- [x] **Step 1: Write failing verifier tests**

Add assertions that the verifier payload includes `factBlurb`, the tool requires both new boolean fields, and returned verdicts preserve them.

- [x] **Step 2: Run the verifier tests and confirm RED**

Run: `npx vitest run tests/unit/verify-answers.test.ts`

Expected: FAIL because the new fields are absent.

- [x] **Step 3: Extend the verifier contract**

Pass the fact/tip and photo-independent requirement to the verifier. Accept a candidate only when all four truth conditions are satisfied. Partial/malformed output remains fail-closed.

- [x] **Step 4: Write failing collector and risk tests**

Add rejection reasons `fact_blurb_wrong`, `image_required`, and `deterministic_risk`. Prove a clean candidate passes; each new failure condition is rejected; and prompts such as “What does this sign mean?” receive an `image_required` risk flag.

- [x] **Step 5: Run the collector/risk tests and confirm RED**

Run: `npx vitest run tests/unit/collect-verified-questions.test.ts tests/unit/question-risk-flags.test.ts`

Expected: FAIL on the missing rejection reasons and visual-dependency rule.

- [x] **Step 6: Implement the fail-closed gate**

Add `image_required` to `QuestionRiskFlag`. Feed deterministic flags into collection through `validateCandidate`; reject subjective, time-sensitive, ranking, geography, multiple-answer, or image-required candidates unless the prompt contains explicit stabilizing context. Update generation prompts to prohibit image-dependent questions and require the fact/tip to be independently supportable.

- [x] **Step 7: Verify the slice**

Run: `npx vitest run tests/unit/verify-answers.test.ts tests/unit/collect-verified-questions.test.ts tests/unit/question-risk-flags.test.ts tests/unit/ai-prompts.test.ts`

Expected: all tests pass.

---

### Task 3: Persisted generation jobs and partial recovery

**Files:**
- Create: `supabase/migrations/0019_question_generation_jobs.sql`
- Regenerate: `lib/supabase/types.ts`
- Create: `lib/ai/generation-job.ts`
- Modify: `lib/ai/collect-verified-questions.ts`
- Modify: `app/api/categories/[id]/generate/route.ts`
- Modify: `lib/hooks/useGenerationStatus.ts`
- Modify: `components/host/gen/HostGenLoading.tsx`
- Modify: `components/host/gen/HostGenError.tsx`
- Test: `tests/integration/question-generation-jobs-schema.test.ts`
- Test: `tests/unit/generation-job.test.ts`
- Test: `tests/unit/useGenerationStatus.test.tsx`
- Test: `tests/component/HostGenLoading.test.tsx`

**Interfaces:**
- Produces: `GenerationJobPhase = "queued" | "writing" | "checking" | "repairing" | "images" | "ready" | "needs_attention"`.
- Produces: `GenerationJobProgress { phase, targetCount, writtenCount, certifiedCount, imageCount, remainingCount, message, updatedAt }`.
- Consumes: existing category ownership and generation route authentication.

- [x] **Step 1: Write the failing schema test**

Prove the migration creates `question_generation_jobs`, enforces one current job per category, defaults counts to zero, enables RLS, grants owning hosts read access, and denies anonymous table access.

- [x] **Step 2: Run the schema test and confirm RED**

Run: `npx vitest run tests/integration/question-generation-jobs-schema.test.ts`

Expected: FAIL because migration 0017 and the table do not exist.

- [x] **Step 3: Add the additive schema and prepare type regeneration**

The table stores UUID id, category/game/night/host ids, phase, target/written/certified/image counts, attempt, last_error, heartbeat_at, created_at, and updated_at. Use foreign keys with `on delete cascade`, count checks, phase check, and an owning-host SELECT policy. Only service role writes. Migration 0019 follows the existing 0018 migration.

Local Docker is unavailable in this worktree, so do not overwrite the tracked generated file. Use a narrow typed repository for migration 0019 during the PR. After the migration exists in an approved Supabase environment, generate to a temporary file, validate it, then replace `lib/supabase/types.ts` via `npm run typegen` or the Supabase MCP type generator.

- [x] **Step 4: Write failing pure progress tests**

Prove job rows map to exact human status lines, stale nonterminal heartbeats map to `needs_attention`, ready never appears below the target, and image count never controls question certification.

- [x] **Step 5: Run pure progress tests and confirm RED**

Run: `npx vitest run tests/unit/generation-job.test.ts`

Expected: FAIL because `lib/ai/generation-job.ts` does not exist.

- [x] **Step 6: Implement job mapping and route persistence**

Create/upsert a job before `after()`. Update heartbeat and phase at each real transition. Extend the collector with `initialClean` and `onAccepted` so each verified round is inserted immediately with stable positions while the category stays `generating`. On retry, load existing generated questions, request only `20 - existingCount`, and never delete certified rows. Mark `needs_attention` with a safe message on failure; mark `ready` only when the target is reached. Attach photos after certification and update `image_count` independently.

- [x] **Step 7: Write and run failing hook/component tests**

Prove the hook prefers persisted job progress, restores exact counts after remount, surfaces stale jobs as Needs attention, and the loading component renders real phase/count copy without a percentage or ETA.

Run: `npx vitest run tests/unit/useGenerationStatus.test.tsx tests/component/HostGenLoading.test.tsx`

Expected: FAIL on missing job progress behavior.

- [x] **Step 8: Wire the hook and loading/error surfaces**

Poll the owning host's latest job alongside category/questions. Render `Queued`, `Writing`, `Checking`, `Repairing`, `Adding optional images`, `Ready`, or `Needs attention` with exact counts. Preserve existing Back to setup, Retry, and Enter manually actions.

- [x] **Step 9: Verify the slice**

Run: `npx vitest run tests/integration/question-generation-jobs-schema.test.ts tests/unit/generation-job.test.ts tests/unit/useGenerationStatus.test.tsx tests/component/HostGenLoading.test.tsx tests/unit/category-generate-report-summary.test.ts tests/unit/collect-verified-questions.test.ts`

Expected: all tests pass.

---

### Task 4: Phone-state adaptive layout and Game 2 recovery proof

**Files:**
- Modify: `components/shells/PhoneScreen.tsx`
- Modify: `components/player/PlayerLocked.tsx`
- Modify: `components/player/PlayerBetweenGames.tsx`
- Modify: `components/player/PlayerJoinGame2.tsx`
- Modify: `components/player/PlayerRevealCorrect.tsx`
- Test: `tests/component/PhoneScreen.test.tsx`
- Test: `tests/unit/player-locked-standings.test.tsx`
- Test: `tests/unit/player-between-games.test.tsx`
- Modify: `tests/e2e/full-game.spec.ts`
- Create: `scripts/screenshot-player-state-matrix.mjs`

**Interfaces:**
- Produces: `PhoneScreen.scroll?: "auto" | "locked"`, defaulting to `auto` for dense states.
- Consumes: the existing server-authoritative between-games selector and `clearEndedGameQuestions` guard.

- [x] **Step 1: Write failing shell tests**

Assert default phone screens use vertical auto overflow, hide horizontal overflow, honor safe-area padding, and `scroll="locked"` retains fit-to-viewport behavior for the live question screen.

- [x] **Step 2: Run shell tests and confirm RED**

Run: `npx vitest run tests/component/PhoneScreen.test.tsx`

Expected: FAIL because PhoneScreen always uses `overflow: hidden` and has no scroll mode.

- [x] **Step 3: Implement adaptive shell behavior**

Add the scroll prop, safe-area bottom padding, `overscrollBehavior`, and `WebkitOverflowScrolling`. Pass `scroll="locked"` from PlayerQuestion. Let locked, standings, intermission, and recap states scroll on short screens.

- [x] **Step 4: Write failing Game 2 copy/recovery tests**

Assert opted-in waiting copy says `Round 2 is starting` and `Waiting for Heather to choose the first question.` Extend the E2E flow to reload an opted-in phone before the first Game 2 question and prove the waiting screen returns without the previous reveal.

- [x] **Step 5: Run the focused tests and confirm RED**

Run: `npx vitest run tests/unit/player-between-games.test.tsx tests/unit/betweenGames.test.ts`

Expected: the new exact copy assertion fails before implementation.

- [x] **Step 6: Implement copy and matrix harness**

Update only the waiting copy. Add a screenshot script that visits every `/dev/player` state at 280, 320, 360, 390, 430, and 480 widths plus representative landscape sizes, and throws on horizontal overflow, clipped focused controls, or body/screen height disagreement.

- [x] **Step 7: Verify the slice**

Run: `npx vitest run tests/component/PhoneScreen.test.tsx tests/unit/player-locked-standings.test.tsx tests/unit/player-between-games.test.tsx tests/unit/betweenGames.test.ts`

Run: `node scripts/screenshot-player-state-matrix.mjs`

Expected: tests pass and the script emits a complete state matrix with no overflow failures.

---

### Task 5: Venue-TV legibility

**Files:**
- Modify: `components/tv/TVQuestion.tsx`
- Modify: `components/tv/TVReveal.tsx`
- Modify: `components/tv/index.ts`
- Remove: live use of `components/tv/TVScoreboardMarquee.tsx` without deleting the component in this PR
- Modify: `tests/component/TVQuestion-marquee-swap.test.tsx`
- Create: `tests/component/TVReveal-legibility.test.tsx`
- Create: `scripts/screenshot-tv-legibility.mjs`

**Interfaces:**
- Consumes: existing `tiles`, `playersTotal`, `scoreChips`, question, options, reveal answer, fact, and fastest-five data.
- Produces: one stationary question lock indicator and a high-contrast reveal hierarchy.

- [x] **Step 1: Write failing TV question tests**

Assert `TVQuestion` never renders `tv-scoreboard-marquee`, renders `N OF M LOCKED IN`, and answer text uses the venue-legibility style token.

- [x] **Step 2: Run the question test and confirm RED**

Run: `npx vitest run tests/component/TVQuestion-marquee-swap.test.tsx`

Expected: FAIL because May currently renders the moving marquee.

- [x] **Step 3: Implement the stationary question hierarchy**

Remove the marquee branch. Keep a stationary lock count/progress bar for every theme, preserve House Lights ceremony data, and raise answer text to a viewport-height-aware `clamp(32px, 4vmin, 44px)` venue token. Keep question auto-fit between 48 and 72px.

- [x] **Step 4: Write failing reveal legibility tests**

Assert the reveal root uses the dark reading surface, the correct color is an accent rather than the full background, the fact uses at least 30px, and fastest-player names use at least 28px.

- [x] **Step 5: Run the reveal test and confirm RED**

Run: `npx vitest run tests/component/TVReveal-legibility.test.tsx`

Expected: FAIL because the current reveal uses the full correct color and 22px fact/name text.

- [x] **Step 6: Implement the reveal hierarchy**

Use theme paper/ink for the reading surface, a controlled correct-color rail/card, a height-aware responsive answer treatment, 30–38px fact, 28–34px names, and sufficient contrast in both light and dark themes. Keep the fastest-five list stationary.

- [x] **Step 7: Verify the slice**

Run: `npx vitest run tests/component/TVQuestion-marquee-swap.test.tsx tests/component/TVQuestionHouseLights.test.tsx tests/component/TVReveal-legibility.test.tsx tests/component/TVScoreboardMarquee.test.tsx`

Run: `node scripts/screenshot-tv-legibility.mjs`

Expected: tests pass and screenshots at 1280×720 and 1920×1080 show no clipping.

---

### Task 6: Full regression and protected PR

**Files:**
- Modify only failures caused by Tasks 1–5 within their owned paths.
- Update: `tasks/lessons.md` only for newly observed non-obvious correction patterns.

**Interfaces:**
- Consumes: every prior task's verified slice.
- Produces: a reviewable branch and PR; no merge or deploy.

- [ ] **Step 1: Run static and unit verification**

Run: `npm test`

Run: `npx tsc --noEmit`

Run: `npm run build`

Expected: tests/build pass; the two documented pre-existing HostHome fixture type errors may remain only if unchanged from `origin/main`.

- [ ] **Step 2: Run end-to-end verification**

Run: `npm run test:e2e -- tests/e2e/full-game.spec.ts tests/e2e/reveal-sync.spec.ts tests/e2e/connection-degraded.spec.ts tests/e2e/connection-unreachable.spec.ts`

Expected: Game 1, intermission refresh, Game 2, reveal sync, and connection recovery pass.

- [ ] **Step 3: Review the diff and safety boundary**

Confirm the diff contains no secrets, production environment changes, player-facing What's New component, new game mode, host-phone requirement, destructive SQL, generated-file hand edits, or unrelated refactor.

- [ ] **Step 4: Commit and push the branch**

Create focused commits for host notice, content/generation reliability, phone recovery, and TV legibility. Push `codex/original-mode-refinements` and open a ready-for-review PR against `main`.

- [ ] **Step 5: Stop at Brandon's merge gate**

Report the PR, visual proof, tests, additive migration, rollback path, and exact post-merge production verification. Do not merge, deploy, or apply the migration.

Verified by: every task names its failing test, passing test, and final observable proof.
