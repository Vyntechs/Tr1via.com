# Room Magic v1.1 House Lights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Room Magic v1.1 House Lights: a default-off, no-DB, lock-in presence layer plus deterministic multi-surface validation.

**Architecture:** Derive House Lights from existing active-question lock-in state (`snapshot.liveAnswers`, `snapshot.players`, and `nights.room_magic_enabled`). Render a cosmetic TV/host layer through `TVQuestion` and a player-phone confirmation through `PlayerLocked`; no answer, reveal, resolve, scoring, database, or realtime transport changes. Add a reusable Playwright rehearsal command that simulates host, TV, and multiple phones and saves screenshots plus a machine-readable result summary.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Supabase existing test routes, Vitest, Playwright.

## Global Constraints

- No production database touch.
- No new database tables or production database change files.
- No new realtime transport required for answer submission.
- Room Magic remains default-off through existing `nights.room_magic_enabled`.
- Heather's Classic must look and behave unchanged when Room Magic is off.
- House Lights is visual-only, aggregate, edge-bound, and cosmetic.
- No chat, free text, profiles, avatars, reaction scoring, moderation queues, or player-to-player interaction.
- Never render live answer choices, correctness, scramble, device IDs, cookies, or private host data.
- Invalid, stale, malformed, or impossible presence data hides the enhancement and preserves Classic.
- Reduced-motion mode must preserve meaning without required animation.
- The reusable validation command must be deterministic and use little or no AI.
- Do not deploy, merge to `main`, or touch production data without Brandon approval.

---

## File Structure

- Create `lib/room-magic/house-lights.ts` for pure presence derivation, clamping, and duplicate/stale lock filtering.
- Create `tests/unit/room-magic-house-lights.test.ts` for pure helper coverage.
- Create `components/tv/TVHouseLights.tsx` for the TV/host visual layer.
- Modify `components/tv/index.ts` to export `TVHouseLights`.
- Modify `components/tv/TVQuestion.tsx` to render `TVHouseLights` when `roomMagicEnabled` is true.
- Modify `components/tv/TVStateMachine.tsx` to pass `snapshot.night.roomMagicEnabled` and active question ID into `TVQuestion`.
- Create `tests/component/TVHouseLights.test.tsx`.
- Create `tests/component/TVQuestionHouseLights.test.tsx`.
- Modify `components/player/PlayerLocked.tsx` for stable test IDs and reduced-motion pulse suppression.
- Modify `tests/unit/player-locked-live-count.test.tsx` for the player confirmation and reduced-motion regression.
- Create `tests/e2e/room-magic-house-lights.spec.ts` for the multi-surface rehearsal.
- Modify `package.json` to add `validate:room-magic`.

## Branch Strategy

Implementation should start from latest `origin/main` on:

```bash
git fetch origin main
git switch -c staging/room-magic-v1-1-house-lights origin/main
```

If multiple workers execute in parallel, use disjoint task branches and PR them into `staging/room-magic-v1-1-house-lights`. Do not use the current docs branch as the implementation base.

---

### Task 1: Pure House Lights Presence Helper

**Files:**
- Create: `lib/room-magic/house-lights.ts`
- Test: `tests/unit/room-magic-house-lights.test.ts`

**Interfaces:**
- Produces: `deriveHouseLightsPresence(input: HouseLightsPresenceInput): HouseLightsPresence | null`
- Produces: `countHouseLightsLocks(answers: HouseLightsAnswer[], activeQuestionId?: string | null): number`
- Consumes: plain values only; no React, Supabase, browser APIs, or database access.

- [ ] **Step 1: Write the failing helper tests**

