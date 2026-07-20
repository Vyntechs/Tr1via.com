# Account-First Host Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in host control the same live game from phone or laptop without pairing, while making the phone’s TV preview and the venue display readable at every supported aspect ratio.

**Architecture:** Keep `/host/live/[nightId]` as the single authenticated control route and let its existing responsive boundary choose the compact or desktop console. Replace device-specific host links and the host QR handoff with account ownership plus a safe post-login return path. Render TV content once on a fixed 1600×900 logical canvas, then scale and center that canvas inside both the real venue viewport and the host’s read-only preview.

**Tech Stack:** Next.js 16 App Router, React 19, strict TypeScript, Supabase Auth, Tailwind/CSS-in-JS theme tokens, Vitest, Testing Library, Playwright.

## Global Constraints

- Preserve the existing game-state, broadcast, recovery, authorization, and scoring contracts.
- Do not add a database migration, device lease, pairing token, host QR, or second control state.
- The only promoted QR on live host/TV surfaces is the player join QR, labeled `Players — scan to join this game`.
- Both authenticated host devices may act concurrently; every mutation remains server-authorized by game ownership.
- Do not use `room` in new customer-facing copy on touched surfaces; use `game` or `players`.
- Keep all monthly theme tokens and weather layers intact.
- PR-first: do not merge or deploy from this plan.

---

## Task 1: Make the authenticated game route device-independent

**Files:**
- Modify: `lib/host/hostRunPath.ts`
- Modify: `app/host/HostHomeClient.tsx`
- Modify: `components/host/HostDashboard.tsx`
- Modify: `app/host/phone/[nightId]/page.tsx`
- Modify: `app/(host)/login/page.tsx`
- Create: `lib/host/hostReturnPath.ts`
- Modify tests: `tests/unit/HostHomeClient-mobile-entry.test.tsx`
- Modify tests: `tests/unit/HostDashboard.test.tsx`
- Create tests: `tests/unit/host-return-path.test.ts`
- Modify E2E: `tests/e2e/host-mobile-visual-harness.spec.ts`

- [ ] **Step 1: Write failing route and copy tests**

Assert that phone and desktop both navigate to `/host/live/<nightId>`, the compact live CTA says `Control live game`, the desktop live CTA says `Show game on this laptop/TV`, and no `Private phone controls` link is rendered.

- [ ] **Step 2: Write the safe return-path tests**

Cover `null`, `/host`, `/host/live/night-1`, `/host/setup/night-1`, `//evil.test`, `https://evil.test`, and non-host routes. Only a local path rooted at `/host` may survive.

```ts
export function hostReturnPath(value: string | null): string {
  if (!value || !value.startsWith("/host") || value.startsWith("//")) return "/host";
  return value;
}
```

- [ ] **Step 3: Run the focused tests and observe the intended failures**

Run: `npx vitest run tests/unit/HostHomeClient-mobile-entry.test.tsx tests/unit/HostDashboard.test.tsx tests/unit/host-return-path.test.ts`

Expected: failures mention the current `/host/phone` route, legacy CTA labels/link, and the missing helper.

- [ ] **Step 4: Implement the canonical route and CTA language**

Make `hostRunPath(nightId)` return `/host/live/${nightId}` without media-query behavior. Remove the dashboard’s private-phone secondary link. Keep the setup and home callers unchanged so they inherit the canonical route.

- [ ] **Step 5: Turn the legacy phone route into an authenticated compatibility redirect**

Keep its existing owned-night lookup and not-found behavior, then `redirect(`/host/live/${nightId}`)` rather than rendering a second surface.

- [ ] **Step 6: Return login to the intended host game**

Read `next` with `useSearchParams()`, normalize it through `hostReturnPath`, and use that destination after host-access succeeds and from the already-signed-in panel. Never accept an absolute or protocol-relative redirect.

- [ ] **Step 7: Run focused tests**

Run: `npx vitest run tests/unit/HostHomeClient-mobile-entry.test.tsx tests/unit/HostDashboard.test.tsx tests/unit/host-return-path.test.ts`

Expected: all pass.

- [ ] **Step 8: Commit the route slice**

