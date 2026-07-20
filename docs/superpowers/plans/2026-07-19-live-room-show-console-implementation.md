# Live-Room Show Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Heather's Classic host phone into a complete, familiar live-show command center while keeping the laptop complete, every audience surface synchronized, and delivery status truthful.

**Architecture:** Derive one pure host stage from the existing canonical room snapshot, render device-specific controls from that stage, and keep game authority in the existing resilient answer engine. Add a write-only, audience-safe observation channel solely for Show Pulse delivery receipts; observations never advance, score, resolve, or identify players in a public payload.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4/theme tokens, Supabase Postgres/Auth/Realtime, Vitest, Testing Library, Playwright.

## Global Constraints

- Classic question order, scoring, board, and laptop controls remain available and familiar.
- The phone supports 320–440 CSS-pixel portrait viewports, landscape phones, and iPad landscape without clipped or buried live controls.
- The venue TV remains legible at 1280×720 and 1920×1080; no moving player-name ticker appears during a question.
- A delivery observation is informational only. It cannot advance the room, change a score, resolve a question, or claim a sleeping/disconnected browser is current.
- Host payloads may show only aggregate player delivery counts. Player/device identifiers and answer choices never enter a public delivery payload.
- Weak-network recovery never replaces the command surface with a blocking spinner.
- Motion and haptics are enhancements. The same labels and state transitions work with reduced motion and no haptics.
- Fair-play review is excluded from this build until a separate privacy and false-positive design is approved.
- No new game mode, CRM, sponsor inventory, player account requirement, app download, or voice control.
- Deploy, merge, migrations, and production release remain founder-authorized gates.

---

## File Map

**New pure contracts**

- `lib/host/showConsole.ts` — maps canonical room/TV state into the host's stage and primary action.
- `lib/host/showDelivery.ts` — classifies current/recovering TV and aggregate phone observations.
- `lib/hooks/useShowDelivery.ts` — reports the current surface revision and polls the host-only aggregate receipt.

**New host presentation**

- `components/host/HostCommandCenter.tsx` — responsive shell and persistent Board/Room/Scores/Monitor navigation.
- `components/host/HostRoomTruth.tsx` — compact always-visible room truth and Show Pulse receipt.
- `components/host/HostShowReady.tsx` — five-check preflight and room sync test.
- `components/host/HostPhoneBoard.tsx` — familiar 3×7 board and private preview.
- `components/host/HostAnswerResult.tsx` — result, distribution, fastest five, and return-to-board action.
- `components/host/HostBetweenGames.tsx` — explicit intermission and finale controls.
- `components/host/HostVenueMonitor.tsx` — current venue-TV preview with stage-specific controls.

**New delivery endpoints and storage**

- `supabase/migrations/0028_surface_observations.sql` — private, short-lived observation rows and cleanup index.
- `app/api/room/[code]/observe/route.ts` — signed player observation write.
- `app/api/tv/[code]/observe/route.ts` — TV observation write, informational and rate-limited.
- `app/api/host/rooms/[code]/delivery/route.ts` — owner-only aggregate receipt.

**Existing orchestration to modify**

- `app/host/phone/[nightId]/HostPhoneClient.tsx`
- `components/host/index.ts`
- `components/host/HostLiveConsole.tsx`
- `components/tv/TVStateMachine.tsx`
- `app/(player)/room/[code]/page.tsx`
- `app/tv/[code]/page.tsx`
- `lib/hooks/useRoom.ts`
- `lib/hooks/useTVRoom.ts`
- `lib/room/roomSnapshotPayload.ts`

---

### Task 1: Canonical Host Stage Contract

**Files:**
- Create: `lib/host/showConsole.ts`
- Test: `tests/unit/show-console.test.ts`

**Interfaces:**
- Consumes: `RoomSnapshot`, `TVSnapshot`, and existing `deriveHostMode()` semantics.
- Produces: `HostStage`, `HostPrimaryAction`, `deriveHostStage(input)`.

- [ ] **Step 1: Write the failing stage tests**

