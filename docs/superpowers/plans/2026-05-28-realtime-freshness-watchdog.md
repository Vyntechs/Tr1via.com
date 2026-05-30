# Realtime Freshness Watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-recover the host's silently-dead realtime connection (the zombie WebSocket after laptop sleep that froze the first host's show for 215s) by watching data freshness + a wake-from-sleep gap and forcing a brand-new socket — host only.

**Architecture:** Add a 4th defensive layer to `useRoom`, active only on host surfaces (`deviceId === undefined`). A pure decision function (`evaluateFreshness`) is wrapped by a small interval hook (`useFreshnessWatchdog`); when it fires, `useRoom` drops the WebSocket transport (`realtime.disconnect()` + `connect()`) and re-bootstraps. A small host banner shows "Reconnecting…" via the existing `channelHealth` singleton. Never auto-reloads.

**Tech Stack:** TypeScript, React hooks, `@supabase/realtime-js` 2.106.1 (via `@supabase/supabase-js`), vitest + `@testing-library/react`.

**Confirmed library behavior (RealtimeClient.js 2.106.1):** `disconnect()` (async) closes the socket but does NOT unsubscribe/teardown channels — `this.channels` stays intact (lines 246-255, 270-291). `connect()` opens a fresh socket and registered channels rejoin (lines 195-228). So drop-then-reconnect heals a zombie socket and the host console's other channels (`host-scores`, `host-answers`) rejoin on the new socket.

**Deliberate deviation from spec:** No randomized jitter before recovery. The spec noted jitter only "future-proofs if extended to phones" and is "harmless at one host." Because this layer is host-only (exactly one client, O(1)), a stampede is impossible and jitter would only *delay* a frozen host's recovery. Jitter is the documented extension point if the layer is ever extended to phones.

**Tuning rationale (from show data):** Normal pauses between questions reached 64s in Game 1 (median 22s). So the silence backstop `STALE_MS = 90_000` sits above any legitimate pause to avoid false "Reconnecting…" flashes, while still catching a >90s zombie. The fast path is the sleep-gap detector (`SLEEP_GAP_MS = 5_000`), which catches wake-from-sleep within ~1s — that is what actually broke the show.

---

## File Structure

- **Create** `lib/realtime/freshnessWatchdog.ts` — pure decision logic + tuning constants. No React, no I/O. Fully unit-tested.
- **Create** `lib/hooks/useFreshnessWatchdog.ts` — interval hook: runs `evaluateFreshness` once per second, owns the in-flight lock + cooldown, calls `onRecover`. Host-gated by an `enabled` flag.
- **Create** `components/host/HostConnectionBanner.tsx` — reads `useChannelHealth()`, shows a calm "Reconnecting — your game is safe" banner when unhealthy.
- **Modify** `lib/realtime/channelHealth.ts` — add a non-hook `getChannelHealth()` getter so the watchdog can read status without subscribing.
- **Modify** `lib/hooks/useRoom.ts` — add `lastMessageAtRef` + `markFresh()` calls in every receive handler; instantiate `useFreshnessWatchdog` with the host-only `onRecover` (drop+rebuild transport, re-bootstrap); add `watchdogTick` to the main effect dep array.
- **Modify** `app/host/live/[nightId]/HostLiveConsoleClient.tsx` — mount `<HostConnectionBanner />`.
- **Test** `tests/unit/freshnessWatchdog.test.ts`, `tests/unit/useFreshnessWatchdog.test.tsx`, `tests/unit/HostConnectionBanner.test.tsx`.

---

### Task 1: Pure freshness decision logic