Create `tests/unit/room-magic-house-lights.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  countHouseLightsLocks,
  deriveHouseLightsPresence,
} from "@/lib/room-magic/house-lights";

describe("room magic house lights", () => {
  it("stays off when Room Magic is disabled", () => {
    expect(
      deriveHouseLightsPresence({
        roomMagicEnabled: false,
        lockedCount: 2,
        totalPlayers: 3,
      }),
    ).toBeNull();
  });

  it("derives clamped aggregate progress from valid lock counts", () => {
    expect(
      deriveHouseLightsPresence({
        roomMagicEnabled: true,
        lockedCount: 2,
        totalPlayers: 3,
      }),
    ).toEqual({
      lockedCount: 2,
      totalPlayers: 3,
      progressPct: 67,
      intensity: "medium",
      complete: false,
    });
  });

  it("hides when totals are impossible or malformed", () => {
    expect(
      deriveHouseLightsPresence({
        roomMagicEnabled: true,
        lockedCount: 4,
        totalPlayers: 3,
      }),
    ).toBeNull();
    expect(
      deriveHouseLightsPresence({
        roomMagicEnabled: true,
        lockedCount: -1,
        totalPlayers: 3,
      }),
    ).toBeNull();
    expect(
      deriveHouseLightsPresence({
        roomMagicEnabled: true,
        lockedCount: 1,
        totalPlayers: 0,
      }),
    ).toBeNull();
  });

  it("keeps zero locks valid but calm", () => {
    expect(
      deriveHouseLightsPresence({
        roomMagicEnabled: true,
        lockedCount: 0,
        totalPlayers: 5,
      }),
    ).toEqual({
      lockedCount: 0,
      totalPlayers: 5,
      progressPct: 0,
      intensity: "idle",
      complete: false,
    });
  });

  it("counts one lock per player for the active question only", () => {
    const answers = [
      { id: "a1", player_id: "p1", question_id: "q1" },
      { id: "a2", player_id: "p1", question_id: "q1" },
      { id: "a3", player_id: "p2", question_id: "q1" },
      { id: "a4", player_id: "p3", question_id: "q2" },
      { id: "a5", player_id: "", question_id: "q1" },
    ];

    expect(countHouseLightsLocks(answers, "q1")).toBe(2);
  });
});
```

- [ ] **Step 2: Run the helper tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/room-magic-house-lights.test.ts
```

Expected: FAIL because `@/lib/room-magic/house-lights` does not exist.

- [ ] **Step 3: Implement the pure helper**

Create `lib/room-magic/house-lights.ts`:

```ts
export type HouseLightsIntensity = "idle" | "low" | "medium" | "high";

export interface HouseLightsPresenceInput {
  roomMagicEnabled: boolean;
  lockedCount: number | null | undefined;
  totalPlayers: number | null | undefined;
}

export interface HouseLightsPresence {
  lockedCount: number;
  totalPlayers: number;
  progressPct: number;
  intensity: HouseLightsIntensity;
  complete: boolean;
}

export interface HouseLightsAnswer {
  id?: string | null;
  player_id?: string | null;
  question_id?: string | null;
}

export function countHouseLightsLocks(
  answers: HouseLightsAnswer[],
  activeQuestionId?: string | null,
): number {
  const seen = new Set<string>();

  for (const answer of answers) {
    const playerId = typeof answer.player_id === "string" ? answer.player_id : "";
    if (!playerId) continue;
    if (activeQuestionId && answer.question_id !== activeQuestionId) {
      continue;
    }
    seen.add(playerId);
  }

  return seen.size;
}

export function deriveHouseLightsPresence(
  input: HouseLightsPresenceInput,
): HouseLightsPresence | null {
  if (!input.roomMagicEnabled) return null;

  const lockedCount = finiteWholeNumber(input.lockedCount);
  const totalPlayers = finiteWholeNumber(input.totalPlayers);
  if (lockedCount === null || totalPlayers === null) return null;
  if (totalPlayers <= 0 || lockedCount < 0 || lockedCount > totalPlayers) {
    return null;
  }

  const progressPct = Math.min(
    100,
    Math.max(0, Math.round((lockedCount / totalPlayers) * 100)),
  );

  return {
    lockedCount,
    totalPlayers,
    progressPct,
    intensity: intensityFor(progressPct),
    complete: totalPlayers > 0 && lockedCount === totalPlayers,
  };
}

function finiteWholeNumber(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value)) return null;
  return value;
}