```ts
import { describe, expect, it } from "vitest";
import { deriveHostStage } from "@/lib/host/showConsole";

describe("deriveHostStage", () => {
  it("uses show-ready before game 1 starts", () => {
    expect(deriveHostStage({ game1: "ready", game2: "ready", livePlay: null, lastResolve: null, nightClosed: false })).toEqual({ stage: "show-ready", primary: "start-game-1" });
  });

  it("never reuses the prior reveal between games", () => {
    expect(deriveHostStage({ game1: "done", game2: "ready", livePlay: null, lastResolve: "q21", nightClosed: false })).toEqual({ stage: "intermission", primary: "start-game-2" });
  });

  it("returns answer-result only inside the current live game", () => {
    expect(deriveHostStage({ game1: "live", game2: "ready", livePlay: null, lastResolve: "q7", nightClosed: false })).toEqual({ stage: "answer-result", primary: "return-to-board" });
  });
});
```

- [ ] **Step 2: Run the test and confirm the contract is missing**

Run: `npx vitest run tests/unit/show-console.test.ts`

Expected: FAIL because `@/lib/host/showConsole` does not exist.

- [ ] **Step 3: Implement the pure stage model**

```ts
export type HostStage = "show-ready" | "board" | "private-preview" | "question-live" | "answer-result" | "intermission" | "finale";
export type HostPrimaryAction = "start-game-1" | "reveal-to-room" | "end-early" | "return-to-board" | "start-game-2" | "present-winners" | "close-room" | null;

export interface HostStageInput {
  game1: "draft" | "ready" | "live" | "done" | null;
  game2: "draft" | "ready" | "live" | "done" | null;
  livePlay: string | null;
  lastResolve: string | null;
  nightClosed: boolean;
  stagedQuestion?: string | null;
  winnersPresented?: boolean;
}

export function deriveHostStage(input: HostStageInput): { stage: HostStage; primary: HostPrimaryAction } {
  if (input.nightClosed || input.game2 === "done") return { stage: "finale", primary: input.winnersPresented ? "close-room" : "present-winners" };
  if (input.game1 === "done" && input.game2 !== "live" && input.game2 !== "done") return { stage: "intermission", primary: "start-game-2" };
  if (input.game1 !== "live" && input.game2 !== "live") return { stage: "show-ready", primary: "start-game-1" };
  if (input.livePlay) return { stage: "question-live", primary: "end-early" };
  if (input.lastResolve) return { stage: "answer-result", primary: "return-to-board" };
  if (input.stagedQuestion) return { stage: "private-preview", primary: "reveal-to-room" };
  return { stage: "board", primary: null };
}
```

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run tests/unit/show-console.test.ts tests/unit/deriveHostMode.test.ts`

Expected: PASS with laptop and phone modes agreeing on intermission/finale boundaries.

- [ ] **Step 5: Commit**

```bash
git add lib/host/showConsole.ts tests/unit/show-console.test.ts
git commit -m "feat: define canonical host show stages"
```

---

### Task 2: Responsive Command-Center Shell

**Files:**
- Create: `components/host/HostCommandCenter.tsx`
- Create: `components/host/HostRoomTruth.tsx`
- Modify: `components/host/index.ts`
- Test: `tests/component/HostCommandCenter.test.tsx`

**Interfaces:**
- Consumes: `HostStage`, counts, delivery receipt, and current venue preview.
- Produces: persistent `board | room | scores | monitor` navigation and a slot for the current stage.

- [ ] **Step 1: Write tests for one-tap live navigation and accessible state**

```tsx
render(<HostCommandCenter stage="board" playerCount={31} lockedCount={0} delivery={{ tv: "current", currentPhones: 31, recoveringPhones: 0 }}>{<div>Board body</div>}</HostCommandCenter>);
expect(screen.getByRole("navigation", { name: "Host controls" })).toBeVisible();
expect(screen.getByRole("button", { name: "Board" })).toHaveAttribute("aria-current", "page");
expect(screen.getByText("TV live")).toBeVisible();
expect(screen.getByText("31 phones live")).toBeVisible();
```

- [ ] **Step 2: Run the focused test**

Run: `npx vitest run tests/component/HostCommandCenter.test.tsx`

Expected: FAIL because the shell is missing.

- [ ] **Step 3: Build the shell with CSS container breakpoints**

```tsx
export type HostSection = "board" | "room" | "scores" | "monitor";