**Files:**
- Create: `lib/realtime/freshnessWatchdog.ts`
- Test: `tests/unit/freshnessWatchdog.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/freshnessWatchdog.test.ts
import { describe, it, expect } from "vitest";
import {
  evaluateFreshness,
  STALE_MS,
  SLEEP_GAP_MS,
} from "@/lib/realtime/freshnessWatchdog";

const base = {
  now: 1_000_000,
  lastMessageAt: 1_000_000,
  lastTickAt: 1_000_000 - 1_000, // a normal 1s tick ago
  subscribed: true,
  visible: true,
};

describe("evaluateFreshness", () => {
  it("does nothing when messages are flowing and ticks are on time", () => {
    expect(evaluateFreshness(base)).toEqual({ stale: false, slept: false, shouldRecover: true && false });
  });

  it("flags stale when subscribed but silent past STALE_MS", () => {
    const v = evaluateFreshness({ ...base, lastMessageAt: base.now - (STALE_MS + 1) });
    expect(v.stale).toBe(true);
    expect(v.shouldRecover).toBe(true);
  });

  it("does NOT flag stale when not subscribed (channel-error layer owns that)", () => {
    const v = evaluateFreshness({ ...base, subscribed: false, lastMessageAt: base.now - (STALE_MS + 1) });
    expect(v.stale).toBe(false);
    expect(v.shouldRecover).toBe(false);
  });

  it("flags slept when a tick lands far later than expected AND tab is visible", () => {
    const v = evaluateFreshness({ ...base, lastTickAt: base.now - (SLEEP_GAP_MS + 1) });
    expect(v.slept).toBe(true);
    expect(v.shouldRecover).toBe(true);
  });

  it("does NOT flag slept when the tab is hidden (background timer throttling, not real sleep)", () => {
    const v = evaluateFreshness({ ...base, visible: false, lastTickAt: base.now - (SLEEP_GAP_MS + 1) });
    expect(v.slept).toBe(false);
    expect(v.shouldRecover).toBe(false);
  });

  it("respects custom thresholds", () => {
    const v = evaluateFreshness({ ...base, lastMessageAt: base.now - 50, staleMs: 40, subscribed: true });
    expect(v.stale).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/freshnessWatchdog.test.ts`
Expected: FAIL — `Cannot find module '@/lib/realtime/freshnessWatchdog'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/realtime/freshnessWatchdog.ts
// Pure decision logic for the realtime freshness watchdog (the 4th defense
// layer in useRoom). No React, no I/O — just "given these timings, should we
// rebuild the connection?" so it can be unit-tested in isolation.
//
// Two independent signals:
//   - stale:  channels claim SUBSCRIBED but no realtime message has arrived
//             for STALE_MS. Catches a zombie socket with no detectable sleep.
//   - slept:  a watchdog tick fired far later than its interval WHILE the tab
//             is in the foreground => the machine slept with the tab in front
//             (the exact case visibilitychange/online never fire for).

/** Watchdog tick cadence. */
export const WATCHDOG_INTERVAL_MS = 1_000;
/** Silence backstop. Above the longest legitimate between-question pause seen
 *  in show data (64s in Game 1) so a normal lull never triggers recovery. */
export const STALE_MS = 90_000;
/** A tick this much later than WATCHDOG_INTERVAL_MS means the machine slept. */
export const SLEEP_GAP_MS = 5_000;
/** Minimum time between two hard reconnects, so a rebuild can't loop. */
export const HARD_RECONNECT_COOLDOWN_MS = 10_000;

export interface FreshnessInput {
  /** Epoch ms "now". */
  now: number;
  /** Epoch ms of the last RECEIVED realtime event (broadcast or db change). */
  lastMessageAt: number;
  /** Epoch ms of the previous watchdog tick. */
  lastTickAt: number;
  /** True if our channels currently report SUBSCRIBED. */
  subscribed: boolean;
  /** True if document.visibilityState === "visible". */
  visible: boolean;
  /** Override for tests. Defaults to STALE_MS. */
  staleMs?: number;
  /** Override for tests. Defaults to SLEEP_GAP_MS. */
  sleepGapMs?: number;
}

export interface FreshnessVerdict {
  stale: boolean;
  slept: boolean;
  shouldRecover: boolean;
}

export function evaluateFreshness(input: FreshnessInput): FreshnessVerdict {
  const staleMs = input.staleMs ?? STALE_MS;
  const sleepGapMs = input.sleepGapMs ?? SLEEP_GAP_MS;
  const slept = input.visible && input.now - input.lastTickAt > sleepGapMs;
  const stale = input.subscribed && input.now - input.lastMessageAt > staleMs;
  return { stale, slept, shouldRecover: stale || slept };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/freshnessWatchdog.test.ts`
