# Live Answer Recovery Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Connect the authoritative play engine to player phones, Heather's laptop, and the venue TV with truthful answer delivery, visible/equal final timing, stale-state rejection, polished phone layouts, and an explicit host-only opt-in.

**Architecture:** Shared pure protocol modules gate revisions and derive display time from server deadlines. One room-level answer outbox survives question component changes, refreshes, lost acknowledgements, and network handoffs. Host commands retain stable IDs until canonical acknowledgement. Player, host, and TV surfaces render the same accepted play projection; none advances optimistically or decides a resolution reason locally.

**Tech Stack:** React 19, Next.js 16, TypeScript strict, browser storage, Supabase room broadcasts/snapshots, Vitest/Testing Library, Playwright/CDP, screenshot harnesses.

## Global Constraints

- Begin only after the security gate and authoritative engine plans pass.
- Existing `legacy` nights keep current timing; only `resilient_v1` nights use this flow.
- Player controls remain usable through the visible two-second final window and freeze exactly at its server deadline.
- `Locked in ✓` means a canonical server answer exists. Pending local state may never enter scoring or the locked screen.
- No network-mode selector, retry management, or per-player network dashboard is added for Heather.
- Heather's phone remains optional; her laptop retains the complete Original-mode control surface.
- The venue TV stays display-only.
- Keep the last canonical screen visible through interruption. Never replace live content with a generic blank/error page while recovery is possible.
- Retry correctness never depends on `navigator.onLine`; focus/online events may wake work but never grant authority or bypass retry ceilings.
- Do not deploy, enable Heather, or alter an opened night in this plan.

---

## File Map

**Create:**

- `lib/room/revisionGate.ts`
- `lib/game/playClock.ts`
- `lib/hooks/usePlayClock.ts`
- `lib/player/answerOutbox.ts`
- `lib/hooks/useAnswerOutbox.ts`
- `lib/host/hostCommandClient.ts`
- `components/player/AnswerDeliveryStatus.tsx`
- `components/system/BackInSyncNotice.tsx`
- `tests/unit/revision-gate.test.ts`
- `tests/unit/play-clock.test.ts`
- `tests/unit/usePlayClock.test.tsx`
- `tests/unit/answer-outbox.test.ts`
- `tests/unit/host-command-client.test.ts`
- `tests/e2e/helpers/network-profile.ts`
- `tests/e2e/live-answer-network-profiles.spec.ts`
- `tests/e2e/host-timing-opt-in.spec.ts`

**Modify:**

- `lib/hooks/useRoom.ts`
- `lib/hooks/useTVRoom.ts`
- `lib/room/roomSnapshotPayload.ts`
- `lib/host/roomToTVSnapshot.ts`
- `lib/hooks/useAnswerSubmit.ts` (retire from resilient call sites; keep only if legacy still needs it)
- `app/(player)/room/[code]/page.tsx`
- `components/player/PlayerQuestion.tsx`
- `components/player/PlayerLocked.tsx`
- `components/system/AnswerCard.tsx`
- `app/host/live/[nightId]/HostLiveConsoleClient.tsx`
- `components/host/HostLiveConsole.tsx`
- `app/host/HostHomeClient.tsx`
- `app/host/page.tsx`
- `components/host/HostWhatsNew.tsx`
- `app/tv/[code]/page.tsx`
- `components/tv/TVStateMachine.tsx`
- `components/tv/TVQuestion.tsx`
- `app/dev/player/page.tsx`
- `app/dev/player/preview/page.tsx`
- `app/dev/tv/page.tsx`
- `scripts/screenshot-player-state-matrix.mjs`
- `scripts/screenshot-tv-legibility.mjs`
- `tests/e2e/helpers/player-phone.ts`
- `tests/e2e/helpers/selectors.ts`
- `tests/e2e/reveal-sync.spec.ts`
- `tests/e2e/all-locked-auto-reveal.spec.ts`
- `tests/e2e/full-game.spec.ts`
- relevant component/unit tests named below.

## Required Client Contracts

`lib/player/answerOutbox.ts`:

```ts
export interface AnswerOutboxRecord {
  version: 1;
  runId: string;
  nightId: string;
  gameId: string;
  playId: string;
  slot: 1 | 2 | 3 | 4;
  submissionId: string;
  createdAtMs: number;
  attemptCount: number;
  nextAttemptAtMs: number | null;
}

export type PlayerSubmitView =
  | { kind: "idle" }
  | { kind: "sending" | "still_sending"; slot: 1 | 2 | 3 | 4; durable: boolean }
  | { kind: "confirmed"; answer: PlayerCanonicalAnswer }
  | { kind: "terminal_miss"; reason: "deadline_passed" | "identity_invalid" | "not_eligible" };
```