function intensityFor(progressPct: number): HouseLightsIntensity {
  if (progressPct <= 0) return "idle";
  if (progressPct < 34) return "low";
  if (progressPct < 67) return "medium";
  return "high";
}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/room-magic-house-lights.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add lib/room-magic/house-lights.ts tests/unit/room-magic-house-lights.test.ts
git commit -m "feat: derive room magic house lights presence"
```

---

### Task 2: TV and Host Mirror House Lights Layer

**Files:**
- Create: `components/tv/TVHouseLights.tsx`
- Modify: `components/tv/index.ts`
- Modify: `components/tv/TVQuestion.tsx`
- Modify: `components/tv/TVStateMachine.tsx`
- Test: `tests/component/TVHouseLights.test.tsx`
- Test: `tests/component/TVQuestionHouseLights.test.tsx`

**Interfaces:**
- Consumes from Task 1: `deriveHouseLightsPresence`, `countHouseLightsLocks`
- Produces: `TVHouseLights` component with props `{ roomMagicEnabled, lockedCount, totalPlayers, accent }`
- Produces: `TVQuestionProps.roomMagicEnabled?: boolean`
- Produces: `data-testid="tv-house-lights"` and `data-testid="tv-house-lights-fill"`

- [ ] **Step 1: Write failing component tests for the visual layer**

Create `tests/component/TVHouseLights.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TVHouseLights } from "@/components/tv/TVHouseLights";

let reducedMotion = false;

vi.mock("@/lib/hooks/usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => reducedMotion,
}));