Expected: PASS (6 tests). Note: the first test's expected value `true && false` is intentionally written to read as `false` — adjust to `false` if your linter objects.

- [ ] **Step 5: Commit**

```bash
git add lib/realtime/freshnessWatchdog.ts tests/unit/freshnessWatchdog.test.ts
git commit -m "feat(realtime): pure freshness-watchdog decision logic + thresholds"
```

---

### Task 2: The interval hook (lock + cooldown + host gate)

**Files:**
- Create: `lib/hooks/useFreshnessWatchdog.ts`
- Test: `tests/unit/useFreshnessWatchdog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/useFreshnessWatchdog.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFreshnessWatchdog } from "@/lib/hooks/useFreshnessWatchdog";
import { STALE_MS } from "@/lib/realtime/freshnessWatchdog";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function args(overrides: Partial<Parameters<typeof useFreshnessWatchdog>[0]> = {}) {
  return {
    enabled: true,
    // Far in the past => stale path triggers on the first tick.
    getLastMessageAt: () => Date.now() - (STALE_MS + 10_000),
    getSubscribed: () => true,
    onRecover: vi.fn(),
    ...overrides,
  };
}

describe("useFreshnessWatchdog", () => {
  it("calls onRecover once when stale, then respects the cooldown", () => {
    const onRecover = vi.fn();
    renderHook(() => useFreshnessWatchdog(args({ onRecover })));
    vi.advanceTimersByTime(1_000); // first tick: stale -> recover
    expect(onRecover).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3_000); // still inside the 10s cooldown
    expect(onRecover).toHaveBeenCalledTimes(1);
  });

  it("never fires when disabled (player surface)", () => {
    const onRecover = vi.fn();
    renderHook(() => useFreshnessWatchdog(args({ enabled: false, onRecover })));
    vi.advanceTimersByTime(60_000);
    expect(onRecover).not.toHaveBeenCalled();
  });

  it("does not fire while fresh", () => {
    const onRecover = vi.fn();
    renderHook(() =>
      useFreshnessWatchdog(args({ onRecover, getLastMessageAt: () => Date.now() })),
    );
    vi.advanceTimersByTime(5_000);
    expect(onRecover).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/useFreshnessWatchdog.test.tsx`
Expected: FAIL — `Cannot find module '@/lib/hooks/useFreshnessWatchdog'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/hooks/useFreshnessWatchdog.ts
// The realtime freshness watchdog (4th layer). Runs a 1s interval that asks
// evaluateFreshness "should we rebuild the connection?" and, if so, calls
// onRecover — guarded by an in-flight lock and a cooldown so a rebuild can
// never loop or double-fire with useRoom's existing reconnect paths.
//
// Host-only: useRoom passes `enabled = (deviceId === undefined)`. Players keep
// their existing three layers untouched, so this change cannot affect them.

"use client";

import { useEffect, useRef } from "react";
import {
  evaluateFreshness,
  WATCHDOG_INTERVAL_MS,
  HARD_RECONNECT_COOLDOWN_MS,
} from "@/lib/realtime/freshnessWatchdog";

export interface FreshnessWatchdogArgs {
  /** Run the watchdog only when true (host surfaces with a room code). */
  enabled: boolean;
  /** Latest epoch ms of a received realtime event. */
  getLastMessageAt: () => number;
  /** Whether channels currently report SUBSCRIBED. */
  getSubscribed: () => boolean;
  /** Drop + rebuild the transport and re-bootstrap. May be async. */
  onRecover: () => void | Promise<void>;
}

export function useFreshnessWatchdog({
  enabled,
  getLastMessageAt,
  getSubscribed,
  onRecover,
}: FreshnessWatchdogArgs): void {
  const lastTickAtRef = useRef(0);
  const lastRecoverAtRef = useRef(0);
  const recoveringRef = useRef(false);
  // Hold the latest callbacks so the interval never has to re-arm on re-render.
  const cbRef = useRef({ getLastMessageAt, getSubscribed, onRecover });
  cbRef.current = { getLastMessageAt, getSubscribed, onRecover };

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    lastTickAtRef.current = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const verdict = evaluateFreshness({
        now,
        lastMessageAt: cbRef.current.getLastMessageAt(),
        lastTickAt: lastTickAtRef.current,
        subscribed: cbRef.current.getSubscribed(),
        visible: document.visibilityState === "visible",
      });
      lastTickAtRef.current = now;
      if (!verdict.shouldRecover) return;
      if (recoveringRef.current) return;
      if (now - lastRecoverAtRef.current < HARD_RECONNECT_COOLDOWN_MS) return;
      recoveringRef.current = true;
      lastRecoverAtRef.current = now;
      Promise.resolve(cbRef.current.onRecover()).finally(() => {
        recoveringRef.current = false;
      });
    }, WATCHDOG_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/useFreshnessWatchdog.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/hooks/useFreshnessWatchdog.ts tests/unit/useFreshnessWatchdog.test.tsx
git commit -m "feat(realtime): interval watchdog hook with in-flight lock + cooldown"
```