export function HostCommandCenter({ active = "board", onNavigate, truth, children }: Props) {
  return (
    <main className="host-command-center" data-stage={truth.stage}>
      <HostRoomTruth {...truth} />
      <section className="host-command-center__body">{children}</section>
      <nav aria-label="Host controls" className="host-command-center__nav">
        {(["board", "room", "scores", "monitor"] as const).map((section) => (
          <button key={section} aria-current={active === section ? "page" : undefined} onClick={() => onNavigate(section)}>{section[0].toUpperCase() + section.slice(1)}</button>
        ))}
      </nav>
    </main>
  );
}
```

Add component-scoped styles with `min-height: 100dvh`, `padding: env(safe-area-inset-*)`, 48px minimum targets, a bottom bar for portrait, a right rail for landscape, and two panes at `min-width: 768px`.

- [ ] **Step 4: Prove 320px content remains reachable**

Run: `npx vitest run tests/component/HostCommandCenter.test.tsx`

Expected: PASS; navigation is present without a `More` menu and the truth region uses text plus icons.

- [ ] **Step 5: Commit**

```bash
git add components/host/HostCommandCenter.tsx components/host/HostRoomTruth.tsx components/host/index.ts tests/component/HostCommandCenter.test.tsx
git commit -m "feat: add responsive host command center"
```

---

### Task 3: Familiar Board and Private Preview

**Files:**
- Create: `components/host/HostPhoneBoard.tsx`
- Modify: `app/host/phone/[nightId]/HostPhoneClient.tsx`
- Replace: `components/host/HostPhoneUpcoming.tsx`
- Test: `tests/component/HostPhoneBoard.test.tsx`
- Modify test: `tests/component/HostPhoneClient.test.tsx`

**Interfaces:**
- Consumes: ordered categories/questions from the existing host snapshot.
- Produces: `onSelect(questionId)`, `onReveal(questionId)`, and a private correct-answer preview.

- [ ] **Step 1: Write the board-familiarity tests**

```tsx
render(<HostPhoneBoard categories={threeCategories} questions={twentyOneQuestions} selectedQuestionId={null} onSelect={onSelect} onReveal={onReveal} />);
expect(screen.getAllByRole("columnheader")).toHaveLength(3);
expect(screen.getAllByRole("button", { name: /points/ })).toHaveLength(21);
fireEvent.click(screen.getByRole("button", { name: "Music for 300 points" }));
expect(onSelect).toHaveBeenCalledWith("music-300");
```

- [ ] **Step 2: Confirm the existing rotating-next model fails the new test**

Run: `npx vitest run tests/component/HostPhoneBoard.test.tsx tests/component/HostPhoneClient.test.tsx`

Expected: FAIL because the phone has no 3×7 selectable board.

- [ ] **Step 3: Implement explicit cell selection and private preview**

```tsx
<div role="grid" aria-label="Question board" className="phone-board">
  {categories.map((category) => <div role="columnheader" key={category.id}>{category.name}</div>)}
  {rows.map((value) => categories.map((category) => {
    const question = byCategoryAndValue.get(`${category.id}:${value}`);
    return <button role="gridcell" aria-label={`${category.name} for ${value} points`} disabled={!question || !!question.played_at} onClick={() => question && onSelect(question.id)}>{question?.played_at ? "Played" : value}</button>;
  }))}