`lib/game/playClock.ts`:

```ts
export interface PlayClockView {
  phase: LivePlayState;
  mainSeconds: number;
  finalSeconds: number;
  answersOpen: boolean;
  deadlineCheckDue: boolean;
}
```

---

### Task 1: Build and test the pure protocol primitives

**Files:** Create revision gate, play clock, answer outbox, host command client, and their tests.

**Step 1: Write red revision tests**

Prove lower room revisions and old runs are ignored; inconsistent same-revision/play tuples force a snapshot; only the latest-started snapshot request may replace a run after reset.

**Step 2: Write red clock tests**

Prove accepting, all-in, final-window, resolved, and overdue states from authoritative ISO deadlines. At main zero the final window keeps controls open; at final deadline controls close. A delayed broadcast never restarts a timer.

**Step 3: Write red outbox tests**

Prove first choice wins, one record per play, 64-record cap, current-play priority, two-hour/old-run cleanup, storage-event two-tab convergence, memory fallback, 1.5-second request abort, full-jitter 250/500/1000/maximum-2000 backoff, eight-attempt ceiling, retry-later delay, and one reconciliation attempt for older records.

**Step 4: Write red command tests**

Prove a host retry reuses one command ID and exact preconditions; answer-only room revisions do not cancel it; changed control revision/play state returns stale; uncertain transport never advances local state.

**Step 5: Implement and verify**

Use injected clock/random/storage/fetch dependencies so tests are deterministic.

```bash
npx vitest run tests/unit/revision-gate.test.ts tests/unit/play-clock.test.ts tests/unit/usePlayClock.test.tsx tests/unit/answer-outbox.test.ts tests/unit/host-command-client.test.ts
git add lib/room/revisionGate.ts lib/game/playClock.ts lib/hooks/usePlayClock.ts lib/player/answerOutbox.ts lib/hooks/useAnswerOutbox.ts lib/host/hostCommandClient.ts tests/unit/revision-gate.test.ts tests/unit/play-clock.test.ts tests/unit/usePlayClock.test.tsx tests/unit/answer-outbox.test.ts tests/unit/host-command-client.test.ts
git commit -m "feat: add canonical live recovery primitives"
```

---

### Task 2: Converge room and TV state by run and revision

**Files:** Modify `useRoom`, `useTVRoom`, room payload, TV projection, and their tests.

**Step 1: Add the canonical live projection**

Carry `runId`, `roomRevision`, `controlRevision`, current `play`, and `serverNow` through player/host snapshots, TV snapshots, fallback payloads, and broadcasts.

**Step 2: Gate every mutation**

Apply `revisionGate` before state changes. Same-run lower revisions are ignored. A different run triggers one authoritative snapshot. Abort or sequence snapshot requests so a slower old request cannot restore Game 1, a prior play, or a pre-reset run.

**Step 3: Remove client-derived TV timing**

`roomToTVSnapshot` carries the accepted play projection. `TVStateMachine` no longer resolves or reconstructs a full timer from `played_at`; at a due deadline it calls only the public finalize route and waits for canonical state.

**Step 4: Verify and commit**

```bash
npx vitest run tests/unit/revision-gate.test.ts tests/unit/roomSnapshotPayload.test.ts tests/unit/tv-page-hooks.test.tsx tests/unit/room-to-tv-snapshot-house-lights.test.ts
git add -- lib/hooks/useRoom.ts lib/hooks/useTVRoom.ts lib/room/roomSnapshotPayload.ts lib/host/roomToTVSnapshot.ts 'app/tv/[code]/page.tsx' components/tv/TVStateMachine.tsx
git commit -m "fix: reject stale live room state"
```

---

### Task 3: Move resilient answer ownership above the question screen

**Files:** Modify the player room page and player components; create answer status/back-in-sync components; update player tests.

**Step 1: Mount one outbox in `RoomStateMachine`**

The outbox lives for the room session, not `QuestionView`. Delete optimistic `AnswerRow` creation/merge. A tap writes the outbox before sending. `QuestionView`, component rebuild, route recovery, and refresh cannot cancel the send.

**Step 2: Map canonical states truthfully**

- tap: selected card plus `Sending your answer...`;
- after 1.5 seconds without acknowledgement: `Still sending...`;
- storage unavailable: `Keep this screen open — answer still sending`;
- canonical answer: `Locked in ✓` and only then `PlayerLocked`/lock ceremony;
- deadline terminal: `That answer wasn't received in time. You're synced for the next question.`;
- recovered canonical state: brief `Back in sync`.