---

### Task 3: Host "Reconnecting…" banner

**Files:**
- Create: `components/host/HostConnectionBanner.tsx`
- Test: `tests/unit/HostConnectionBanner.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/HostConnectionBanner.test.tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { HostConnectionBanner } from "@/components/host/HostConnectionBanner";
import { setChannelHealth, __resetChannelHealthForTests } from "@/lib/realtime/channelHealth";

afterEach(() => {
  cleanup();
  __resetChannelHealthForTests();
});

describe("HostConnectionBanner", () => {
  it("renders nothing when healthy", () => {
    setChannelHealth("SUBSCRIBED");
    render(<HostConnectionBanner />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the reconnecting message when the channel is unhealthy", () => {
    setChannelHealth("CHANNEL_ERROR");
    render(<HostConnectionBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(/reconnecting/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/HostConnectionBanner.test.tsx`
Expected: FAIL — `Cannot find module '@/components/host/HostConnectionBanner'`.

- [ ] **Step 3: Write the implementation**

```tsx
// components/host/HostConnectionBanner.tsx
// Calm, non-intrusive "Reconnecting…" banner for the HOST live console.
// Reads the shared channelHealth signal (set by useRoom's subscribe callbacks
// and by the freshness watchdog's recovery). Never reloads the page — Option A.

"use client";

import { useChannelHealth } from "@/lib/realtime/channelHealth";

const UNHEALTHY = new Set(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);

export function HostConnectionBanner() {
  const health = useChannelHealth();
  if (!health || !UNHEALTHY.has(health)) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full bg-amber-500/90 px-4 py-1.5 text-sm font-medium text-black shadow-lg"
    >
      Reconnecting — your game is safe
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/HostConnectionBanner.test.tsx`
Expected: PASS (2 tests). If `toHaveTextContent` is unavailable, ensure `@testing-library/jest-dom` is imported in the test setup (it is used by existing component tests).

- [ ] **Step 5: Commit**

```bash
git add components/host/HostConnectionBanner.tsx tests/unit/HostConnectionBanner.test.tsx
git commit -m "feat(host): calm Reconnecting banner driven by channel health"
```

---

### Task 4: Add a non-hook channel-health getter

**Files:**
- Modify: `lib/realtime/channelHealth.ts` (add export after `useChannelHealth`)

- [ ] **Step 1: Add the getter**