```bash
git add lib/host/hostRunPath.ts lib/host/hostReturnPath.ts app/host/HostHomeClient.tsx components/host/HostDashboard.tsx 'app/host/phone/[nightId]/page.tsx' 'app/(host)/login/page.tsx' tests/unit/HostHomeClient-mobile-entry.test.tsx tests/unit/HostDashboard.test.tsx tests/unit/host-return-path.test.ts tests/e2e/host-mobile-visual-harness.spec.ts
git commit -m "feat: make host control account first"
```

---

## Task 2: Remove host pairing UI and make device roles self-explanatory

**Files:**
- Modify: `app/host/live/[nightId]/HostLiveConsoleClient.tsx`
- Modify: `components/host/HostLiveConsole.tsx`
- Modify: `components/tv/TVLobby.tsx`
- Modify: `components/tv/TVIntermission.tsx`
- Modify tests: `tests/unit/host-live-mobile-route.test.ts`
- Modify tests: `tests/unit/host-players-sheet.test.tsx`
- Modify tests: `tests/unit/tv-lobby.test.tsx`
- Modify tests: `tests/component/HostLiveConsole.test.tsx`

- [ ] **Step 1: Write failing ownership and QR tests**

Assert there is no `privateControlUrl`, `Phone remote`, host QR modal, `/host/phone/` link, or control-pairing instruction. Assert the players surface contains exactly `Players — scan to join this game` next to the join QR.

- [ ] **Step 2: Run focused tests and observe the intended failures**

Run: `npx vitest run tests/unit/host-live-mobile-route.test.ts tests/unit/host-players-sheet.test.tsx tests/unit/tv-lobby.test.tsx tests/component/HostLiveConsole.test.tsx`

Expected: legacy phone handoff assertions fail and the new player-label assertions fail.

- [ ] **Step 3: Remove the host QR handoff end to end**

Delete `privateControlUrl`, `phoneRemoteOpen`, the `Phone remote` action, and `PhoneRemoteHandoff`. Keep `QRBlock` only for joining players.

- [ ] **Step 4: Label the remaining QR by audience and action**

Use `Players — scan to join this game` on the host player sheet, lobby, and intermission QR. Replace touched `ROOM OPEN`, `ROOM CODE`, and `in the room` language with `GAME OPEN`, `GAME CODE`, and player/game wording.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/unit/host-live-mobile-route.test.ts tests/unit/host-players-sheet.test.tsx tests/unit/tv-lobby.test.tsx tests/component/HostLiveConsole.test.tsx`

Expected: all pass.

- [ ] **Step 6: Commit the pairing-removal slice**

```bash
git add 'app/host/live/[nightId]/HostLiveConsoleClient.tsx' components/host/HostLiveConsole.tsx components/tv/TVLobby.tsx components/tv/TVIntermission.tsx tests/unit/host-live-mobile-route.test.ts tests/unit/host-players-sheet.test.tsx tests/unit/tv-lobby.test.tsx tests/component/HostLiveConsole.test.tsx
git commit -m "refactor: remove host pairing flow"
```

---

## Task 3: Create one fixed TV canvas for every viewport

**Files:**
- Create: `lib/tv/fitTVCanvas.ts`
- Create: `components/tv/ScaledTVCanvas.tsx`
- Modify: `app/tv/[code]/page.tsx`
- Modify: `components/host/HostVenueMonitor.tsx`
- Create tests: `tests/unit/fit-tv-canvas.test.ts`
- Create tests: `tests/component/ScaledTVCanvas.test.tsx`
- Modify tests: `tests/component/HostVenueMonitor.test.tsx`

- [ ] **Step 1: Write failing canvas-fit tests**

Define the logical canvas as 1600×900. Verify contain-fit results for 390×844, 844×390, 1280×720, and 1920×1080. Portrait must letterbox vertically; landscape must letterbox horizontally when needed.

```ts
export const TV_LOGICAL_WIDTH = 1600;
export const TV_LOGICAL_HEIGHT = 900;