</div>
```

Replace automatic rotation in `HostPhoneClient` with selected cell identity. Render the prompt, four choices, correct answer, fact/tip, image readiness, `Reveal to room`, and `Back to board`. Never send this private preview through the TV snapshot.

- [ ] **Step 4: Run board and reveal regression tests**

Run: `npx vitest run tests/component/HostPhoneBoard.test.tsx tests/component/HostPhoneClient.test.tsx tests/unit/tv-snapshot-route-answer-gating.test.ts`

Expected: PASS; the selected question ID is the one posted to reveal and TV safety remains intact.

- [ ] **Step 5: Commit**

```bash
git add components/host/HostPhoneBoard.tsx components/host/HostPhoneUpcoming.tsx app/host/phone/'[nightId]'/HostPhoneClient.tsx tests/component/HostPhoneBoard.test.tsx tests/component/HostPhoneClient.test.tsx
git commit -m "feat: make phone question picking match the board"
```

---

### Task 4: Show Ready Preflight

**Files:**
- Create: `components/host/HostShowReady.tsx`
- Create: `app/api/nights/[id]/preflight/route.ts`
- Modify: `app/host/phone/[nightId]/HostPhoneClient.tsx`
- Test: `tests/unit/api-night-preflight.test.ts`
- Test: `tests/component/HostShowReady.test.tsx`

**Interfaces:**
- Produces: `{ content, tv, players, network, controls, canStart, checkedAt }`.
- Consumes: owned night, picked-question certification reports, latest TV observation, active players, and server/database round-trip.

- [ ] **Step 1: Write route and component tests**

```ts
expect(await response.json()).toMatchObject({
  checks: { content: "ready", tv: "ready", players: "ready", network: "healthy", controls: "ready" },
  canStart: true,
});
```

```tsx
expect(screen.getByRole("button", { name: "Start Game 1" })).toBeEnabled();
expect(screen.getByText("5 of 5 ready")).toBeVisible();
expect(screen.getByRole("img", { name: "Venue TV preview" })).toBeVisible();
```

- [ ] **Step 2: Run and observe the missing preflight**

Run: `npx vitest run tests/unit/api-night-preflight.test.ts tests/component/HostShowReady.test.tsx`

Expected: FAIL because route and screen do not exist.

- [ ] **Step 3: Implement truthful readiness rules**

`canStart` is `content === "ready" && controls === "ready" && tv !== "missing"`. A recovering player is a warning, not a blocker. `Run room sync test` re-fetches this same endpoint and shows elapsed time; it never spins longer than the existing bootstrap timeout and never creates game state.

- [ ] **Step 4: Verify start behavior and ownership**

Run: `npx vitest run tests/unit/api-night-preflight.test.ts tests/component/HostShowReady.test.tsx tests/component/HostPhoneClient.test.tsx`

Expected: PASS; non-owner receives 403, missing TV disables start with a reason, and player count zero does not block a valid rehearsal.

- [ ] **Step 5: Commit**

```bash
git add components/host/HostShowReady.tsx app/api/nights/'[id]'/preflight/route.ts app/host/phone/'[nightId]'/HostPhoneClient.tsx tests/unit/api-night-preflight.test.ts tests/component/HostShowReady.test.tsx
git commit -m "feat: add host show-ready preflight"
```

---

### Task 5: Live Question, Answer Result, and Scores on Phone

**Files:**
- Modify: `components/host/HostPhoneLive.tsx`
- Create: `components/host/HostAnswerResult.tsx`
- Create: `components/host/HostScores.tsx`
- Modify: `app/host/phone/[nightId]/HostPhoneClient.tsx`
- Reuse: `components/host/AdjustPointsModal.tsx`
- Test: `tests/component/HostPhoneLive.test.tsx`
- Test: `tests/component/HostAnswerResult.test.tsx`

**Interfaces:**
- Consumes: canonical answers, scores, current/last-resolved question, and existing adjustment route.
- Produces: locked/waiting counts, aggregate choice distribution, fastest five correct, return-to-board, search-and-adjust scores.

- [ ] **Step 1: Write the result and score-action tests**

```tsx
expect(screen.getByText("23 of 31 correct · 74%")).toBeVisible();
expect(screen.getByRole("button", { name: "Return to board" })).toBeVisible();
fireEvent.click(screen.getByRole("button", { name: "Adjust points for Jordan" }));
expect(screen.getByRole("dialog", { name: "Adjust points" })).toBeVisible();
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/component/HostPhoneLive.test.tsx tests/component/HostAnswerResult.test.tsx`

Expected: FAIL because the result and phone score surface are missing.

- [ ] **Step 3: Implement stage-specific controls**

During the question, show timer, confirmed lock count, waiting count, venue preview, and `End early`. Do not list or flag individuals on the default live screen. After resolve, calculate distribution and fastest five from canonical answers, render the fact/tip, and keep `Return to board` as the only primary action. Mount the existing adjustment dialog from Scores with its audited reason field unchanged.

- [ ] **Step 4: Verify result math and adjustment regression**

Run: `npx vitest run tests/component/HostPhoneLive.test.tsx tests/component/HostAnswerResult.test.tsx tests/unit/api-host-live-engine-routes.test.ts`

Expected: PASS; duplicate answers do not double-count and point adjustment still posts through `/api/adjustments`.

- [ ] **Step 5: Commit**

```bash
git add components/host/HostPhoneLive.tsx components/host/HostAnswerResult.tsx components/host/HostScores.tsx app/host/phone/'[nightId]'/HostPhoneClient.tsx tests/component/HostPhoneLive.test.tsx tests/component/HostAnswerResult.test.tsx
git commit -m "feat: complete live host controls on phone"
```

---

### Task 6: Explicit Intermission and Finale Across All Surfaces

**Files:**
- Create: `components/host/HostBetweenGames.tsx`
- Modify: `app/host/phone/[nightId]/HostPhoneClient.tsx`
- Modify: `components/tv/TVStateMachine.tsx`
- Modify: `app/(player)/room/[code]/page.tsx`
- Modify: `lib/player/betweenGames.ts`
- Modify test: `tests/e2e/full-game.spec.ts`
- Test: `tests/component/HostBetweenGames.test.tsx`

**Interfaces:**
- Consumes: canonical game states and explicit absence of an active play.
- Produces: Game 2 waiting, `Start Game 2`, `Present winners`, personal recap, and deliberate room close.

- [ ] **Step 1: Extend the full-game test before changing UI**

```ts
await expect(hostPhone.getByText("Game 1 complete")).toBeVisible();
await expect(playerPhone.getByText("Game 2 starts when Heather is ready")).toBeVisible();
await playerPhone.reload();
await expect(playerPhone.getByText("Game 2 starts when Heather is ready")).toBeVisible();
await expect(playerPhone.getByText("The answer was")).toHaveCount(0);
```

- [ ] **Step 2: Run the focused intermission test**

Run: `npx playwright test tests/e2e/full-game.spec.ts --grep "intermission"`

Expected: FAIL on the phone host state or any stale prior reveal.

- [ ] **Step 3: Implement canonical lifecycle presentation**

Clear resolved-question presentation whenever Game 1 is done and Game 2 is not live. Give host, TV, and player their distinct intermission copy. After Game 2, require `Present winners` before celebration and a separate `Close room` action afterward. Do not invent a next date when none exists.

- [ ] **Step 4: Run lifecycle tests**

Run: `npx vitest run tests/component/HostBetweenGames.test.tsx tests/unit/deriveHostMode.test.ts && npx playwright test tests/e2e/full-game.spec.ts`

Expected: PASS from show-ready through finale, including refresh during intermission.

- [ ] **Step 5: Commit**

```bash
git add components/host/HostBetweenGames.tsx app/host/phone/'[nightId]'/HostPhoneClient.tsx components/tv/TVStateMachine.tsx app/'(player)'/room/'[code]'/page.tsx lib/player/betweenGames.ts tests/component/HostBetweenGames.test.tsx tests/e2e/full-game.spec.ts
git commit -m "feat: align intermission and finale on every surface"
```

---

### Task 7: Private Delivery-Observation Store

**Files:**
- Create: `supabase/migrations/0028_surface_observations.sql`
- Create: `lib/host/showDelivery.ts`
- Test: `tests/integration/surface-observations-schema.test.ts`
- Test: `tests/unit/show-delivery.test.ts`

**Interfaces:**
- Produces: `SurfaceObservation` storage and `deriveDeliveryReceipt(observations, canonical, activePlayers, now)`.
- Security boundary: direct anon/authenticated table access denied; API routes use server-side identity and admin writes.

- [ ] **Step 1: Write negative schema and classification tests**

```ts
expect(await anon.from("surface_observations").select("*")).toMatchObject({ data: null });
expect(deriveDeliveryReceipt(observations, { runId: "r1", roomRevision: 9, controlRevision: 4, playId: "p1" }, 31, now)).toEqual({ tv: "current", currentPhones: 30, recoveringPhones: 1 });
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/integration/surface-observations-schema.test.ts tests/unit/show-delivery.test.ts`

Expected: FAIL because the table and classifier are absent.

- [ ] **Step 3: Add a non-authoritative, short-lived table**

```sql
create table public.surface_observations (
  night_id uuid not null references public.nights(id) on delete cascade,
  surface_kind text not null check (surface_kind in ('tv','player')),
  subject_key text not null,
  run_id uuid,
  room_revision bigint not null,
  control_revision bigint not null,
  play_id uuid,
  observed_at timestamptz not null default now(),
  primary key (night_id, surface_kind, subject_key)
);
alter table public.surface_observations enable row level security;
revoke all on public.surface_observations from anon, authenticated;
create index surface_observations_expiry_idx on public.surface_observations (observed_at);
```

Classify `current` only when run, room revision, control revision, and play match the canonical target and `observed_at` is within 45 seconds. Count only active, non-removed players in the denominator. Old rows are `recovering`, never current.

- [ ] **Step 4: Run schema and classifier tests**

Run: `npx vitest run tests/integration/surface-observations-schema.test.ts tests/unit/show-delivery.test.ts`

Expected: PASS; direct reads/writes are denied and observations have no foreign key to answers.

- [ ] **Step 5: Run the required security review before route work**

Review proof must show no public per-device feed, no answer fields, no raw device identifier in responses/logs, and no mutation path from observations into game functions.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0028_surface_observations.sql lib/host/showDelivery.ts tests/integration/surface-observations-schema.test.ts tests/unit/show-delivery.test.ts
git commit -m "feat: add private show delivery observations"
```