```ts
// Add below useChannelHealth() in lib/realtime/channelHealth.ts:

/** Non-hook read of the latest channel status. Used by the freshness
 *  watchdog, which needs the current value inside a setInterval without
 *  subscribing as a React hook. */
export function getChannelHealth(): string | undefined {
  return currentState;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 3: Commit**

```bash
git add lib/realtime/channelHealth.ts
git commit -m "feat(realtime): non-hook getChannelHealth() getter for the watchdog"
```

---

### Task 5: Wire freshness tracking + recovery into useRoom

**Files:**
- Modify: `lib/hooks/useRoom.ts` (imports; new refs/hook near line 156; `markFresh()` in receive handlers; dep array at line 638)

- [ ] **Step 1: Add imports**

At the top of `lib/hooks/useRoom.ts`, alongside the existing imports:

```ts
import { setChannelHealth, getChannelHealth } from "@/lib/realtime/channelHealth";
import { useFreshnessWatchdog } from "@/lib/hooks/useFreshnessWatchdog";
```

(The file already imports `setChannelHealth`; replace that line so it also imports `getChannelHealth`. It already imports `getSupabaseBrowser`.)

- [ ] **Step 2: Add the watchdog state + hook**

Immediately AFTER the 15s-heartbeat `useEffect` block (just before the main `useEffect` at `useRoom.ts:157`), insert:

```ts
  // ── Layer 4: freshness watchdog (HOST ONLY) ───────────────────────────
  // Layers 1-3 above all trust channel STATUS. None notices a socket that
  // reports SUBSCRIBED but has gone silent — the zombie after laptop sleep
  // that froze the first host's show for 215s. This watches DATA freshness + a
  // wake-from-sleep gap and forces a brand-NEW socket (the one thing the
  // others don't do). Host surfaces omit `deviceId` (see UseRoomArgs); we
  // gate on that so players' phones are completely untouched.
  const isHost = deviceId === undefined;
  const lastMessageAtRef = useRef(Date.now());
  const [watchdogTick, setWatchdogTick] = useState(0);
  useFreshnessWatchdog({
    enabled: isHost && !!roomCode,
    getLastMessageAt: () => lastMessageAtRef.current,
    getSubscribed: () => getChannelHealth() === "SUBSCRIBED",
    onRecover: async () => {
      const supa = getSupabaseBrowser();
      // Show the calm host banner while we rebuild.
      setChannelHealth("CHANNEL_ERROR");
      try {
        // Drop the dead transport. Confirmed (realtime-js 2.106.1): this
        // closes the socket but keeps channels registered, so they rejoin
        // on the new socket — including the host console's own channels.
        await supa.realtime.disconnect();
      } catch {
        // Rebuilding regardless; a throw here just means it was already down.
      }
      supa.realtime.connect();
      // Reset freshness so we don't immediately re-trigger before data resumes.
      lastMessageAtRef.current = Date.now();
      // Re-run the main effect: tears down our 2 channels and re-bootstraps
      // (HTTP refetch of any state missed during the dead window + fresh
      // .subscribe() on the new socket).
      setWatchdogTick((t) => t + 1);
    },
  });
```

- [ ] **Step 3: Stamp freshness on every received event**

Inside the main effect, find the change-handler section (`// ── change handlers ──`, ~`useRoom.ts:543`). Add this helper right after that comment:

```ts
      // Stamp freshness on every received realtime event so the watchdog can
      // tell a live connection from a zombie one.
      function markFresh() {
        lastMessageAtRef.current = Date.now();
      }
```

Then add a `markFresh();` call as the first line (after the `if (cancelled) return;` guard) of EACH of these handlers:
- `mergeBroadcast` (`~:544`)
- `mergePlayerChange` (`~:549`)
- `mergeNightChange` (`~:558`)
- `mergeGameChange` (`~:563`)
- `mergeCategoryChange` (`~:570`)
- `mergeQuestionChange` (`~:581`)
- `mergeRevealChange` (`~:619`)

Example (mergeBroadcast):

```ts
      function mergeBroadcast(tag: BroadcastTag) {
        if (cancelled) return;
        markFresh();
        setSnapshot((prev) => ({ ...prev, lastBroadcast: tag }));
      }
```

- [ ] **Step 4: Add `watchdogTick` to the main effect dependency array**

Change the dep array at `useRoom.ts:638` from:

```ts
  }, [roomCode, waitingForDevice, revalidateTick, reconnectCounter, heartbeatTick]);
```

to:

```ts
  }, [roomCode, waitingForDevice, revalidateTick, reconnectCounter, heartbeatTick, watchdogTick]);
```

- [ ] **Step 5: Typecheck + full unit suite (no regressions)**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; vitest green — the existing suite still passes and the 11 new tests (Tasks 1-3) pass.

- [ ] **Step 6: Commit**