describe("TVHouseLights", () => {
  it("renders nothing when Room Magic is disabled", () => {
    const { container } = render(
      <TVHouseLights
        roomMagicEnabled={false}
        lockedCount={2}
        totalPlayers={3}
        accent="#7DD3FC"
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders aggregate lock-in progress when enabled", () => {
    render(
      <TVHouseLights
        roomMagicEnabled
        lockedCount={2}
        totalPlayers={3}
        accent="#7DD3FC"
      />,
    );

    expect(screen.getByTestId("tv-house-lights")).toHaveTextContent(
      "2 of 3 locked in",
    );
    expect(screen.getByTestId("tv-house-lights-fill")).toHaveStyle({
      width: "67%",
    });
  });

  it("hides impossible player counts instead of guessing", () => {
    const { container } = render(
      <TVHouseLights
        roomMagicEnabled
        lockedCount={4}
        totalPlayers={3}
        accent="#7DD3FC"
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("keeps reduced motion meaningful without animation", () => {
    reducedMotion = true;
    render(
      <TVHouseLights
        roomMagicEnabled
        lockedCount={1}
        totalPlayers={2}
        accent="#7DD3FC"
      />,
    );

    expect(screen.getByTestId("tv-house-lights")).toHaveAttribute(
      "data-reduced-motion",
      "true",
    );
    expect(screen.getByTestId("tv-house-lights")).toHaveStyle({
      animation: "none",
    });
    reducedMotion = false;
  });
});
```

Create `tests/component/TVQuestionHouseLights.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TVQuestion } from "@/components/tv/TVQuestion";

const tiles = [
  { id: "a1", name: "Alex", t: "1.1s" },
  { id: "a2", name: "Brooke", t: "2.4s" },
];

describe("TVQuestion House Lights", () => {
  it("does not render House Lights when Room Magic is disabled", () => {
    render(
      <TVQuestion
        roomMagicEnabled={false}
        tiles={tiles}
        totalPlayers={3}
      />,
    );

    expect(screen.queryByTestId("tv-house-lights")).not.toBeInTheDocument();
  });

  it("renders House Lights from aggregate lock-in state when Room Magic is enabled", () => {
    render(<TVQuestion roomMagicEnabled tiles={tiles} totalPlayers={3} />);

    expect(screen.getByTestId("tv-house-lights")).toHaveTextContent(
      "2 of 3 locked in",
    );
  });
});
```

- [ ] **Step 2: Run component tests to verify they fail**

Run:

```bash
npx vitest run tests/component/TVHouseLights.test.tsx tests/component/TVQuestionHouseLights.test.tsx
```

Expected: FAIL because `TVHouseLights` and `TVQuestion.roomMagicEnabled` are not implemented.

- [ ] **Step 3: Implement `TVHouseLights`**

Create `components/tv/TVHouseLights.tsx`:

```tsx
"use client";

import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import { deriveHouseLightsPresence } from "@/lib/room-magic/house-lights";

export interface TVHouseLightsProps {
  roomMagicEnabled: boolean;
  lockedCount: number | null | undefined;
  totalPlayers: number | null | undefined;
  accent: string;
}

const INTENSITY_OPACITY = {
  idle: 0.12,
  low: 0.18,
  medium: 0.28,
  high: 0.38,
} as const;

export function TVHouseLights({
  roomMagicEnabled,
  lockedCount,
  totalPlayers,
  accent,
}: TVHouseLightsProps) {
  const reducedMotion = usePrefersReducedMotion();
  const presence = deriveHouseLightsPresence({
    roomMagicEnabled,
    lockedCount,
    totalPlayers,
  });

  if (!presence) return null;

  const opacity = INTENSITY_OPACITY[presence.intensity];
  const animation = reducedMotion
    ? "none"
    : "tr1via-house-lights-breathe 2.4s ease-in-out infinite";

  return (
    <div
      aria-hidden="true"
      data-reduced-motion={String(reducedMotion)}
      data-testid="tv-house-lights"
      style={{
        position: "absolute",
        inset: 12,
        borderRadius: 24,
        pointerEvents: "none",
        zIndex: 0,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} 24%, transparent), inset 0 0 58px color-mix(in srgb, ${accent} ${Math.round(opacity * 100)}%, transparent)`,
        opacity: presence.lockedCount === 0 ? 0.62 : 1,
        animation,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "5%",
          right: "5%",
          bottom: 10,
          height: 5,
          borderRadius: 999,
          background: "rgba(255,255,255,.10)",
          overflow: "hidden",
        }}
      >
        <div
          data-testid="tv-house-lights-fill"
          style={{
            width: `${presence.progressPct}%`,
            height: "100%",
            borderRadius: 999,
            background: accent,
            transition: reducedMotion ? "none" : "width .32s ease",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: "5%",
          bottom: 22,
          color: "rgba(244,230,196,.74)",
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: 0,
          textTransform: "uppercase",
        }}
      >
        {presence.lockedCount} of {presence.totalPlayers} locked in
      </div>
      <style>{`
        @keyframes tr1via-house-lights-breathe {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(1.16); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-testid="tv-house-lights"] {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
```

Modify `components/tv/index.ts`:

```ts
export { TVHouseLights } from "./TVHouseLights";
export type { TVHouseLightsProps } from "./TVHouseLights";
```

- [ ] **Step 4: Integrate into `TVQuestion`**

In `components/tv/TVQuestion.tsx`, add the import:

```ts
import { TVHouseLights } from "@/components/tv/TVHouseLights";
```

Extend `TVQuestionProps`:

```ts
  /** Room Magic House Lights are cosmetic aggregate lock-in presence. */
  roomMagicEnabled?: boolean;
  /** Optional deduped count from live answers; falls back to tile count. */
  houseLightsLockedCount?: number;
```

Destructure the prop in `TVQuestionInner`:

```ts
  roomMagicEnabled = false,
  houseLightsLockedCount,
```

After `lockedIn` is derived, add:

```ts
  const houseLightsLockedIn = houseLightsLockedCount ?? lockedIn;
```

Render `TVHouseLights` as the first child inside `TVStage`, before `TVHeader`:

```tsx
      <TVHouseLights
        roomMagicEnabled={roomMagicEnabled}
        lockedCount={houseLightsLockedIn}
        totalPlayers={denominator}
        accent={cc}
      />
```

- [ ] **Step 5: Pass Room Magic state from `TVStateMachine`**

In `components/tv/TVStateMachine.tsx`, import the lock-count helper:

```ts
import { countHouseLightsLocks } from "@/lib/room-magic/house-lights";
```

Inside `TVQuestionView`, after `lockedAnswers` is defined, add:

```ts
  const houseLightsLockedCount = countHouseLightsLocks(
    lockedAnswers,
    question.id,
  );
```

Pass to `TVQuestion`:

```tsx
        roomMagicEnabled={snapshot.night.roomMagicEnabled}
        houseLightsLockedCount={houseLightsLockedCount}
        tiles={tiles}
        totalPlayers={snapshot.players.length}
```

Keep `tiles={tiles}` and `totalPlayers={snapshot.players.length}` unchanged. House Lights reads the deduped `houseLightsLockedCount`; the existing pile continues to render from `tiles`.

- [ ] **Step 6: Run tests to verify TV/host slice**

Run:

```bash
npx vitest run tests/unit/room-magic-house-lights.test.ts tests/component/TVHouseLights.test.tsx tests/component/TVQuestionHouseLights.test.tsx tests/component/HostLiveRoomMagicOverlay.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add components/tv/TVHouseLights.tsx components/tv/index.ts components/tv/TVQuestion.tsx components/tv/TVStateMachine.tsx tests/component/TVHouseLights.test.tsx tests/component/TVQuestionHouseLights.test.tsx
git commit -m "feat: add house lights to room magic TV"
```

---

### Task 3: Player Locked-State Confirmation and Reduced Motion

**Files:**
- Modify: `components/player/PlayerLocked.tsx`
- Modify: `tests/unit/player-locked-live-count.test.tsx`

**Interfaces:**
- Consumes: existing `PlayerLockedProps.roomMagicEnabled`
- Produces: `data-testid="player-house-lights-confirmation"`
- Produces: reduced-motion suppression for pulse animations on `PlayerLocked`

- [ ] **Step 1: Write failing player tests**

Modify `tests/unit/player-locked-live-count.test.tsx` to mock reduced motion and add assertions:

```tsx
import { describe, it, expect, vi } from "vitest";
```

Add after imports:

```tsx
let reducedMotion = false;

vi.mock("@/lib/hooks/usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => reducedMotion,
}));
```

Add tests:

```tsx
  it("marks the Room Magic confirmation with a stable test id", () => {
    render(wrap(<PlayerLocked lockedCount={12} totalPlayers={18} roomMagicEnabled />));

    expect(screen.getByTestId("player-house-lights-confirmation")).toHaveTextContent(
      "Sent to the room.",
    );
  });

  it("suppresses pulse animation in reduced motion mode", () => {
    reducedMotion = true;
    render(wrap(<PlayerLocked lockedCount={12} totalPlayers={18} roomMagicEnabled />));

    expect(screen.getByTestId("player-lockin-pulse-dot")).toHaveStyle({
      animation: "none",
    });
    expect(screen.getByTestId("player-waiting-pulse-dot")).toHaveStyle({
      animation: "none",
    });
    reducedMotion = false;
  });
```

- [ ] **Step 2: Run player tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/player-locked-live-count.test.tsx
```

Expected: FAIL because the new test IDs and reduced-motion behavior are missing.

- [ ] **Step 3: Implement player locked-state hardening**

In `components/player/PlayerLocked.tsx`, import the hook:

```ts
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
```

Inside `PlayerLocked`, after `const { t } = useTheme();`, add:

```ts
  const reducedMotion = usePrefersReducedMotion();
  const pulseAnimation = reducedMotion
    ? "none"
    : "tr1via-pulse 1.4s ease-in-out infinite";
```

For the live lock-in dot, add the test ID and use `pulseAnimation`:

```tsx
            <span
              data-testid="player-lockin-pulse-dot"
              style={{
                width: 6,
                height: 6,
                borderRadius: 99,
                background: catColor,
                animation: pulseAnimation,
              }}
            />
```

For the Room Magic confirmation, add a stable test ID and live region:

```tsx
          <div
            aria-live="polite"
            data-testid="player-house-lights-confirmation"
            style={{
              marginBottom: 8,
              color: t.ink,
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            Sent to the room.
          </div>
```

For the waiting dot, add the test ID and use `pulseAnimation`:

```tsx
          <span
            data-testid="player-waiting-pulse-dot"
            style={{
              width: 5,
              height: 5,
              borderRadius: 99,
              background: catColor,
              animation: pulseAnimation,
            }}
          />
```

- [ ] **Step 4: Run player tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/player-locked-live-count.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add components/player/PlayerLocked.tsx tests/unit/player-locked-live-count.test.tsx
git commit -m "feat: harden room magic player lock state"
```

---

### Task 4: Deterministic Room Magic Validation Harness

**Files:**
- Create: `tests/e2e/room-magic-house-lights.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing E2E helpers `loginAsHost`, `seedNight`, `openHostLive`, `startGame`, `revealViaApi`, `fastForwardTimer`, `joinPhone`, `awaitReveal`, `openTV`, `waitForQuestionOnTV`, `waitForRevealOnTV`
- Produces: `npm run validate:room-magic`
- Produces: screenshots and `test-results/room-magic-house-lights/summary.json`

- [ ] **Step 1: Write the failing Playwright rehearsal**

Create `tests/e2e/room-magic-house-lights.spec.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  fastForwardTimer,
  listQuestionsInCategory,
  loginAsHost,
  openHostLive,
  resetTestData,
  revealViaApi,
  seedNight,
  startGame,
  type SeededNight,
} from "./helpers/host-laptop";
import { awaitReveal, joinPhone } from "./helpers/player-phone";
import { TID } from "./helpers/selectors";
import { openTV, waitForQuestionOnTV, waitForRevealOnTV } from "./helpers/tv";

test.describe.configure({ mode: "serial" });

const ARTIFACT_DIR = path.join(
  process.cwd(),
  "test-results",
  "room-magic-house-lights",
);
const PLAYERS = ["Alex", "Brooke", "Casey"] as const;
const HOUSE_LIGHTS = "tv-house-lights";
const PLAYER_CONFIRMATION = "player-house-lights-confirmation";

type ScoreRow = {
  display_name: string;
  score: number;
  correct_count: number;
  answered_count: number;
};

type RehearsalResult = {
  label: string;
  scores: Record<string, ScoreRow>;
  screenshots: string[];
};

test.describe("room magic house lights validation", () => {
  test.setTimeout(240_000);

  let host: BrowserContext;
  let tv: BrowserContext;
  let p1: BrowserContext;
  let p2: BrowserContext;
  let p3: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    host = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    tv = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    p1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    p2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    p3 = await browser.newContext({ viewport: { width: 390, height: 844 } });

    const cleanup = await host.newPage();
    await resetTestData(cleanup);
    await cleanup.close();
  });

  test.afterAll(async () => {
    try {
      if (host) {
        const cleanup = await host.newPage();
        await resetTestData(cleanup);
        await cleanup.close();
      }
    } catch {
      // Cleanup is best-effort; assertions already failed if the rehearsal broke.
    }
    await Promise.all(
      [host, tv, p1, p2, p3]
        .filter((c): c is BrowserContext => c !== undefined)
        .map((c) => c.close().catch(() => {})),
    );
  });

  test("proves Classic off, Room Magic on, screenshots, console health, and scoring parity", async () => {
    const hostPage = await host.newPage();
    const tvPage = await tv.newPage();
    const phone1 = await p1.newPage();
    const phone2 = await p2.newPage();
    const phone3 = await p3.newPage();

    const consoleErrors = collectConsoleErrors([
      hostPage,
      tvPage,
      phone1,
      phone2,
      phone3,
    ]);

    const { hostId } = await loginAsHost(
      hostPage,
      `house-lights-${Date.now()}@tr1via.test`,
    );

    const classicSeed = await seedNight(hostPage, hostId);
    const classic = await runLockInRehearsal({
      label: "classic-off",
      hostPage,
      tvPage,
      phones: [phone1, phone2, phone3],
      seed: classicSeed,
      expectHouseLights: false,
    });

    const magicSeed = await seedNight(hostPage, hostId, {
      roomMagicEnabled: true,
    });
    const magic = await runLockInRehearsal({
      label: "room-magic-on",
      hostPage,
      tvPage,
      phones: [phone1, phone2, phone3],
      seed: magicSeed,
      expectHouseLights: true,
    });

    expect(magic.scores).toEqual(classic.scores);
    expect(consoleErrors).toEqual([]);

    writeFileSync(
      path.join(ARTIFACT_DIR, "summary.json"),
      JSON.stringify(
        {
          classicDisabledUnchanged: true,
          roomMagicEnabledHouseLightsVisible: true,
          scoresMatched: true,
          consoleErrors,
          screenshots: [...classic.screenshots, ...magic.screenshots],
        },
        null,
        2,
      ),
    );
  });
});

async function runLockInRehearsal({
  label,
  hostPage,
  tvPage,
  phones,
  seed,
  expectHouseLights,
}: {
  label: string;
  hostPage: Page;
  tvPage: Page;
  phones: Page[];
  seed: SeededNight;
  expectHouseLights: boolean;
}): Promise<RehearsalResult> {
  const screenshots: string[] = [];
  const questionId = firstQuestionId(seed);

  await openTV(tvPage, seed.roomCode);
  await Promise.all(
    phones.map((phone, index) => joinPhone(phone, seed.roomCode, PLAYERS[index])),
  );
  await openHostLive(hostPage, seed.nightId);
  await startGame(hostPage, seed.game1.id);
  await revealViaApi(hostPage, seed.game1.id, questionId);

  await Promise.all([
    waitForQuestionOnTV(tvPage, 10_000),
    expect(hostPage.getByTestId(TID.tvQuestion.root)).toBeVisible({
      timeout: 10_000,
    }),
    ...phones.map((phone) =>
      expect(phone.getByTestId(TID.playerQuestion.root)).toBeVisible({
        timeout: 10_000,
      }),
    ),
  ]);

  await Promise.all([
    tapAnswerByText(phones[0], "Alpha"),
    tapAnswerByText(phones[1], "Bravo"),
    tapAnswerByText(phones[2], "Alpha"),
  ]);

  if (expectHouseLights) {
    await expect(tvPage.getByTestId(HOUSE_LIGHTS)).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      hostPage.getByTestId("host-tv-panel").getByTestId(HOUSE_LIGHTS),
    ).toBeVisible({ timeout: 10_000 });
    await expect(phones[0].getByTestId(PLAYER_CONFIRMATION)).toBeVisible();
  } else {
    await expect(tvPage.getByTestId(HOUSE_LIGHTS)).toHaveCount(0);
    await expect(
      hostPage.getByTestId("host-tv-panel").getByTestId(HOUSE_LIGHTS),
    ).toHaveCount(0);
    await expect(phones[0].getByTestId(PLAYER_CONFIRMATION)).toHaveCount(0);
  }

  screenshots.push(await screenshot(tvPage, `${label}-tv-question`));
  screenshots.push(await screenshot(hostPage, `${label}-host-question`));
  screenshots.push(await screenshot(phones[0], `${label}-phone-question`));

  await fastForwardTimer(hostPage, questionId);
  await Promise.all([
    waitForRevealOnTV(tvPage, 10_000),
    ...phones.map((phone) => awaitReveal(phone, 10_000)),
  ]);

  const scores = await scoresByName(tvPage, seed.roomCode, PLAYERS);
  screenshots.push(await screenshot(tvPage, `${label}-tv-reveal`));

  return { label, scores, screenshots };
}

function firstQuestionId(seed: SeededNight): string {
  const category = seed.categories[0];
  if (!category) throw new Error("seed did not include any categories");
  const questionId = listQuestionsInCategory(seed, category.id)[0];
  if (!questionId) throw new Error("seed did not include a first question");
  return questionId;
}

async function tapAnswerByText(page: Page, answer: string): Promise<void> {
  const button = page.getByRole("button", {
    name: new RegExp(`\\b${answer}\\b`),
  });
  await expect(button).toBeVisible({ timeout: 5_000 });
  await button.click();
  await expect(page.getByTestId(TID.playerLocked.root)).toBeVisible({
    timeout: 3_000,
  });
}

async function scoresByName(
  page: Page,
  roomCode: string,
  names: readonly string[],
): Promise<Record<string, ScoreRow>> {
  let result: Record<string, ScoreRow> | null = null;
  await expect(async () => {
    const res = await page.request.get(`/api/tv/${roomCode}/snapshot`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { scores: ScoreRow[] };
    const byName = new Map(body.scores.map((row) => [row.display_name, row]));
    result = Object.fromEntries(
      names.map((name) => {
        const row = byName.get(name);
        expect(row, `missing score row for ${name}`).toBeTruthy();
        return [name, row!];
      }),
    );
  }).toPass({ timeout: 10_000 });

  if (!result) throw new Error("score snapshot did not settle");
  return result;
}

async function screenshot(page: Page, name: string): Promise<string> {
  const file = path.join(ARTIFACT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

function collectConsoleErrors(pages: Page[]): string[] {
  const errors: string[] = [];
  for (const page of pages) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (error) => {
      errors.push(error.message);
    });
  }
  return errors;
}
```

- [ ] **Step 2: Add the package script**

Modify `package.json`:

```json
"validate:room-magic": "playwright test tests/e2e/room-magic-house-lights.spec.ts --reporter=list"
```

- [ ] **Step 3: Run the rehearsal to verify it fails before UI implementation**

Run:

```bash
npm run validate:room-magic
```

Expected before Tasks 2 and 3 are implemented: FAIL because `tv-house-lights` and `player-house-lights-confirmation` do not exist.

- [ ] **Step 4: Run the rehearsal after Tasks 2 and 3**

Run:

```bash
npm run validate:room-magic
```

Expected after Tasks 2 and 3 are implemented: PASS and `test-results/room-magic-house-lights/summary.json` exists with `scoresMatched: true` and `consoleErrors: []`.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add package.json tests/e2e/room-magic-house-lights.spec.ts
git commit -m "test: add room magic house lights rehearsal"
```

---

### Task 5: Final Verification and PR Readiness

**Files:**
- No new files expected.
- Review changed files from Tasks 1-4.

**Interfaces:**
- Consumes: every task commit.
- Produces: verification evidence for PR review.

- [ ] **Step 1: Run focused unit and component tests**

Run:

```bash
npx vitest run tests/unit/room-magic-house-lights.test.ts tests/unit/player-locked-live-count.test.tsx tests/component/TVHouseLights.test.tsx tests/component/TVQuestionHouseLights.test.tsx tests/component/TVRoomMagicOverlay.test.tsx tests/component/HostLiveRoomMagicOverlay.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the reusable Room Magic validation command**

Run:

```bash
npm run validate:room-magic
```

Expected: PASS, screenshots saved under `test-results/room-magic-house-lights/`, and `summary.json` reports:

```json
{
  "classicDisabledUnchanged": true,
  "roomMagicEnabledHouseLightsVisible": true,
  "scoresMatched": true,
  "consoleErrors": []
}
```

- [ ] **Step 3: Run existing Room Magic E2E**

Run:

```bash
npm run test:e2e -- tests/e2e/room-magic.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Run reveal-sync regression if TV or live-state paths changed**

Run:

```bash
npm run test:e2e -- tests/e2e/reveal-sync.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Run full unit/component/integration suite**

Run:

```bash
npm test
```

Expected: PASS. Existing harmless jsdom canvas warnings may appear.

- [ ] **Step 6: Run TypeScript check**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS or only the known pre-existing `HostHomeClient-founder-build.test.tsx` baseline errors documented in `AGENTS.md`. Any new House Lights error must be fixed before PR.

- [ ] **Step 7: Inspect changed paths for forbidden scope**

Run:

```bash
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
```

Expected changed path classes only:

```text
components/player/
components/tv/
lib/room-magic/
tests/unit/
tests/component/
tests/e2e/
package.json
```

Forbidden changed path classes:

```text
supabase/migrations/
app/api/answers/
app/api/questions/
lib/supabase/types.ts
lib/api/broadcast.ts
```

- [ ] **Step 8: Run reviewer agents before PR**

Dispatch:

```text
critic: review the actual diff for regressions, scope creep, and malformed state handling.
validator: verify command evidence, screenshots, and result summary prove disabled Classic, enabled Room Magic, all surfaces, no console errors, and scoring parity.
```

Expected: critic PASS and validator DONE. Any finding with a file/line citation must be fixed or explicitly accepted by Brandon.

- [ ] **Step 9: Commit verification note if needed**

If the validation command or tests required a small cleanup fix, commit it:

```bash
git status -sb
git add components/player/PlayerLocked.tsx components/tv/TVHouseLights.tsx components/tv/TVQuestion.tsx components/tv/TVStateMachine.tsx lib/room-magic/house-lights.ts package.json tests/unit/room-magic-house-lights.test.ts tests/unit/player-locked-live-count.test.tsx tests/component/TVHouseLights.test.tsx tests/component/TVQuestionHouseLights.test.tsx tests/e2e/room-magic-house-lights.spec.ts
git commit -m "fix: stabilize house lights validation"
```

Expected: no uncommitted implementation changes remain except generated `test-results/` artifacts, which should not be committed unless the repo already tracks them intentionally. If `git status -sb` shows a different source file than the exact list above, inspect it before staging.

---

## Merge and Release Gates

Do not merge to `main` until all of these are true:

- `npm run validate:room-magic` passes and produces screenshots plus `summary.json`.
- Existing Room Magic E2E passes.
- Relevant reveal-sync/full-game regression passes when touched paths affect live state.
- `npm test` passes.
- `npx tsc --noEmit` has no new House Lights errors.
- Critic and validator agents pass on the actual diff.
- No production database change file exists in the diff.
- Room Magic stays default-off for existing nights.
- Brandon approves the merge.

Do not deploy manually unless Brandon explicitly approves deployment.

## Rollback Plan

- Behavior rollback: turn Room Magic off for affected nights.
- Code rollback: revert the House Lights app PR.
- No database rollback is expected because this plan does not add schema.

## Self-Review

- Spec coverage: Tasks 1-4 cover no-DB derivation, TV/host House Lights, player confirmation, reduced motion, failure hiding, and hands-off validation.
- Placeholder scan: no incomplete markers remain.
- Type consistency: `deriveHouseLightsPresence`, `countHouseLightsLocks`, `TVHouseLights`, `roomMagicEnabled`, `tv-house-lights`, and `player-house-lights-confirmation` are named consistently.
- Scope check: this is one implementation plan for one bounded packet; future Room Magic packets can reuse the validation command.