---

### Task 8: Show Pulse Reporting and Host Receipt

**Files:**
- Create: `app/api/room/[code]/observe/route.ts`
- Create: `app/api/tv/[code]/observe/route.ts`
- Create: `app/api/host/rooms/[code]/delivery/route.ts`
- Create: `lib/hooks/useShowDelivery.ts`
- Modify: `app/(player)/room/[code]/page.tsx`
- Modify: `app/tv/[code]/page.tsx`
- Modify: `app/host/phone/[nightId]/HostPhoneClient.tsx`
- Modify: `components/host/HostRoomTruth.tsx`
- Test: `tests/unit/api-surface-observe.test.ts`
- Test: `tests/unit/api-host-delivery.test.ts`
- Test: `tests/component/HostRoomTruth.test.tsx`

**Interfaces:**
- Surface POST body: `{ runId, roomRevision, controlRevision, playId }`.
- Host GET response: `{ tv: "current" | "recovering", currentPhones: number, recoveringPhones: number, canonical: LiveRevision }`.

- [ ] **Step 1: Write authorization and privacy tests**

```ts
expect(playerObserve.status).toBe(204);
expect(unjoinedDeviceObserve.status).toBe(403);
expect(nonOwnerDelivery.status).toBe(403);
expect(JSON.stringify(await ownerDelivery.json())).not.toMatch(/device|playerId|answer|choice/i);
```