The player never has to tap Retry. Network handoff uses the same record and submission ID.

**Step 3: Render the final window**

`PlayerQuestion` accepts phase, selected slot, delivery state, and final seconds. Unanswered and pending players retain 44px-minimum answer controls during `Final answers — 2... 1...`; controls freeze at the authoritative end. A pending choice may continue reconciling after freeze but cannot create a new late answer.

**Step 4: Preserve legacy mode**

Legacy-latched nights use the existing path after the security gate. Retire `useAnswerSubmit` only after no legacy call site needs it; never interpret generic 409 as resilient confirmation.

**Step 5: Verify and commit**

```bash
npx vitest run tests/unit/answer-outbox.test.ts tests/unit/answer-submit.test.tsx tests/unit/useAnswerSubmit-confirmed.test.tsx tests/component/PlayerQuestion.test.tsx
git add -- 'app/(player)/room/[code]/page.tsx' lib/hooks/useAnswerSubmit.ts components/player/PlayerQuestion.tsx components/player/PlayerLocked.tsx components/player/AnswerDeliveryStatus.tsx components/system/AnswerCard.tsx components/system/BackInSyncNotice.tsx
git commit -m "feat: keep answers sending until confirmed"
```

---

### Task 4: Replace host-local timing with canonical commands

**Files:** Modify host live client/console and their tests.

**Step 1: Route all resilient controls through the command client**

Reveal, undo, Show answer now, end game, and reset carry stable command ID plus expected run/control/game/play/semantic state. Keep the last confirmed screen while a command travels. Show `Sending...`; never flip game state optimistically.

**Step 2: Remove host-owned all-in scheduling**

For resilient nights, remove `deriveAllLockedAutoRevealDecision` and `useAllLockedAutoReveal` ownership. Render server `all_in_hold` as `EVERYBODY'S IN` for its remaining canonical 1.2-second beat, then call the due-check route if needed. Retain current local behavior only for legacy nights.

**Step 3: Make Show answer truthful**

First press begins the same visible two-second final window. Button becomes `Final answers...`, stays disabled, cannot extend the window, and transitions to `Revealing...` only while finalization is in flight. End game with an unfinished play shows `Finish the current question first` and changes nothing.

**Step 4: Verify and commit**

```bash
npx vitest run tests/unit/host-command-client.test.ts tests/component/HostLiveConsole.test.tsx tests/unit/api-end-early-route.test.ts
git add -- 'app/host/live/[nightId]/HostLiveConsoleClient.tsx' components/host/HostLiveConsole.tsx
git commit -m "feat: make host live controls canonical"
```

---

### Task 5: Match the venue TV to the canonical room beat

**Files:** Modify TV state/question/dev gallery and TV tests.

**Step 1: Add exact TV phases**

Render `EVERYBODY'S IN`, `Final answers — 2... 1...`, and reveal from accepted play state. Hold the last confirmed screen on interruption. Ignore stale animation/events. Do not expose answer choices/correctness before resolution.

**Step 2: Preserve venue legibility**

At 1920x1080: question >=48px, choices >=28px, carousel names >=24px. At 1280x720: >=32px/20px/18px. Text contrast >=4.5:1. No browser-status overlay may cover game content.

**Step 3: Verify and commit**

```bash
npx vitest run tests/unit/tv-page-hooks.test.tsx tests/unit/room-to-tv-snapshot-house-lights.test.ts tests/unit/tv-snapshot-route-answer-gating.test.ts
git add components/tv/TVStateMachine.tsx components/tv/TVQuestion.tsx app/dev/tv/page.tsx
git commit -m "feat: synchronize venue final answer beat"
```

---

### Task 6: Add Heather's host-only preview and explicit opt-in

**Files:** Modify host page/home/What's New and tests; add opt-in E2E.

**Step 1: Pass persisted server preference**

The host home page reads release access and preferred engine from the server-only settings table. LocalStorage may remember modal dismissal only; it cannot enable timing.

**Step 2: Use the approved copy and actions**

Default copy:

> **A smoother live game**
>
> TR1VIA now carries answers safely through brief connection changes, waits two final seconds before every reveal, and moves early when everybody is in. Your controls stay the same—nothing new to manage. If anything ever looks wrong during a live game, contact Brandon.

Preserve the already-shipped host-only benefits about certified questions, resumable generation, and venue readability below this new timing section; this refinement must not erase the prior Original-mode explanation.

Actions are exactly `Preview the 2-second finish`, `Use smoother timing`, and `Keep current timing`. Preview is a beautiful non-mutating rehearsal. Only server-confirmed preference changes the future-night engine. Choice is reversible between nights and cannot change an opened night. Players never receive or see this notice.