export function fitTVCanvas(viewportWidth: number, viewportHeight: number) {
  const scale = Math.max(
    0,
    Math.min(viewportWidth / TV_LOGICAL_WIDTH, viewportHeight / TV_LOGICAL_HEIGHT),
  );
  return {
    scale,
    width: TV_LOGICAL_WIDTH * scale,
    height: TV_LOGICAL_HEIGHT * scale,
  };
}
```

- [ ] **Step 2: Write a failing component contract test**

Mock `ResizeObserver`, render `ScaledTVCanvas`, and assert the inner stage remains exactly `1600px × 900px` with `transform-origin: top left`; resizing may change only its scale and centered offset.

- [ ] **Step 3: Run focused tests and observe the intended failures**

Run: `npx vitest run tests/unit/fit-tv-canvas.test.ts tests/component/ScaledTVCanvas.test.tsx tests/component/HostVenueMonitor.test.tsx`

Expected: missing modules and legacy direct-link expectations fail.

- [ ] **Step 4: Implement the reusable canvas**

`ScaledTVCanvas` owns the `ResizeObserver`, fills its outer frame, computes contain-fit from both width and height, centers the rendered rectangle, and scales one fixed 1600×900 child stage. It accepts an accessible label and test IDs but no navigation behavior.

- [ ] **Step 5: Put the actual venue TV on the canvas**

Replace `TVStageFrame`’s narrow responsive wrapper in `app/tv/[code]/page.tsx` with `ScaledTVCanvas`. Preserve the existing `TVStage`, theme, weather, pyrotechnics, state machine, and loading/error behavior inside the logical stage.

- [ ] **Step 6: Put the host preview on the same canvas**

Refactor `HostVenueMonitor` to reuse `ScaledTVCanvas`, remove `Open full venue display`, title it `TV preview`, and add `What players see`. Preserve read-only behavior.

- [ ] **Step 7: Run focused tests**

Run: `npx vitest run tests/unit/fit-tv-canvas.test.ts tests/component/ScaledTVCanvas.test.tsx tests/component/HostVenueMonitor.test.tsx`

Expected: all pass.

- [ ] **Step 8: Commit the canvas slice**

```bash
git add lib/tv/fitTVCanvas.ts components/tv/ScaledTVCanvas.tsx 'app/tv/[code]/page.tsx' components/host/HostVenueMonitor.tsx tests/unit/fit-tv-canvas.test.ts tests/component/ScaledTVCanvas.test.tsx tests/component/HostVenueMonitor.test.tsx
git commit -m "fix: scale tv canvas across viewports"
```

---

## Task 4: Make the phone command center use a true preview, never the venue route

**Files:**
- Modify: `app/host/phone/[nightId]/HostPhoneClient.tsx`
- Modify: `components/host/HostCommandCenter.tsx`
- Modify: `components/host/HostGameReady.tsx`
- Modify tests: `tests/component/HostPhoneClient.test.tsx`
- Modify E2E: `tests/e2e/host-command-center-responsive.spec.ts`
- Modify E2E: `tests/e2e/host-mobile-full-parity.spec.ts`

- [ ] **Step 1: Write failing phone-boundary tests**

Assert compact host UI exposes `TV preview`, renders the read-only logical canvas, and has no link whose href starts with `/tv/`. Assert portrait and landscape retain all command-center navigation and minimum 44px tap targets.

- [ ] **Step 2: Run focused component tests and observe intended failures**

Run: `npx vitest run tests/component/HostPhoneClient.test.tsx tests/component/HostVenueMonitor.test.tsx`

Expected: current `TV view ↗`, `Open venue screen`, and `Open full venue display` expectations fail.

- [ ] **Step 3: Remove direct venue navigation from compact host controls**

Delete the `TV view ↗` link from round controls and the `Open venue screen ↗` link from game-ready. Rename the command-center section from `TV` to `TV preview`. Do not add a replacement external link.

- [ ] **Step 4: Update responsive browser coverage**

Use the canonical `/host/live/[nightId]` route in E2E. Cover phone portrait, phone landscape, and tablet. Assert no horizontal control clipping, the preview remains 16:9, and its inner canvas remains 1600×900.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/component/HostPhoneClient.test.tsx tests/component/HostVenueMonitor.test.tsx`

Expected: all pass.

- [ ] **Step 6: Commit the compact-command-center slice**

```bash
git add 'app/host/phone/[nightId]/HostPhoneClient.tsx' components/host/HostCommandCenter.tsx components/host/HostGameReady.tsx tests/component/HostPhoneClient.test.tsx tests/e2e/host-command-center-responsive.spec.ts tests/e2e/host-mobile-full-parity.spec.ts
git commit -m "fix: make phone tv view a true preview"
```

---