```bash
git add lib/hooks/useRoom.ts
git commit -m "feat(host): wire freshness watchdog into useRoom — host-only zombie-socket recovery"
```

---

### Task 6: Mount the banner on the host live console

**Files:**
- Modify: `app/host/live/[nightId]/HostLiveConsoleClient.tsx`

- [ ] **Step 1: Import the banner**

Add to the imports at the top of `HostLiveConsoleClient.tsx`:

```ts
import { HostConnectionBanner } from "@/components/host/HostConnectionBanner";
```

- [ ] **Step 2: Render it at the top of the console**

In the component's returned JSX, render `<HostConnectionBanner />` as the first child inside the outermost wrapper element (it is `position: fixed`, so exact placement in the tree doesn't affect layout — put it first for clarity):

```tsx
  return (
    <div /* existing outermost wrapper, keep its props */>
      <HostConnectionBanner />
      {/* …existing console content… */}
    </div>
  );
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/host/live/[nightId]/HostLiveConsoleClient.tsx
git commit -m "feat(host): show Reconnecting banner on the live console"
```

---

### Task 7: Validation — automated regression + manual sleep/wake

**Files:** none (validation only).

- [ ] **Step 1: Full unit suite green**

Run: `npx vitest run`
Expected: PASS — existing suite unchanged + the new tests (Tasks 1-3) green.

- [ ] **Step 2: Player-side load is unchanged across a range (scale-free check)**

Run each and capture the printed request/timing summary:

```bash
SMOKE_PHONES=30 SMOKE_REALTIME=1 node --env-file=.env.local scripts/full-flow-prod.mjs
SMOKE_PHONES=60 SMOKE_REALTIME=1 node --env-file=.env.local scripts/full-flow-prod.mjs
```

Expected: green at each level, and the player-side request profile flat vs. `main` (the watchdog is host-only, so phones should behave identically). If `SMOKE_PHONES=100` is feasible on the runner, run it too.

- [ ] **Step 3: Manual sleep/wake repro on a real laptop**

1. On `main`: open the host live console mid-game, sleep the laptop ~60s, wake it. Confirm the freeze reproduces (stale screen, clicks don't advance).
2. On this branch: repeat. Confirm within ~1-2s of wake the "Reconnecting — your game is safe" banner appears, the connection rebuilds, the screen catches up, and **the page never reloads**.
3. Confirm a normal 60s pause between questions (no sleep) does NOT show the banner (STALE_MS=90s guards this).

- [ ] **Step 4: Open the PR (DO NOT MERGE — Brandon validates + merges)**

```bash
git push -u origin realtime-freshness-watchdog
gh pr create --title "fix(host): auto-recover frozen live connection after laptop sleep" --body "<plain-English summary + validation evidence + the manual sleep/wake result>"
```

---

## Self-Review

**Spec coverage:**
- Track freshness → Task 1 (`evaluateFreshness`) + Task 5 (`markFresh` on all 7 handlers). ✓
- Detect death two ways (stale + sleep-gap) → Task 1 logic, Task 2 interval. ✓
- Hard recovery (drop transport + reconnect + re-bootstrap) → Task 5 `onRecover` + `watchdogTick`. ✓
- Coordinate / lock / cooldown → Task 2 (`recoveringRef`, `HARD_RECONNECT_COOLDOWN_MS`). ✓ (Jitter deliberately omitted — see header.)
- Recovery UX Option A, host indicator, never auto-reload → Task 3 + Task 6; no `location.reload` anywhere. ✓
- Safe at any player count → host-gated (`enabled = deviceId === undefined`); verified in Task 7 Step 2. ✓
- Files touched → matches the File Structure section. ✓
- Spec's "to verify (realtime-js behavior)" → resolved and documented in the header. ✓

**Placeholder scan:** none — every code step contains complete code; every run step has an expected result.

**Type consistency:** `evaluateFreshness`/`FreshnessInput`/`FreshnessVerdict`, `useFreshnessWatchdog`/`FreshnessWatchdogArgs`, `getChannelHealth`, `markFresh`, `lastMessageAtRef`, `watchdogTick` — names and signatures are identical across Tasks 1, 2, 4, and 5. ✓