- [ ] **Step 2: Run route tests**

Run: `npx vitest run tests/unit/api-surface-observe.test.ts tests/unit/api-host-delivery.test.ts`

Expected: FAIL because routes are absent.

- [ ] **Step 3: Implement server-derived subjects and monotonic upserts**

The player route derives the player from the signed device cookie plus room membership, then hashes that server-side identity for `subject_key`. The TV route uses one server-derived TV key per night. Reject a revision from another run and ignore observations older than the stored revision. Add per-subject rate limiting and `Cache-Control: no-store`.

- [ ] **Step 4: Report only after a surface paints canonical state**

`useShowDelivery` POSTs in an effect keyed by `runId:roomRevision:controlRevision:playId` after the surface renderer commits. The host polls the aggregate receipt while any surface is recovering, backs off after 10 seconds, and stops when the stage changes. It keeps the last confirmed receipt visible while requests travel.

- [ ] **Step 5: Render restrained Show Pulse feedback**

Use exact labels `Sending…`, `TV live ✓`, `{n} phones live ✓`, `{n} recovering — answer protected`, and `Shown everywhere`. Trigger one supported haptic only after the host command receives its canonical applied result. Under reduced motion, switch labels without animation.

- [ ] **Step 6: Run route, component, and live-answer authority tests**

Run: `npx vitest run tests/unit/api-surface-observe.test.ts tests/unit/api-host-delivery.test.ts tests/component/HostRoomTruth.test.tsx tests/integration/live-answer-engine-schema.test.ts`

Expected: PASS; forged/stale observations cannot alter canonical state and host receipts contain aggregates only.

- [ ] **Step 7: Commit**

```bash
git add app/api/room/'[code]'/observe/route.ts app/api/tv/'[code]'/observe/route.ts app/api/host/rooms/'[code]'/delivery/route.ts lib/hooks/useShowDelivery.ts app/'(player)'/room/'[code]'/page.tsx app/tv/'[code]'/page.tsx app/host/phone/'[nightId]'/HostPhoneClient.tsx components/host/HostRoomTruth.tsx tests/unit/api-surface-observe.test.ts tests/unit/api-host-delivery.test.ts tests/component/HostRoomTruth.test.tsx
git commit -m "feat: add truthful show pulse receipts"
```

---

### Task 9: Venue Monitor and Responsive Proof

**Files:**
- Create: `components/host/HostVenueMonitor.tsx`
- Modify: `components/host/HostCommandCenter.tsx`
- Modify: `app/host/phone/[nightId]/HostPhoneClient.tsx`
- Create: `tests/e2e/host-command-center-responsive.spec.ts`
- Create: `tests/e2e/show-pulse-recovery.spec.ts`
- Modify: `tests/e2e/helpers/player-phone.ts`