## Task 5: Explain the change once, to hosts only

**Files:**
- Modify: `components/host/HostWhatsNew.tsx`
- Modify: `app/host/HostHomeClient.tsx`
- Modify tests: `tests/unit/HostHomeClient-whats-new.test.tsx`

- [ ] **Step 1: Write a failing host-only notice test**

Assert the notice explains: `Sign in on any device`, `Control the same live game`, `TV preview`, and `Players scan the only QR`. Assert it never renders on player or TV routes through existing route-boundary tests.

- [ ] **Step 2: Run the focused test and observe the intended failure**

Run: `npx vitest run tests/unit/HostHomeClient-whats-new.test.tsx`

Expected: the new benefits and new dismissal key are absent.

- [ ] **Step 3: Add the honest host-facing explanation**

Add a concise benefit card describing account-first controls and clarify that simultaneous host devices control the same game. Bump the local-storage key from `original-v1` to `original-v2` so existing hosts see it once. Preserve the current contact-Brandon honesty note.

- [ ] **Step 4: Run the focused test**

Run: `npx vitest run tests/unit/HostHomeClient-whats-new.test.tsx`

Expected: all pass.

- [ ] **Step 5: Commit the notice slice**

```bash
git add components/host/HostWhatsNew.tsx app/host/HostHomeClient.tsx tests/unit/HostHomeClient-whats-new.test.tsx
git commit -m "feat: explain account-first hosting"
```

---

## Task 6: Converge, verify, and prepare the PR

**Files:**
- Review all files changed by Tasks 1–5
- Modify only failing tests or implementation files directly attributable to this feature

- [ ] **Step 1: Scan for forbidden remnants**

Run:

```bash
rg -n "Phone remote|Private phone controls|Host from this phone|TV view ↗|Open venue screen|Open full venue display|/host/phone/" app components lib tests
```

Expected: only the legacy compatibility route itself and explicit negative test fixtures may remain.

- [ ] **Step 2: Run targeted unit and component coverage**

```bash
npx vitest run \
  tests/unit/HostHomeClient-mobile-entry.test.tsx \
  tests/unit/HostDashboard.test.tsx \
  tests/unit/host-return-path.test.ts \
  tests/unit/host-live-mobile-route.test.ts \
  tests/unit/host-players-sheet.test.tsx \
  tests/unit/tv-lobby.test.tsx \
  tests/unit/fit-tv-canvas.test.ts \
  tests/unit/HostHomeClient-whats-new.test.tsx \
  tests/component/HostLiveConsole.test.tsx \
  tests/component/HostPhoneClient.test.tsx \
  tests/component/HostVenueMonitor.test.tsx \
  tests/component/ScaledTVCanvas.test.tsx
```

Expected: all pass.

- [ ] **Step 3: Run static and full regression checks**

Run: `npm test`

Expected: all Vitest tests pass.

Run: `npx tsc --noEmit`

Expected: no new errors; only the two documented pre-existing `HostHomeClient-founder-build.test.tsx` fixture errors may remain.

Run: `npm run build`

Expected: production build succeeds.

- [ ] **Step 4: Run responsive browser verification**

Run:

```bash
npx playwright test tests/e2e/host-mobile-visual-harness.spec.ts tests/e2e/host-command-center-responsive.spec.ts tests/e2e/host-mobile-full-parity.spec.ts
```

Expected: canonical host entry, phone portrait, phone landscape, tablet, 1280×720 venue display, and 1920×1080 venue display all pass without clipping or host-only QR UI.

- [ ] **Step 5: Inspect browser screenshots**

Confirm that the TV composition is identical across the real display and phone preview, scaled rather than reflowed; all control labels are readable; and monthly theme/weather styling is preserved.

- [ ] **Step 6: Review the final diff**

Check for unrelated edits, weakened tests, duplicated state, changed scoring/realtime contracts, unsafe redirects, and imports of server-only code into client components.

- [ ] **Step 7: Commit any consolidated repair wave**

```bash
git add <only-files-touched-by-the-repair>
git commit -m "test: harden account-first host control"
```

- [ ] **Step 8: Prepare, but do not merge or deploy, the PR**

The PR description must include the before/after route behavior, the removal of host QR pairing, the fixed-canvas display contract, affected device sizes, test/build evidence, and rollback instructions (revert the feature commits).