**Step 3: Verify and commit**

```bash
npx vitest run tests/unit/HostHomeClient-whats-new.test.tsx
npx playwright test tests/e2e/host-timing-opt-in.spec.ts
git add app/host/page.tsx app/host/HostHomeClient.tsx components/host/HostWhatsNew.tsx tests/unit/HostHomeClient-whats-new.test.tsx tests/e2e/host-timing-opt-in.spec.ts
git commit -m "feat: let hosts rehearse smoother timing"
```

---

### Task 7: Prove every phone and venue display size visually

**Files:** Modify player/TV dev galleries and screenshot scripts.

**Step 1: Add player preview states**

Include pending, still-sending, storage-fallback, unanswered final-window, confirmed final-window, all-in, terminal miss, and back-in-sync.

**Step 2: Expand the phone matrix**

Capture portrait at 320x568, 360x640, 375x667, 390x844, 412x915, and 430x932; landscape at 667x375 and 844x390. Assert no horizontal overflow, clipping, or unsafe-area collision and every answer target >=44x44 CSS pixels.

**Step 3: Expand host/TV proof**

Capture 1280x720 and 1920x1080 at 100% zoom, including all-in/final window, long question, long choices, and long carousel names. Assert typography floors, contrast, clipping, and overlay clearance.

**Step 4: Run and commit**

```bash
node scripts/screenshot-player-state-matrix.mjs
node scripts/screenshot-tv-legibility.mjs
git add app/dev/player/page.tsx app/dev/player/preview/page.tsx app/dev/tv/page.tsx scripts/screenshot-player-state-matrix.mjs scripts/screenshot-tv-legibility.mjs
git commit -m "test: prove live recovery layouts at real sizes"
```

---

### Task 8: Prove deterministic network behavior end to end

**Files:** Create network helper/spec; modify player helper/selectors and existing E2E.

**Step 1: Build deterministic impairments**

The helper supports seeded request/response loss, fixed delay, dropped post-commit response via `route.fetch()` then abort, offline windows, attempt counters, and CDP throughput throttling.

**Step 2: Implement all seven profiles**

- Healthy <=100ms RTT: answer acknowledgement p95 <=1s; host commit to healthy subscribed surfaces p95 <=250ms.
- Weak Wi-Fi 400ms RTT, 10% seeded loss, 2Mbps: zero loss/duplicates across 100 seeded runs where one attempt reaches server; confirmation p95 <=4s.
- Lost acknowledgement: one row/score, retry returns first canonical answer.
- 1.5s network handoff after tap: confirmation <=2.5s after restoration without another tap.
- No path through deadline: no invented/scored answer; proven-miss state.
- Revision N delayed after N+1: all surfaces stay at N+1.
- Forty-player reconnect surge, 25% first-response drop: exactly forty answers, <=320 POST attempts/10s, response p95 <=2s, convergence <=6.5s.

**Step 3: Update behavioral E2E**

Split player helpers into click, await-sending, and await-confirmed. Rewrite all-locked late-join expectation: eligibility is frozen, so a join during the beat cannot cancel all-in. Extend full-game through Game 1, intermission, Game 2, undo/replay, and reset/run rotation. Update reveal sync for canonical timing.

**Step 4: Run and commit**

```bash
npx playwright test tests/e2e/live-answer-network-profiles.spec.ts tests/e2e/reveal-sync.spec.ts tests/e2e/all-locked-auto-reveal.spec.ts tests/e2e/full-game.spec.ts
git add tests/e2e/helpers/network-profile.ts tests/e2e/helpers/player-phone.ts tests/e2e/helpers/selectors.ts tests/e2e/live-answer-network-profiles.spec.ts tests/e2e/reveal-sync.spec.ts tests/e2e/all-locked-auto-reveal.spec.ts tests/e2e/full-game.spec.ts
git commit -m "test: prove mixed-network live answers"
```

---

### Task 9: Final verification and release stop gate

```bash
npm test
npm run test:db-races
npx tsc --noEmit
npm run build
npm run test:e2e
node scripts/screenshot-player-state-matrix.mjs
node scripts/screenshot-tv-legibility.mjs
git diff --check
```

Run critic, security reviewer, and validator. Then perform—but do not automate or schedule during a live show—the founder-host smoke with at least three real phones on mixed connections and a mirrored display. It must prove normal final window, all-in, lost acknowledgement, handoff, undo/replay, Game 1 to Game 2, safe payloads, and no stale state.

Stop before production flag changes, Heather opt-in, merge, or deployment. Those are explicit founder release gates.