**Interfaces:**
- Consumes: existing `TVStateMachine` with the host's audience-safe TV snapshot.
- Produces: portrait thumbnail, landscape full-width monitor with separate rail, and iPad split view.

- [ ] **Step 1: Write viewport and recovery scenarios**

```ts
for (const viewport of [{ width: 320, height: 568 }, { width: 430, height: 932 }, { width: 844, height: 390 }, { width: 1180, height: 820 }]) {
  await page.setViewportSize(viewport);
  await expect(page.getByRole("navigation", { name: "Host controls" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Reveal to room|End early|Return to board|Start Game 2/ })).toBeInViewport();
}
```

- [ ] **Step 2: Run the new E2E tests**

Run: `npx playwright test tests/e2e/host-command-center-responsive.spec.ts tests/e2e/show-pulse-recovery.spec.ts`

Expected: FAIL until the monitor and responsive layout are wired.

- [ ] **Step 3: Render the exact TV state without private overlays**

Mount `TVStateMachine` from the audience-safe TV snapshot inside an `aria-label="Venue TV preview"` container. In portrait it is a 16:9 thumbnail. In landscape it occupies the left pane and the command rail occupies the right. On iPad the board and stage control remain simultaneously visible. Never layer private correct answers, fair-play data, or point-adjustment UI over the preview.

- [ ] **Step 4: Prove failure paths**

Delay broadcast, drop one observation acknowledgement, refresh one player during intermission, reconnect TV with a stale revision, disable haptics, and enable reduced motion. Assert the last confirmed state stays visible, the host retains the safe contextual action, and the receipt converges without manual retry.

- [ ] **Step 5: Run the full verification stack**

Run: `npm test`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: only the two documented pre-existing `HostHomeClient-founder-build.test.tsx` fixture errors, or zero if separately corrected; no new error.

Run: `npm run build`

Expected: PASS.

Run: `npx playwright test tests/e2e/host-command-center-responsive.spec.ts tests/e2e/show-pulse-recovery.spec.ts tests/e2e/full-game.spec.ts`

Expected: PASS at every named viewport and lifecycle state.

- [ ] **Step 6: Commit**

```bash
git add components/host/HostVenueMonitor.tsx components/host/HostCommandCenter.tsx app/host/phone/'[nightId]'/HostPhoneClient.tsx tests/e2e/host-command-center-responsive.spec.ts tests/e2e/show-pulse-recovery.spec.ts tests/e2e/helpers/player-phone.ts
git commit -m "test: prove command center across devices and recovery"
```

---

## Implementation Gates

1. Tasks 1–6 are reversible application work and may be implemented behind a disabled-by-default host feature flag.
2. Task 7 requires a security review before its migration is applied anywhere outside the local test database.
3. Tasks 7–8 require explicit founder approval before migration, preview release, or external write traffic.
4. Production release occurs only after Task 9 passes, a synthetic rehearsal is removed, and Brandon approves the PR.
5. Fair-play review receives its own privacy/false-positive spec; it is not quietly added to this plan.

## Market-Proof Follow-Through

After release, run the approved four-week pilot with Heather and two additional hosts. Capture only aggregate operational metrics: phone-vs-laptop host actions, stale-screen/missing-save reports, manual recovery interventions, finale retention, returning anonymous devices, and venue rebooking. A four-week pilot is evidence for or against the live-room show-console category; it is not permission to add CRM or a new mode.

## Self-Review Record

- **Spec coverage:** Tasks 1–6 cover the complete Classic host lifecycle; Tasks 7–8 cover truthful Show Pulse; Task 9 covers device, recovery, reduced-motion, and cross-surface proof.
- **Deliberate gap:** Fair-play review remains behind the privacy/false-positive gate required by the approved spec.
- **Authority check:** Observations are write-only inputs to an aggregate receipt and have no path into scoring or game mutation.
- **Type consistency:** `HostStage`, `HostPrimaryAction`, `LiveRevision`, and delivery receipt names remain identical across producers and consumers.
- **Rollback:** Disable the host command-center feature flag and stop observation POSTs. Existing laptop, player, TV, and answer-engine behavior remains the fallback; the observation table is inert until a separately approved migration rollback.
