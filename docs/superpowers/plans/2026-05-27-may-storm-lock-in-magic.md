# May/Storm Lock-In Magic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the May/Storm-themed live-question experience: 25s timer (May only), auto-scrolling scoreboard marquee that replaces the lock-in pile, and a per-player lightning ceremony that strikes both phone and TV on every lock-in.

**Architecture:** A single theme registry (`lib/theme/lockInCeremony.ts`) controls everything. Themes that register a config get the new behavior; themes that don't are unchanged. The registry is the only switch — every conditional reads from it. Extends the existing `Lightning.tsx` with a `tint` prop for per-player bolts. Phone ceremony plays only on server confirm.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, vitest, Playwright, Supabase realtime, existing TR1VIA theme system.

**Spec:** `docs/superpowers/specs/2026-05-27-may-storm-lock-in-magic.md`

---

## Phase 1 — Foundation: theme registry + duration propagation

### Task 1: Create the lock-in ceremony theme registry

**Files:**
- Create: `lib/theme/lockInCeremony.ts`
- Test: `tests/unit/lockInCeremony-theme.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lockInCeremony-theme.test.ts
import { describe, it, expect } from "vitest";
import {
  lockInCeremonyFor,
  hasMarquee,
  questionDurationFor,
} from "@/lib/theme/lockInCeremony";

describe("lockInCeremonyFor", () => {
  it("returns the May/Storm config for themeKey 'may'", () => {
    const cfg = lockInCeremonyFor("may");
    expect(cfg.duration).toBe(25);
    expect(cfg.marquee).toBe(true);
    expect(cfg.ceremony).toBe("lightning");
  });

  it("returns the default config (20s, no marquee, no ceremony) for non-May themes", () => {
    for (const k of ["house", "daylight", "january", "june", "december"] as const) {
      const cfg = lockInCeremonyFor(k);
      expect(cfg.duration).toBe(20);
      expect(cfg.marquee).toBe(false);
      expect(cfg.ceremony).toBeNull();
    }
  });
});

describe("hasMarquee", () => {
  it("returns true only for May/Storm", () => {
    expect(hasMarquee("may")).toBe(true);
    expect(hasMarquee("house")).toBe(false);
    expect(hasMarquee("october")).toBe(false);
  });
});

describe("questionDurationFor", () => {
  it("returns 25 for May, 20 for everything else", () => {
    expect(questionDurationFor("may")).toBe(25);
    expect(questionDurationFor("house")).toBe(20);
    expect(questionDurationFor("january")).toBe(20);
  });

  it("returns 20 when themeKey is undefined or invalid", () => {
    expect(questionDurationFor(undefined)).toBe(20);
    // @ts-expect-error testing runtime fallback
    expect(questionDurationFor("notatheme")).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lockInCeremony-theme.test.ts`
Expected: FAIL with "Cannot find module '@/lib/theme/lockInCeremony'"

- [ ] **Step 3: Write the registry implementation**

```ts
// lib/theme/lockInCeremony.ts
//
// Per-theme registry for the lock-in ceremony treatment. Parallel to the
// Weather component's switch-on-themeKey pattern in components/system/Weather.tsx.
//
// Themes that register a config opt INTO the new live-question experience
// (longer timer, auto-scrolling marquee scoreboard, per-player lightning
// strike on lock-in). Themes that don't register fall back to the default —
// today's 20s timer, lock-in pile, no transit ceremony.
//
// This is the single source of truth. Every conditional in the codebase that
// asks "is this theme on the new May/Storm experience?" reads from here.

import type { ThemeKey } from "@/lib/theme/tokens";

export type CeremonyKind = "lightning" | null;

export interface LockInCeremonyConfig {
  /** Question timer length in seconds. May = 25, default = 20. */
  duration: number;
  /** True → bottom strip is the auto-scrolling marquee. False → existing lock-in pile. */
  marquee: boolean;
  /** Per-player ceremony to fire on lock-in. null = no transit treatment. */
  ceremony: CeremonyKind;
}

const DEFAULT_CONFIG: LockInCeremonyConfig = {
  duration: 20,
  marquee: false,
  ceremony: null,
};

/** Themes opt IN to the new behavior by registering here. */
const REGISTRY: Partial<Record<ThemeKey, LockInCeremonyConfig>> = {
  may: {
    duration: 25,
    marquee: true,
    ceremony: "lightning",
  },
};

export function lockInCeremonyFor(themeKey: ThemeKey | undefined): LockInCeremonyConfig {
  if (!themeKey) return DEFAULT_CONFIG;
  return REGISTRY[themeKey] ?? DEFAULT_CONFIG;
}

export function hasMarquee(themeKey: ThemeKey | undefined): boolean {
  return lockInCeremonyFor(themeKey).marquee;
}

export function questionDurationFor(themeKey: ThemeKey | undefined): number {
  return lockInCeremonyFor(themeKey).duration;
}

export function hasCeremony(themeKey: ThemeKey | undefined): boolean {
  return lockInCeremonyFor(themeKey).ceremony !== null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lockInCeremony-theme.test.ts`
Expected: PASS — 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add lib/theme/lockInCeremony.ts tests/unit/lockInCeremony-theme.test.ts
git commit -m "feat(theme): add lockInCeremony registry — May opts into new behavior"
```

---

### Task 2: Wire `useTimer` default duration to the theme registry

**Files:**
- Modify: `lib/hooks/useTimer.ts`
- Test: `tests/unit/useTimer-theme.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/useTimer-theme.test.tsx
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTimer } from "@/lib/hooks/useTimer";

describe("useTimer with themeKey", () => {
  it("uses 25s when themeKey is 'may' and durationS is omitted", () => {
    const revealedAtMs = Date.now();
    const { result } = renderHook(() =>
      useTimer({ revealedAtMs, themeKey: "may" })
    );
    expect(result.current.secondsRemaining).toBeGreaterThan(24);
    expect(result.current.secondsRemaining).toBeLessThanOrEqual(25);
  });

  it("uses 20s when themeKey is 'house' and durationS is omitted", () => {
    const revealedAtMs = Date.now();
    const { result } = renderHook(() =>
      useTimer({ revealedAtMs, themeKey: "house" })
    );
    expect(result.current.secondsRemaining).toBeGreaterThan(19);
    expect(result.current.secondsRemaining).toBeLessThanOrEqual(20);
  });

  it("explicit durationS overrides the theme default", () => {
    const revealedAtMs = Date.now();
    const { result } = renderHook(() =>
      useTimer({ revealedAtMs, themeKey: "may", durationS: 10 })
    );
    expect(result.current.secondsRemaining).toBeGreaterThan(9);
    expect(result.current.secondsRemaining).toBeLessThanOrEqual(10);
  });

  it("falls back to 20s when neither themeKey nor durationS provided", () => {
    const revealedAtMs = Date.now();
    const { result } = renderHook(() => useTimer({ revealedAtMs }));
    expect(result.current.secondsRemaining).toBeGreaterThan(19);
    expect(result.current.secondsRemaining).toBeLessThanOrEqual(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/useTimer-theme.test.tsx`
Expected: FAIL with "Property 'themeKey' does not exist on type 'UseTimerOpts'"

- [ ] **Step 3: Update `useTimer.ts`**

Edit `lib/hooks/useTimer.ts` — apply two changes:

In the imports section, add:
```ts
import { questionDurationFor } from "@/lib/theme/lockInCeremony";
import type { ThemeKey } from "@/lib/theme/tokens";
```

In the `UseTimerOpts` interface, add:
```ts
  /** When set, default duration is derived from this theme's registry entry. */
  themeKey?: ThemeKey;
```

In the function body, replace the existing `const duration = opts.durationS ?? 20;` line with:
```ts
const duration = opts.durationS ?? questionDurationFor(opts.themeKey);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/useTimer-theme.test.tsx tests/unit/timer.test.ts`
Expected: PASS — new theme tests pass, existing timer tests unchanged

- [ ] **Step 5: Commit**

```bash
git add lib/hooks/useTimer.ts tests/unit/useTimer-theme.test.tsx
git commit -m "feat(timer): useTimer reads duration default from theme registry"
```

---

### Task 3: Wire `TimerRing` and `TVTimerArc` max from the theme

**Files:**
- Modify: `components/system/TimerRing.tsx`
- Modify: `components/system/TVTimerArc.tsx`
- Test: `tests/unit/timer-rings-theme.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/timer-rings-theme.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TimerRing } from "@/components/system/TimerRing";
import { TVTimerArc } from "@/components/system/TVTimerArc";

describe("TimerRing themeKey", () => {
  it("uses max=25 when themeKey='may' and max prop is omitted", () => {
    const { container } = render(<TimerRing seconds={25} themeKey="may" accent="#fff" />);
    // The full ring at seconds=25 over max=25 should have fraction=1
    // (no offset). When max defaulted to 20, seconds=25 would clamp to 20.
    const circle = container.querySelector("circle[stroke-dashoffset]");
    expect(circle?.getAttribute("stroke-dashoffset")).toBe("0");
  });

  it("uses max=20 when themeKey is omitted", () => {
    const { container } = render(<TimerRing seconds={20} accent="#fff" />);
    const circle = container.querySelector("circle[stroke-dashoffset]");
    expect(circle?.getAttribute("stroke-dashoffset")).toBe("0");
  });

  it("respects explicit max prop over themeKey", () => {
    const { container } = render(<TimerRing seconds={10} themeKey="may" max={10} accent="#fff" />);
    const circle = container.querySelector("circle[stroke-dashoffset]");
    expect(circle?.getAttribute("stroke-dashoffset")).toBe("0");
  });
});

describe("TVTimerArc themeKey", () => {
  it("uses max=25 when themeKey='may' and max prop is omitted", () => {
    const { container } = render(<TVTimerArc seconds={25} themeKey="may" accent="#fff" />);
    // The arc renders as full when seconds === max
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("uses max=20 when themeKey is omitted", () => {
    const { container } = render(<TVTimerArc seconds={20} accent="#fff" />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/timer-rings-theme.test.tsx`
Expected: FAIL with "Property 'themeKey' does not exist on type 'TimerRingProps'"

- [ ] **Step 3: Update both components**

In `components/system/TimerRing.tsx`, add an import:
```ts
import { questionDurationFor } from "@/lib/theme/lockInCeremony";
import type { ThemeKey } from "@/lib/theme/tokens";
```

Extend `TimerRingProps` with:
```ts
  themeKey?: ThemeKey;
```

In the function body, replace the existing `max = 20` default with a derivation:
```ts
export function TimerRing({ seconds, max, size = 48, accent, themeKey }: TimerRingProps) {
  const resolvedMax = max ?? questionDurationFor(themeKey);
  // ... use resolvedMax everywhere `max` was used below
```

Apply the same pattern to `components/system/TVTimerArc.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/timer-rings-theme.test.tsx`
Expected: PASS — 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add components/system/TimerRing.tsx components/system/TVTimerArc.tsx tests/unit/timer-rings-theme.test.tsx
git commit -m "feat(timer-ui): TimerRing + TVTimerArc derive max from theme"
```

---

### Task 4: Wire `TVStateMachine` and the player room page to derive duration from theme

**Files:**
- Modify: `components/tv/TVStateMachine.tsx:329` (the hardcoded `durationS: 20`)
- Modify: `app/(player)/room/[code]/page.tsx:73` (`QUESTION_DURATION_S = 20`)
- Test: extend existing `tests/unit/timer.test.ts` and/or add focused tests

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/room-page-duration.test.ts (new)
import { describe, it, expect } from "vitest";
import { questionDurationFor } from "@/lib/theme/lockInCeremony";

// Smoke test that the room page would pull 25s for may, 20s for others.
// (We can't easily mount the full page without a lot of Next/RSC scaffolding —
// this test asserts the helper is wired with the right semantics and serves
// as a regression guard against accidentally restoring a hardcoded 20.)
describe("room page duration source", () => {
  it("yields 25s for may", () => {
    expect(questionDurationFor("may")).toBe(25);
  });
  it("yields 20s otherwise", () => {
    expect(questionDurationFor("house")).toBe(20);
  });
});
```

- [ ] **Step 2: Update `TVStateMachine.tsx`**

At line 329 (the `useTimer` call), change:
```ts
durationS: 20,
```
to:
```ts
themeKey: themeKey,
```

(The TVStateMachine already has `themeKey` in scope — verify by reading the file header. If not in scope, accept it via the component's props.)

- [ ] **Step 3: Update `app/(player)/room/[code]/page.tsx`**

Replace:
```ts
const QUESTION_DURATION_S = 20;
```
with a dynamic derivation at the point of use. The page reads `themeKey` from the room data; pass it into the `useTimer` call site instead of a hardcoded constant.

If `QUESTION_DURATION_S` is used elsewhere in the file (search for it), each site should also become theme-derived via `questionDurationFor(themeKey)` from `@/lib/theme/lockInCeremony`.

- [ ] **Step 4: Run the suite**

Run: `npx vitest run` (all unit tests)
Expected: PASS — no regressions.

- [ ] **Step 5: Commit**

```bash
git add components/tv/TVStateMachine.tsx app/(player)/room/[code]/page.tsx tests/unit/room-page-duration.test.ts
git commit -m "feat(timer): TV state machine + player room derive duration from theme"
```

---

## Phase 2 — Lightning: tint + phone-side bolt

### Task 5: Add `tint` prop to `Lightning.tsx` (extend existing component)

**Files:**
- Modify: `components/system/Lightning.tsx`
- Test: `tests/unit/lightning-tint.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/lightning-tint.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Lightning, fireLightningBeat } from "@/components/system/Lightning";

describe("Lightning tint prop", () => {
  it("accepts an optional tint prop without crashing", () => {
    const { container } = render(<Lightning tint="#E64A8C" />);
    expect(container).toBeTruthy();
  });

  it("renders without tint (existing behavior preserved)", () => {
    const { container } = render(<Lightning />);
    expect(container).toBeTruthy();
  });

  it("exposes fireLightningBeat with optional tint argument", () => {
    // Type-only check: this should compile. Behavior verified in component
    // tests below.
    expect(() => fireLightningBeat("close", { tint: "#5AA8E0" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lightning-tint.test.tsx`
Expected: FAIL with "Property 'tint' does not exist on type 'LightningProps'"

- [ ] **Step 3: Extend `Lightning.tsx` with the `tint` prop**

In `components/system/Lightning.tsx`:

Add to `LightningProps` interface:
```ts
/**
 * Per-strike color tint. When provided, the halo + afterglow blend toward
 * this color while the hot core stays white. Used by lock-in ceremonies
 * to make each player's strike feel like THEIRS.
 */
tint?: string;
```

Extend the `fireLightningBeat` signature:
```ts
export function fireLightningBeat(
  distance: "distant" | "close" = "close",
  opts?: { tint?: string }
): void {
  // existing dispatch logic — pass opts.tint through to subscribers
}
```

The component already manages stroke color evolution (white core → blue inner → purple halo → orange afterglow). When `tint` is set, replace the halo and afterglow stage colors with `tint`-derived values. Keep the white core intact (real lightning is hot).

Implementation pattern in the stroke render loop:
```ts
const haloColor = props.tint ?? "rgba(120, 80, 220, 0.6)"; // existing purple default
const afterglowColor = props.tint ?? "rgba(255, 180, 80, 0.4)"; // existing orange default
```

For `fireLightningBeat` callers, thread `opts?.tint` through the dispatcher so the next strike uses the override. The first 30ms of the bolt (core flash) stays white regardless — that's the hottest moment.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/unit/lightning-tint.test.tsx tests/unit/lightning-component.test.tsx tests/unit/lightning-bolt.test.ts`
Expected: PASS — new tint tests pass, existing Lightning tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add components/system/Lightning.tsx tests/unit/lightning-tint.test.tsx
git commit -m "feat(lightning): add tint prop for per-player strike color"
```

---

### Task 6: Build the phone-side mini-bolt component

**Files:**
- Create: `components/player/PlayerLockInBolt.tsx`
- Create: `tests/component/PlayerLockInBolt.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/component/PlayerLockInBolt.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlayerLockInBolt } from "@/components/player/PlayerLockInBolt";

describe("PlayerLockInBolt", () => {
  it("renders nothing when `active` is false", () => {
    const { container } = render(<PlayerLockInBolt active={false} tint="#E64A8C" />);
    expect(container.querySelector("[data-testid='phone-bolt']")).toBeNull();
  });

  it("renders the bolt SVG when `active` is true", () => {
    render(<PlayerLockInBolt active={true} tint="#E64A8C" />);
    expect(screen.getByTestId("phone-bolt")).toBeInTheDocument();
  });

  it("uses tint color for the bolt stroke filter", () => {
    const { container } = render(<PlayerLockInBolt active={true} tint="#5AA8E0" />);
    const svg = container.querySelector("[data-testid='phone-bolt']");
    expect(svg?.getAttribute("style") ?? "").toContain("#5AA8E0");
  });

  it("calls onComplete after the animation duration", async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(
      <PlayerLockInBolt active={true} tint="#E64A8C" onComplete={onComplete} />
    );
    vi.advanceTimersByTime(750); // > full animation duration (~700ms)
    expect(onComplete).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("respects prefers-reduced-motion (no flash overlay)", () => {
    // Mock window.matchMedia
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (q: string) => ({
        matches: q.includes("reduce"),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
    const { container } = render(<PlayerLockInBolt active={true} tint="#E64A8C" />);
    expect(container.querySelector("[data-testid='phone-bolt-flash']")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/component/PlayerLockInBolt.test.tsx`
Expected: FAIL with "Cannot find module '@/components/player/PlayerLockInBolt'"

- [ ] **Step 3: Implement the component**

```tsx
// components/player/PlayerLockInBolt.tsx
//
// Phone-side bolt — the strike a player sees on their own phone the moment
// the server confirms their lock-in. Fires only when `active` is true,
// triggered by useAnswerSubmit's server-confirmed signal.
//
// Visually: a phone-scaled lightning bolt (smaller geometry than the TV
// Lightning component) shoots upward off the top of the screen, paired
// with a strobe-flash overlay tinted to the player's color. Total
// duration ~700ms — short enough to feel snappy, long enough to register.
//
// Reduced motion: no flash overlay. Bolt SVG still renders but without
// the high-contrast strobe.

"use client";

import { useEffect } from "react";
import { generateBolt, type BoltSegment } from "@/components/system/lightning-bolt";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

export interface PlayerLockInBoltProps {
  active: boolean;
  tint: string;
  /** Called once after the bolt animation completes (~700ms). */
  onComplete?: () => void;
}

const DURATION_MS = 700;
const BOLT_HEIGHT = 200;  // px — phone-sized (TV bolts can be 400+)
const BOLT_WIDTH = 80;

export function PlayerLockInBolt({ active, tint, onComplete }: PlayerLockInBoltProps) {
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!active) return;
    const handle = setTimeout(() => onComplete?.(), DURATION_MS);
    return () => clearTimeout(handle);
  }, [active, onComplete]);

  if (!active) return null;

  // Generate a phone-sized bolt path. The lightning-bolt module already
  // exists in the codebase (used by Lightning.tsx). We just call it with
  // smaller dimensions.
  const segments: BoltSegment[] = generateBolt({
    width: BOLT_WIDTH,
    height: BOLT_HEIGHT,
    branchProbability: 0.15,
  });
  const path = segmentsToSvgPath(segments);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: -BOLT_HEIGHT,
        left: "50%",
        transform: "translateX(-50%)",
        width: BOLT_WIDTH,
        height: BOLT_HEIGHT,
        zIndex: 1000,
        pointerEvents: "none",
      }}
    >
      <svg
        data-testid="phone-bolt"
        width={BOLT_WIDTH}
        height={BOLT_HEIGHT}
        viewBox={`0 0 ${BOLT_WIDTH} ${BOLT_HEIGHT}`}
        style={{
          filter: `drop-shadow(0 0 6px #fff) drop-shadow(0 0 14px ${tint})`,
          animation: "phone-bolt-rise 0.7s ease-out forwards",
        }}
      >
        <path
          d={path}
          fill="none"
          stroke="white"
          strokeWidth={2.5}
          strokeLinejoin="miter"
          strokeLinecap="round"
        />
      </svg>
      {!reducedMotion && (
        <div
          data-testid="phone-bolt-flash"
          style={{
            position: "fixed",
            inset: 0,
            background: `radial-gradient(circle at center, ${tint}55, transparent 70%)`,
            mixBlendMode: "screen",
            pointerEvents: "none",
            animation: "phone-bolt-flash 0.7s ease-out forwards",
          }}
        />
      )}
      <style>{`
        @keyframes phone-bolt-rise {
          0% { transform: translateY(${BOLT_HEIGHT}px); opacity: 0; }
          15% { transform: translateY(${BOLT_HEIGHT * 0.6}px); opacity: 1; }
          70% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(-${BOLT_HEIGHT * 0.3}px); opacity: 0; }
        }
        @keyframes phone-bolt-flash {
          0%, 8% { opacity: 0; }
          12% { opacity: 1; }
          25% { opacity: 0.4; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function segmentsToSvgPath(segments: BoltSegment[]): string {
  if (segments.length === 0) return "";
  const [first, ...rest] = segments;
  return [
    `M${first!.x1},${first!.y1}`,
    ...segments.map((s) => `L${s.x2},${s.y2}`),
  ].join(" ");
}
```

If `generateBolt` doesn't exist with that signature, check `components/system/lightning-bolt.ts` and adapt to the actual export.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/component/PlayerLockInBolt.test.tsx`
Expected: PASS — 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add components/player/PlayerLockInBolt.tsx tests/component/PlayerLockInBolt.test.tsx
git commit -m "feat(player): add PlayerLockInBolt phone-side strike"
```

---

## Phase 3 — AI prompt templating

### Task 7: Template the question duration in `lib/ai/prompts.ts`

**Files:**
- Modify: `lib/ai/prompts.ts:38,70` (the hardcoded "20 seconds")
- Modify: any callers passing themeKey through
- Test: `tests/unit/ai-prompts-duration.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/ai-prompts-duration.test.ts
import { describe, it, expect } from "vitest";
import { buildGenerationPrompt } from "@/lib/ai/prompts";

describe("buildGenerationPrompt duration", () => {
  it("renders '25 seconds' when themeKey is 'may'", () => {
    const prompt = buildGenerationPrompt({
      category: "Geography",
      themeKey: "may",
      // ... other fields from the existing signature
    } as any);
    expect(prompt).toContain("25 seconds");
    expect(prompt).not.toContain("20 seconds");
  });

  it("renders '20 seconds' for non-May themes", () => {
    const prompt = buildGenerationPrompt({
      category: "Geography",
      themeKey: "house",
    } as any);
    expect(prompt).toContain("20 seconds");
    expect(prompt).not.toContain("25 seconds");
  });
});
```

- [ ] **Step 2: Verify the test fails**

Run: `npx vitest run tests/unit/ai-prompts-duration.test.ts`
Expected: FAIL — `buildGenerationPrompt` does not yet read `themeKey` or template the duration.

- [ ] **Step 3: Update `lib/ai/prompts.ts`**

Read the current `lib/ai/prompts.ts` first to find the actual exported function name(s) and their signatures. The two "20 seconds" strings are at lines 38 and 70.

Add `themeKey` to whichever input type the prompt builder consumes (likely a `BuildPromptOpts` interface). Import `questionDurationFor` from `@/lib/theme/lockInCeremony`. Compute:

```ts
const durationS = questionDurationFor(opts.themeKey);
```

Then replace both `"20 seconds"` literals with the template `` `${durationS} seconds` ``.

Update every callsite (`lib/ai/generate-questions.ts` and any other) to thread the `themeKey` through.

- [ ] **Step 4: Run all AI prompt tests**

Run: `npx vitest run tests/unit/ai-prompts.test.ts tests/unit/ai-prompts-duration.test.ts tests/unit/generate-questions.test.ts`
Expected: PASS — both new and existing tests pass

- [ ] **Step 5: Commit**

```bash
git add lib/ai/prompts.ts lib/ai/generate-questions.ts tests/unit/ai-prompts-duration.test.ts
git commit -m "feat(ai): question duration in prompt derived from theme"
```

---

## Phase 4 — Server confirm signal

### Task 8: Expose a "confirmed" signal from `useAnswerSubmit`

**Files:**
- Modify: `lib/hooks/useAnswerSubmit.ts`
- Test: `tests/unit/useAnswerSubmit-confirmed.test.tsx` (new — or extend existing `answer-submit.test.tsx`)

- [ ] **Step 1: Read the existing hook**

Open `lib/hooks/useAnswerSubmit.ts` to understand the current shape. Note: the existing `tests/unit/answer-submit.test.tsx` tests it. We'll extend behavior, not rewrite.

- [ ] **Step 2: Write the failing test**

```tsx
// tests/unit/useAnswerSubmit-confirmed.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAnswerSubmit } from "@/lib/hooks/useAnswerSubmit";

describe("useAnswerSubmit confirmed signal", () => {
  it("exposes confirmedAt = null before any submit", () => {
    const { result } = renderHook(() => useAnswerSubmit({ /* deps */ }));
    expect(result.current.confirmedAt).toBeNull();
  });

  it("exposes confirmedAt as a timestamp after server 200 OK", async () => {
    // Mock fetch to return 200
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ms_to_lock: 2300, server_now_ms: 1700000000000 }),
    });
    const { result } = renderHook(() => useAnswerSubmit({ /* deps */ }));
    await act(async () => { await result.current.submit(2); });
    await waitFor(() => {
      expect(result.current.confirmedAt).not.toBeNull();
    });
    expect(typeof result.current.confirmedAt).toBe("number");
  });

  it("keeps confirmedAt null if server rejects", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 410,
      json: async () => ({ error: "expired" }),
    });
    const { result } = renderHook(() => useAnswerSubmit({ /* deps */ }));
    await act(async () => { await result.current.submit(2); });
    expect(result.current.confirmedAt).toBeNull();
  });
});
```

Fill in `/* deps */` with whatever args the existing hook requires (player id, question id, etc. — copy the shape from `tests/unit/answer-submit.test.tsx`).

- [ ] **Step 3: Verify the test fails**

Run: `npx vitest run tests/unit/useAnswerSubmit-confirmed.test.tsx`
Expected: FAIL — `confirmedAt` doesn't exist on the hook's return.

- [ ] **Step 4: Add the `confirmedAt` state to the hook**

In `lib/hooks/useAnswerSubmit.ts`:

Add a state for the confirmed timestamp:
```ts
const [confirmedAt, setConfirmedAt] = useState<number | null>(null);
```

After the server returns `ok: true` (find the existing happy-path branch), set it:
```ts
setConfirmedAt(Date.now());
```

Reset it when the question changes (find the existing reset-on-question-change effect):
```ts
setConfirmedAt(null);
```

Add `confirmedAt` to the hook's return object.

- [ ] **Step 5: Run all submit tests**

Run: `npx vitest run tests/unit/useAnswerSubmit-confirmed.test.tsx tests/unit/answer-submit.test.tsx`
Expected: PASS — both new and existing tests pass

- [ ] **Step 6: Commit**

```bash
git add lib/hooks/useAnswerSubmit.ts tests/unit/useAnswerSubmit-confirmed.test.tsx
git commit -m "feat(submit): expose confirmedAt timestamp for ceremony gating"
```

---

## Phase 5 — TV scoreboard marquee

### Task 9: Build the marquee component shell with sort + chip rendering

**Files:**
- Create: `components/tv/TVScoreboardMarquee.tsx`
- Create: `tests/component/TVScoreboardMarquee.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/component/TVScoreboardMarquee.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TVScoreboardMarquee, type MarqueeChip } from "@/components/tv/TVScoreboardMarquee";

const chips: MarqueeChip[] = [
  { playerId: "p1", name: "ALEX",   color: "#5AA8E0", score: 7200, joinIndex: 2 },
  { playerId: "p2", name: "SARA",   color: "#F2A02D", score: 8400, joinIndex: 0 },
  { playerId: "p3", name: "MARK",   color: "#E64A8C", score: 7900, joinIndex: 1 },
  { playerId: "p4", name: "JULES",  color: "#7A4FCC", score: 6800, joinIndex: 3 },
];

describe("TVScoreboardMarquee — sort + chip rendering", () => {
  it("sorts chips by score descending", () => {
    render(<TVScoreboardMarquee chips={chips} />);
    const rendered = screen.getAllByTestId("marquee-chip").map((el) => within(el).getByText(/SARA|ALEX|MARK|JULES/).textContent);
    expect(rendered).toEqual(["SARA", "MARK", "ALEX", "JULES"]);
  });

  it("uses join order as the tiebreaker when scores are equal", () => {
    const tied: MarqueeChip[] = [
      { playerId: "a", name: "A", color: "#fff", score: 100, joinIndex: 2 },
      { playerId: "b", name: "B", color: "#fff", score: 100, joinIndex: 0 },
      { playerId: "c", name: "C", color: "#fff", score: 100, joinIndex: 1 },
    ];
    render(<TVScoreboardMarquee chips={tied} />);
    const rendered = screen.getAllByTestId("marquee-chip").map((el) => within(el).getByText(/A|B|C/).textContent);
    expect(rendered).toEqual(["B", "C", "A"]);
  });

  it("truncates long names to 12 chars + ellipsis", () => {
    const long: MarqueeChip[] = [
      { playerId: "x", name: "CHRISTOPHER COLUMBUS", color: "#fff", score: 0, joinIndex: 0 },
    ];
    render(<TVScoreboardMarquee chips={long} />);
    expect(screen.getByTestId("marquee-chip").textContent).toContain("CHRISTOPHER…");
  });

  it("renders a color dot styled with the player's color", () => {
    render(<TVScoreboardMarquee chips={[chips[0]!]} />);
    const dot = screen.getByTestId("marquee-chip-dot");
    expect(dot.getAttribute("style") ?? "").toContain("#5AA8E0");
  });

  it("includes an aria-live region for screen reader announcements", () => {
    render(<TVScoreboardMarquee chips={chips} announcement="MARK locked in" />);
    const region = screen.getByRole("status");
    expect(region.textContent).toContain("MARK locked in");
  });

  it("renders +SPD badge on the spotlighted chip when speedBonus=true", () => {
    const speedChip: MarqueeChip = { ...chips[2]!, speedBonus: true };
    render(<TVScoreboardMarquee chips={[speedChip]} spotlightedPlayerId={speedChip.playerId} />);
    expect(screen.getByTestId("marquee-chip-spd")).toBeInTheDocument();
  });

  it("does NOT render +SPD badge when chip is not spotlighted", () => {
    const speedChip: MarqueeChip = { ...chips[2]!, speedBonus: true };
    render(<TVScoreboardMarquee chips={[speedChip]} />);
    expect(screen.queryByTestId("marquee-chip-spd")).toBeNull();
  });
});
```

- [ ] **Step 2: Verify the test fails**

Run: `npx vitest run tests/component/TVScoreboardMarquee.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the marquee shell**

```tsx
// components/tv/TVScoreboardMarquee.tsx
//
// Auto-scrolling scoreboard marquee — the bottom strip of the TV during
// live questions on the May/Storm theme. Replaces today's lock-in pile.
//
// Sort: score descending, join-order tiebreak (stable). Re-sort on score
// updates (which only occur at reveal — mid-question scores are static).
//
// Auto-scroll: when chip width exceeds visible width, scroll smoothly
// leftward. Speed tuned to player count. Pauses on hover. Respects
// prefers-reduced-motion (pauses entirely when set).
//
// Screen reader: an aria-live region announces lock-in events (e.g.,
// "MARK locked in") so non-visual players are kept in the loop.

"use client";

import { useMemo } from "react";

export interface MarqueeChip {
  playerId: string;
  name: string;
  /** Hex color from playerColor.ts palette. */
  color: string;
  score: number;
  /** Order this player joined the night — used as sort tiebreaker. */
  joinIndex: number;
  /** When set, the chip shows a +SPD badge during its strike. Set when a
   *  speed-bonus lock (msToLock < 5000) is currently being celebrated for
   *  this player. Cleared after the ceremony completes. */
  speedBonus?: boolean;
}

export interface TVScoreboardMarqueeProps {
  chips: MarqueeChip[];
  /** Set the moment a chip is in lock-in ceremony. */
  spotlightedPlayerId?: string | null;
  /** Latest lock-in event text for screen reader announcement. */
  announcement?: string;
}

const MAX_NAME_CHARS = 12;

export function TVScoreboardMarquee({
  chips,
  spotlightedPlayerId,
  announcement,
}: TVScoreboardMarqueeProps) {
  const sorted = useMemo(() => sortChips(chips), [chips]);

  return (
    <div
      data-testid="tv-scoreboard-marquee"
      style={{
        position: "relative",
        overflow: "hidden",
        padding: "12px 0",
        background: "rgba(244,230,196,.03)",
        borderRadius: 8,
      }}
    >
      <div
        role="status"
        aria-live="polite"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
        }}
      >
        {announcement ?? ""}
      </div>

      <div
        data-testid="marquee-track"
        style={{
          display: "flex",
          gap: 8,
          paddingLeft: 24,
          paddingRight: 24,
          willChange: "transform",
        }}
      >
        {sorted.map((chip) => (
          <Chip
            key={chip.playerId}
            chip={chip}
            spotlight={spotlightedPlayerId === chip.playerId}
          />
        ))}
      </div>
    </div>
  );
}

function Chip({ chip, spotlight }: { chip: MarqueeChip; spotlight: boolean }) {
  const displayName =
    chip.name.length > MAX_NAME_CHARS
      ? `${chip.name.slice(0, MAX_NAME_CHARS)}…`
      : chip.name;

  return (
    <div
      data-testid="marquee-chip"
      data-player-id={chip.playerId}
      data-spotlight={spotlight ? "true" : undefined}
      style={{
        background: spotlight ? chip.color : "rgba(244,230,196,.08)",
        color: spotlight ? "#0E0805" : "#F4E6C4",
        padding: "8px 12px",
        borderRadius: 7,
        fontFamily: "system-ui, sans-serif",
        fontSize: 16,
        fontWeight: 700,
        whiteSpace: "nowrap",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 6,
        letterSpacing: "-0.005em",
        transition: "background .2s ease, transform .25s ease",
        transform: spotlight ? "scale(1.05)" : "scale(1)",
      }}
    >
      <span
        data-testid="marquee-chip-dot"
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: chip.color,
          flexShrink: 0,
        }}
      />
      {displayName}
      <span
        style={{
          color: spotlight ? "rgba(14,8,5,.6)" : "#B8A98C",
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        {chip.score.toLocaleString()}
      </span>
      {chip.speedBonus && spotlight && (
        <span
          data-testid="marquee-chip-spd"
          style={{
            background: "#FFD93D",
            color: "#0E0805",
            padding: "2px 5px",
            borderRadius: 3,
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: "0.06em",
          }}
        >
          +SPD
        </span>
      )}
    </div>
  );
}

export function sortChips(chips: MarqueeChip[]): MarqueeChip[] {
  return [...chips].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.joinIndex - b.joinIndex;
  });
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/component/TVScoreboardMarquee.test.tsx`
Expected: PASS — 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add components/tv/TVScoreboardMarquee.tsx tests/component/TVScoreboardMarquee.test.tsx
git commit -m "feat(tv): add TVScoreboardMarquee — sort + chip rendering shell"
```

---

### Task 10: Add auto-scroll behavior + reduced-motion handling

**Files:**
- Modify: `components/tv/TVScoreboardMarquee.tsx`
- Extend: `tests/component/TVScoreboardMarquee.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to `tests/component/TVScoreboardMarquee.test.tsx`:

```tsx
describe("TVScoreboardMarquee — auto-scroll", () => {
  it("applies a scroll animation when chip count is high enough to overflow", () => {
    const many: MarqueeChip[] = Array.from({ length: 25 }, (_, i) => ({
      playerId: `p${i}`,
      name: `P${i.toString().padStart(2, "0")}`,
      color: "#fff",
      score: 1000 - i,
      joinIndex: i,
    }));
    const { container } = render(<TVScoreboardMarquee chips={many} />);
    const track = container.querySelector("[data-testid='marquee-track']");
    expect(track?.getAttribute("style") ?? "").toMatch(/animation/i);
  });

  it("does NOT apply scroll animation for a small chip count", () => {
    const few: MarqueeChip[] = [
      { playerId: "a", name: "A", color: "#fff", score: 0, joinIndex: 0 },
      { playerId: "b", name: "B", color: "#fff", score: 0, joinIndex: 1 },
    ];
    const { container } = render(<TVScoreboardMarquee chips={few} />);
    const track = container.querySelector("[data-testid='marquee-track']");
    expect(track?.getAttribute("style") ?? "").not.toMatch(/animation/i);
  });

  it("disables scroll animation when prefers-reduced-motion is set", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (q: string) => ({
        matches: q.includes("reduce"),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
    const many: MarqueeChip[] = Array.from({ length: 25 }, (_, i) => ({
      playerId: `p${i}`,
      name: `P${i.toString().padStart(2, "0")}`,
      color: "#fff",
      score: 1000 - i,
      joinIndex: i,
    }));
    const { container } = render(<TVScoreboardMarquee chips={many} />);
    const track = container.querySelector("[data-testid='marquee-track']");
    expect(track?.getAttribute("style") ?? "").not.toMatch(/animation/i);
  });
});
```

- [ ] **Step 2: Verify the new tests fail**

Run: `npx vitest run tests/component/TVScoreboardMarquee.test.tsx`
Expected: FAIL — auto-scroll tests fail.

- [ ] **Step 3: Add the auto-scroll behavior**

In `components/tv/TVScoreboardMarquee.tsx`:

Add an import:
```ts
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
```

A few constants:
```ts
const SCROLL_THRESHOLD = 6;  // chip count at/above which we auto-scroll
const SCROLL_SECONDS_PER_CHIP = 1.2;
const MIN_SCROLL_SECONDS = 20;
```

In the component body, derive the scroll style:

```ts
const reducedMotion = usePrefersReducedMotion();
const shouldScroll = sorted.length >= SCROLL_THRESHOLD && !reducedMotion;
const scrollSeconds = Math.max(MIN_SCROLL_SECONDS, sorted.length * SCROLL_SECONDS_PER_CHIP);

const trackStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  paddingLeft: 24,
  paddingRight: 24,
  willChange: "transform",
  ...(shouldScroll && {
    animation: `tv-marquee-scroll ${scrollSeconds}s linear infinite`,
  }),
};
```

Render duplicate chips when scrolling (so the marquee loops seamlessly):

```tsx
<div data-testid="marquee-track" style={trackStyle}>
  {sorted.map((chip) => <Chip key={chip.playerId} chip={chip} spotlight={spotlightedPlayerId === chip.playerId} />)}
  {shouldScroll && sorted.map((chip) => <Chip key={`dup-${chip.playerId}`} chip={chip} spotlight={false} aria-hidden />)}
</div>
```

Add the keyframes via a style tag at the end of the component:

```tsx
<style>{`
  @keyframes tv-marquee-scroll {
    0% { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }
`}</style>
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/component/TVScoreboardMarquee.test.tsx`
Expected: PASS — 8 tests pass

- [ ] **Step 5: Commit**

```bash
git add components/tv/TVScoreboardMarquee.tsx tests/component/TVScoreboardMarquee.test.tsx
git commit -m "feat(tv): TVScoreboardMarquee auto-scrolls + respects reduced motion"
```

---

### Task 11: Wire `TVQuestion` to swap pile vs. marquee based on theme

**Files:**
- Modify: `components/tv/TVQuestion.tsx`
- Test: `tests/component/TVQuestion-marquee-swap.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

```tsx
// tests/component/TVQuestion-marquee-swap.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TVQuestion } from "@/components/tv/TVQuestion";

const baseProps = {
  category: "Geography",
  value: 100,
  question: "Which state?",
  seconds: 15,
  options: [
    { n: 1, text: "Florida" },
    { n: 2, text: "Alaska" },
    { n: 3, text: "California" },
    { n: 4, text: "Maine" },
  ],
};

const marqueeChips = [
  { playerId: "p1", name: "ALEX", color: "#5AA8E0", score: 7200, joinIndex: 0 },
  { playerId: "p2", name: "SARA", color: "#F2A02D", score: 8400, joinIndex: 1 },
];

describe("TVQuestion bottom-strip swap", () => {
  it("renders the marquee when themeKey is 'may' and marqueeChips provided", () => {
    render(<TVQuestion {...baseProps} themeKey="may" marqueeChips={marqueeChips} />);
    expect(screen.getByTestId("tv-scoreboard-marquee")).toBeInTheDocument();
    expect(screen.queryByTestId("tv-question-pile")).toBeNull();
  });

  it("renders the existing pile when themeKey is not 'may'", () => {
    render(<TVQuestion {...baseProps} themeKey="house" />);
    expect(screen.queryByTestId("tv-scoreboard-marquee")).toBeNull();
    expect(screen.getByTestId("tv-question-pile")).toBeInTheDocument();
  });

  it("falls back to the pile if themeKey is 'may' but no marqueeChips provided", () => {
    render(<TVQuestion {...baseProps} themeKey="may" />);
    expect(screen.queryByTestId("tv-scoreboard-marquee")).toBeNull();
    expect(screen.getByTestId("tv-question-pile")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verify the test fails**

Run: `npx vitest run tests/component/TVQuestion-marquee-swap.test.tsx`
Expected: FAIL — `marqueeChips` prop unknown / pile renders even with themeKey=may.

- [ ] **Step 3: Update `TVQuestion.tsx`**

In `components/tv/TVQuestion.tsx`:

Add imports:
```ts
import { TVScoreboardMarquee, type MarqueeChip } from "@/components/tv/TVScoreboardMarquee";
import { hasMarquee } from "@/lib/theme/lockInCeremony";
```

Extend `TVQuestionProps` with:
```ts
marqueeChips?: MarqueeChip[];
spotlightedPlayerId?: string | null;
lockInAnnouncement?: string;
```

In the function body, near the existing pile render branch (lines ~209-274), wrap it in a conditional:

```tsx
{props.themeKey && hasMarquee(props.themeKey) && props.marqueeChips ? (
  <div style={{ padding: "20px 56px 16px", marginTop: "auto", position: "relative", zIndex: 1 }}>
    <TVScoreboardMarquee
      chips={props.marqueeChips}
      spotlightedPlayerId={props.spotlightedPlayerId ?? null}
      announcement={props.lockInAnnouncement}
    />
  </div>
) : (
  /* existing pile rendering — unchanged */
  pileTiles && pileTiles.length > 0 ? (/* ... */) : (/* ... */)
)}
```

Pass `themeKey`, `marqueeChips`, `spotlightedPlayerId`, `lockInAnnouncement` through from the parent (TVStateMachine).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/component/TVQuestion-marquee-swap.test.tsx tests/component/`
Expected: PASS — no regressions

- [ ] **Step 5: Commit**

```bash
git add components/tv/TVQuestion.tsx tests/component/TVQuestion-marquee-swap.test.tsx
git commit -m "feat(tv): TVQuestion swaps lock-in pile for marquee on May theme"
```

---

## Phase 6 — TV lock-in ceremony orchestrator

### Task 12: Build `TVLockInCeremony` with calm/storm mode switching

**Files:**
- Create: `components/tv/TVLockInCeremony.tsx`
- Create: `tests/unit/ceremony-mode-switch.test.ts`
- Create: `tests/component/TVLockInCeremony.test.tsx`

- [ ] **Step 1: Write the unit test for mode logic**

```ts
// tests/unit/ceremony-mode-switch.test.ts
import { describe, it, expect } from "vitest";
import { decideMode, type CeremonyEvent } from "@/components/tv/TVLockInCeremony";

const ev = (id: string, at: number): CeremonyEvent => ({
  playerId: id,
  tint: "#fff",
  msToLock: 2000,
  receivedAtMs: at,
});

describe("decideMode", () => {
  it("returns calm when no pending and no recent strikes", () => {
    expect(decideMode({ pending: [], recent: [], nowMs: 1000 })).toBe("calm");
  });

  it("returns calm when one strike landed recently but queue empty", () => {
    expect(decideMode({ pending: [], recent: [ev("a", 700)], nowMs: 1000 })).toBe("calm");
  });

  it("returns storm when 2+ pending", () => {
    expect(decideMode({ pending: [ev("a", 900), ev("b", 950)], recent: [], nowMs: 1000 })).toBe("storm");
  });

  it("returns storm when 3+ strikes in the last 1500ms", () => {
    expect(
      decideMode({
        pending: [],
        recent: [ev("a", 100), ev("b", 600), ev("c", 900)],
        nowMs: 1000,
      })
    ).toBe("storm");
  });

  it("ignores strikes older than the 1500ms window", () => {
    expect(
      decideMode({
        pending: [],
        recent: [ev("a", -2000), ev("b", -1700), ev("c", -1600)],
        nowMs: 1000,
      })
    ).toBe("calm");
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `npx vitest run tests/unit/ceremony-mode-switch.test.ts`
Expected: FAIL — module/exports do not exist.

- [ ] **Step 3: Implement `TVLockInCeremony.tsx`**

```tsx
// components/tv/TVLockInCeremony.tsx
//
// TV-side lock-in ceremony orchestrator. Subscribes to lock-in broadcasts,
// maintains a queue of pending strikes, and renders each strike with the
// correct mode:
//
//   CALM mode — chip pulls to center, full Lightning bolt, loud thunder.
//   STORM mode — chips strike in place, simultaneous bolts welcome,
//                rolling thunder via Lightning's existing subsequent-stroke
//                pattern.
//
// Mode is decided per-event at the moment it's about to fire, based on
// pending depth + recent strike count. Once started, a strike completes
// fully (calm strikes don't morph into storm mid-flight).
//
// Every event eventually fires — no silent drops. If we're past T+25
// when the queue is still draining, strikes overlay the reveal state
// (parent decides when to allow that overlay).

"use client";

import { useEffect, useRef, useState } from "react";
import { fireLightningBeat } from "@/components/system/Lightning";

export type CeremonyMode = "calm" | "storm";

export interface CeremonyEvent {
  playerId: string;
  /** Hex color from playerColor.ts. */
  tint: string;
  /** Server-reported lock time in ms (drives +SPD eligibility, ≤5000 = speed bonus). */
  msToLock: number;
  /** When this event was received at the TV (Date.now() at enqueue). */
  receivedAtMs: number;
}

const RECENT_WINDOW_MS = 1500;
const CALM_PENDING_THRESHOLD = 2; // pending count >= this → storm
const STORM_RECENT_THRESHOLD = 3; // recent count >= this → storm

export function decideMode(input: {
  pending: CeremonyEvent[];
  recent: CeremonyEvent[];
  nowMs: number;
}): CeremonyMode {
  if (input.pending.length >= CALM_PENDING_THRESHOLD) return "storm";
  const recentCount = input.recent.filter(
    (e) => input.nowMs - e.receivedAtMs <= RECENT_WINDOW_MS
  ).length;
  if (recentCount >= STORM_RECENT_THRESHOLD) return "storm";
  return "calm";
}

export interface TVLockInCeremonyProps {
  /** External event stream — parent forwards lock-in broadcasts here. */
  events: CeremonyEvent[];
  /** Called when each event has finished its ceremony (parent clears it from `events`). */
  onEventComplete?: (playerId: string) => void;
  /** Called when calm mode starts a spotlight so parent can highlight the chip. */
  onSpotlight?: (playerId: string | null) => void;
}

export function TVLockInCeremony({ events, onEventComplete, onSpotlight }: TVLockInCeremonyProps) {
  const recentRef = useRef<CeremonyEvent[]>([]);
  const [activeEvent, setActiveEvent] = useState<CeremonyEvent | null>(null);
  const [activeMode, setActiveMode] = useState<CeremonyMode>("calm");

  useEffect(() => {
    if (activeEvent) return;
    const next = events[0];
    if (!next) return;

    const mode = decideMode({
      pending: events,
      recent: recentRef.current,
      nowMs: Date.now(),
    });
    setActiveMode(mode);
    setActiveEvent(next);

    if (mode === "calm") {
      onSpotlight?.(next.playerId);
    }

    // Fire the actual lightning bolt
    fireLightningBeat(mode === "calm" ? "close" : "close", { tint: next.tint });

    // After the ceremony duration, advance.
    const ceremonyMs = mode === "calm" ? 1200 : 700;
    const handle = setTimeout(() => {
      recentRef.current = [
        ...recentRef.current.filter((e) => Date.now() - e.receivedAtMs <= RECENT_WINDOW_MS),
        next,
      ];
      onSpotlight?.(null);
      onEventComplete?.(next.playerId);
      setActiveEvent(null);
    }, ceremonyMs);

    return () => clearTimeout(handle);
  }, [events, activeEvent, onEventComplete, onSpotlight]);

  return null; // Orchestration only — visuals rendered via Lightning + chip spotlight in parent.
}
```

- [ ] **Step 4: Write the component-level test**

```tsx
// tests/component/TVLockInCeremony.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { TVLockInCeremony, type CeremonyEvent } from "@/components/tv/TVLockInCeremony";

vi.mock("@/components/system/Lightning", async () => {
  return { fireLightningBeat: vi.fn() };
});
import { fireLightningBeat } from "@/components/system/Lightning";

describe("TVLockInCeremony", () => {
  it("fires fireLightningBeat with the player's tint on each event", async () => {
    const events: CeremonyEvent[] = [
      { playerId: "p1", tint: "#E64A8C", msToLock: 2000, receivedAtMs: Date.now() },
    ];
    render(<TVLockInCeremony events={events} />);
    await waitFor(() => expect(fireLightningBeat).toHaveBeenCalled());
    expect(fireLightningBeat).toHaveBeenCalledWith("close", { tint: "#E64A8C" });
  });

  it("calls onSpotlight in calm mode (single event)", async () => {
    const onSpotlight = vi.fn();
    const events: CeremonyEvent[] = [
      { playerId: "p1", tint: "#E64A8C", msToLock: 2000, receivedAtMs: Date.now() },
    ];
    render(<TVLockInCeremony events={events} onSpotlight={onSpotlight} />);
    await waitFor(() => expect(onSpotlight).toHaveBeenCalledWith("p1"));
  });

  it("calls onEventComplete after the ceremony duration", async () => {
    vi.useFakeTimers();
    const onEventComplete = vi.fn();
    const events: CeremonyEvent[] = [
      { playerId: "p1", tint: "#E64A8C", msToLock: 2000, receivedAtMs: Date.now() },
    ];
    render(<TVLockInCeremony events={events} onEventComplete={onEventComplete} />);
    await vi.advanceTimersByTimeAsync(1500);
    expect(onEventComplete).toHaveBeenCalledWith("p1");
    vi.useRealTimers();
  });
});
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run tests/unit/ceremony-mode-switch.test.ts tests/component/TVLockInCeremony.test.tsx`
Expected: PASS — 8 tests pass

- [ ] **Step 6: Commit**

```bash
git add components/tv/TVLockInCeremony.tsx tests/unit/ceremony-mode-switch.test.ts tests/component/TVLockInCeremony.test.tsx
git commit -m "feat(tv): TVLockInCeremony orchestrator with calm/storm mode switch"
```

---

### Task 13: Wire `TVStateMachine` to plumb broadcasts → ceremony events + marquee chips

**Files:**
- Modify: `components/tv/TVStateMachine.tsx`

- [ ] **Step 1: Find the existing lock-in broadcast subscription**

Read `components/tv/TVStateMachine.tsx` carefully. The existing pile-tiles flow reads from `useRoom` or similar to derive `tiles` (`ms_to_lock`-sorted player tiles). Identify:
- where the player list comes from (with playerId, name, color, score, ms_to_lock)
- where new lock-in events arrive (or are derived from polled state)

- [ ] **Step 2: Wire the marquee data**

When `themeKey === "may"`, derive `marqueeChips: MarqueeChip[]` from the same player roster the pile uses:

```tsx
import type { MarqueeChip } from "@/components/tv/TVScoreboardMarquee";
import type { CeremonyEvent } from "@/components/tv/TVLockInCeremony";
import { TVLockInCeremony } from "@/components/tv/TVLockInCeremony";
import { hasMarquee, hasCeremony } from "@/lib/theme/lockInCeremony";
import { playerColorHex } from "@/lib/player/playerColor";

// Within the live-question branch:
const marqueeChips: MarqueeChip[] = useMemo(() => {
  if (!hasMarquee(themeKey)) return [];
  return players.map((p, i) => ({
    playerId: p.id,
    name: p.name.toUpperCase(),
    color: playerColorHex(p.id),
    score: p.score ?? 0,
    joinIndex: i,
  }));
}, [players, themeKey]);
```

- [ ] **Step 3: Wire ceremony events + speedBonus plumbing**

Maintain a queue of unprocessed lock-in events. Detect new lock-ins by diffing the players who locked since the last render. Also track which player is currently being spotlighted with a speed-bonus so the marquee can render the +SPD badge.

```tsx
const [ceremonyQueue, setCeremonyQueue] = useState<CeremonyEvent[]>([]);
const [spotlightedPlayerId, setSpotlightedPlayerId] = useState<string | null>(null);
const [speedBonusPlayerId, setSpeedBonusPlayerId] = useState<string | null>(null);
const seenLocksRef = useRef<Set<string>>(new Set());

useEffect(() => {
  if (!hasCeremony(themeKey)) return;
  const newlyLocked = lockedPlayers.filter((p) => !seenLocksRef.current.has(p.id));
  for (const p of newlyLocked) seenLocksRef.current.add(p.id);
  if (newlyLocked.length > 0) {
    setCeremonyQueue((q) => [
      ...q,
      ...newlyLocked.map((p) => ({
        playerId: p.id,
        tint: playerColorHex(p.id),
        msToLock: p.ms_to_lock,
        receivedAtMs: Date.now(),
      })),
    ]);
  }
}, [lockedPlayers, themeKey]);

const handleSpotlight = useCallback((playerId: string | null) => {
  setSpotlightedPlayerId(playerId);
  if (playerId === null) {
    setSpeedBonusPlayerId(null);
    return;
  }
  // Look up this player's current ceremony event to determine speed bonus.
  const ev = ceremonyQueue.find((e) => e.playerId === playerId);
  setSpeedBonusPlayerId(ev && ev.msToLock < 5000 ? playerId : null);
}, [ceremonyQueue]);

const handleEventComplete = useCallback((playerId: string) => {
  setCeremonyQueue((q) => q.filter((e) => e.playerId !== playerId));
}, []);

// Annotate marquee chips with speedBonus where applicable.
const decoratedChips: MarqueeChip[] = marqueeChips.map((c) => ({
  ...c,
  speedBonus: c.playerId === speedBonusPlayerId,
}));
```

In the JSX, when on May:

```tsx
{hasCeremony(themeKey) && (
  <TVLockInCeremony
    events={ceremonyQueue}
    onEventComplete={handleEventComplete}
    onSpotlight={handleSpotlight}
  />
)}

<TVQuestion
  {...existingProps}
  themeKey={themeKey}
  marqueeChips={decoratedChips}
  spotlightedPlayerId={spotlightedPlayerId}
  lockInAnnouncement={
    spotlightedPlayerId
      ? `${players.find((p) => p.id === spotlightedPlayerId)?.name ?? ""} locked in`
      : undefined
  }
/>
```

- [ ] **Step 4: Run the suite**

Run: `npx vitest run`
Expected: PASS — no regressions in existing TV tests.

- [ ] **Step 5: Commit**

```bash
git add components/tv/TVStateMachine.tsx
git commit -m "feat(tv): TVStateMachine plumbs lock-ins to marquee + ceremony"
```

---

### Task 14: Add the 3s polling fallback for missed lock-in broadcasts

**Files:**
- Modify: `components/tv/TVStateMachine.tsx`
- Create: `lib/hooks/useLockInSync.ts`
- Create: `tests/unit/useLockInSync.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/useLockInSync.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLockInSync } from "@/lib/hooks/useLockInSync";

describe("useLockInSync", () => {
  it("polls /api/games/:id/locks every 3 seconds when active", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ locks: [] }),
    } as Response);

    renderHook(() => useLockInSync({ gameId: "g1", active: true, onMissed: () => {} }));

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("/api/games/g1/locks"));
    fetchSpy.mockClear();

    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
    fetchSpy.mockRestore();
  });

  it("does not poll when active is false", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ locks: [] }),
    } as Response);

    renderHook(() => useLockInSync({ gameId: "g1", active: false, onMissed: () => {} }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.useRealTimers();
    fetchSpy.mockRestore();
  });

  it("calls onMissed for locks not yet acknowledged", async () => {
    vi.useFakeTimers();
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        locks: [
          { playerId: "p1", msToLock: 2300, lockedAtMs: 1000 },
          { playerId: "p2", msToLock: 3800, lockedAtMs: 1100 },
        ],
      }),
    } as Response);
    const onMissed = vi.fn();
    renderHook(() =>
      useLockInSync({
        gameId: "g1",
        active: true,
        acknowledged: new Set(["p1"]),
        onMissed,
      })
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(onMissed).toHaveBeenCalledWith({ playerId: "p2", msToLock: 3800, lockedAtMs: 1100 });
    expect(onMissed).not.toHaveBeenCalledWith(expect.objectContaining({ playerId: "p1" }));
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Verify the test fails**

Run: `npx vitest run tests/unit/useLockInSync.test.ts`
Expected: FAIL — hook doesn't exist.

- [ ] **Step 3: Implement the hook**

```ts
// lib/hooks/useLockInSync.ts
//
// 3-second poll for lock-in events on a given game. Used by the TV to
// catch any lock-ins that the Supabase realtime channel dropped. Calls
// `onMissed` for each lock-in the parent hasn't yet acknowledged
// (acknowledgement = the parent has already played the ceremony for it).

"use client";

import { useEffect, useRef } from "react";

export interface LockInRecord {
  playerId: string;
  msToLock: number;
  lockedAtMs: number;
}

export interface UseLockInSyncOpts {
  gameId: string;
  active: boolean;
  acknowledged?: Set<string>;
  onMissed?: (lock: LockInRecord) => void;
}

const POLL_MS = 3000;

export function useLockInSync({ gameId, active, acknowledged, onMissed }: UseLockInSyncOpts) {
  const onMissedRef = useRef(onMissed);
  const acknowledgedRef = useRef(acknowledged);
  onMissedRef.current = onMissed;
  acknowledgedRef.current = acknowledged;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch(`/api/games/${gameId}/locks`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { locks: LockInRecord[] };
        const ack = acknowledgedRef.current ?? new Set<string>();
        for (const lock of data.locks) {
          if (!ack.has(lock.playerId)) onMissedRef.current?.(lock);
        }
      } catch {
        /* swallow — next tick retries */
      }
    }

    tick();
    const handle = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [gameId, active]);
}
```

- [ ] **Step 4: Confirm `/api/games/:id/locks` exists or create it**

Search: `grep -rn "/games/.*locks" app/api/`. If absent, create a thin GET handler returning the same data the TV already queries elsewhere, scoped to the game.

- [ ] **Step 5: Wire the hook into `TVStateMachine.tsx`**

In the live-question branch:

```tsx
useLockInSync({
  gameId: game.id,
  active: hasCeremony(themeKey),
  acknowledged: seenLocksRef.current,
  onMissed: (lock) => {
    setCeremonyQueue((q) => [
      ...q,
      {
        playerId: lock.playerId,
        tint: playerColorHex(lock.playerId),
        msToLock: lock.msToLock,
        receivedAtMs: Date.now(),
      },
    ]);
    seenLocksRef.current.add(lock.playerId);
  },
});
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run tests/unit/useLockInSync.test.ts`
Expected: PASS — 3 tests pass

- [ ] **Step 7: Commit**

```bash
git add lib/hooks/useLockInSync.ts tests/unit/useLockInSync.test.ts components/tv/TVStateMachine.tsx app/api/games/
git commit -m "feat(tv): 3s polling fallback catches missed lock-in broadcasts"
```

---

## Phase 7 — Player, host, admin

### Task 15: Wire the player phone-side ceremony onto server confirm

**Files:**
- Modify: `app/(player)/room/[code]/page.tsx` (or wherever the player lock-in flow lives)

- [ ] **Step 1: Locate the lock-in trigger**

Find where the player's `useAnswerSubmit` is consumed and where the transition to `PlayerLocked` happens.

- [ ] **Step 2: Mount `PlayerLockInBolt` on confirmed**

```tsx
import { PlayerLockInBolt } from "@/components/player/PlayerLockInBolt";
import { hasCeremony } from "@/lib/theme/lockInCeremony";
import { playerColorHex } from "@/lib/player/playerColor";

const { confirmedAt, submit } = useAnswerSubmit({ /* ... */ });
const [boltActive, setBoltActive] = useState(false);

useEffect(() => {
  if (!confirmedAt) return;
  if (!hasCeremony(themeKey)) return;
  setBoltActive(true);
}, [confirmedAt, themeKey]);

// In JSX (above PlayerLocked transition):
{boltActive && (
  <PlayerLockInBolt
    active={true}
    tint={playerColorHex(playerId)}
    onComplete={() => setBoltActive(false)}
  />
)}
```

The transition into `PlayerLocked` should happen on `confirmedAt !== null` (replacing any optimistic-on-tap path), so the visual order is: tap → small wait → bolt fires → PlayerLocked screen.

- [ ] **Step 3: Manual sanity check**

Run `npm run dev` and exercise a May-themed game: tap an answer, confirm bolt appears, confirm lock state follows.

- [ ] **Step 4: Commit**

```bash
git add app/(player)/room/[code]/page.tsx
git commit -m "feat(player): bolt fires on server confirm before locked state"
```

---

### Task 16: Mirror marquee + ceremony to `HostPhoneLive`

**Files:**
- Modify: `components/host/HostPhoneLive.tsx`

- [ ] **Step 1: Audit the file**

Read `components/host/HostPhoneLive.tsx`. Identify how the host's mirror currently renders the live question (it likely embeds a TVQuestion preview at smaller scale).

- [ ] **Step 2: Pass the same props through**

When the host renders the live question mirror, forward `themeKey`, `marqueeChips`, `spotlightedPlayerId`, and `lockInAnnouncement` exactly as TVStateMachine does. The mirror is just a smaller TV.

- [ ] **Step 3: Verify lightning beats also fire on the host's mirror**

The Lightning component is mounted via TVStage. Confirm host's mirror also has a TVStage wrapper. If not, `fireLightningBeat()` won't trigger there.

- [ ] **Step 4: Commit**

```bash
git add components/host/HostPhoneLive.tsx
git commit -m "feat(host): mirror renders marquee + ceremony on May theme"
```

---

### Task 17: Block mid-game theme changes (server + UI)

**Files:**
- Modify: the host admin route that handles theme updates (search `grep -rn "themeKey" app/api/`)
- Modify: the host UI theme picker (search `grep -rn "ThemePicker" app/`)
- Create: `tests/unit/api-theme-change.test.ts`

- [ ] **Step 1: Write the API test**

Follow the established pattern from `tests/unit/api-reset-night.test.ts` (vi.hoisted module mocks, makeRequest helper, beforeEach resetAllMocks).

```ts
// tests/unit/api-theme-change.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({ requireOwnedNight: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);

const NIGHT_ID = "11111111-1111-1111-1111-111111111111";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://test/api/nights/${NIGHT_ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

function makeCtx() {
  return { params: Promise.resolve({ id: NIGHT_ID }) };
}

function mockGamesQuery(liveGame: { id: string } | null) {
  return {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: liveGame, error: null }),
    update: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: NIGHT_ID }, error: null }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  authMock.requireOwnedNight.mockResolvedValue({ ok: true, night: { id: NIGHT_ID } });
});

describe("PATCH /api/nights/[id] theme guard", () => {
  it("returns 409 when a game is live", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(mockGamesQuery({ id: "g1" }));
    const { PATCH } = await import("@/app/api/nights/[id]/route");
    const res = await PATCH(makeRequest({ themeKey: "june" }), makeCtx());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/can't change theme/i);
  });

  it("returns 200 when no game is live", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(mockGamesQuery(null));
    const { PATCH } = await import("@/app/api/nights/[id]/route");
    const res = await PATCH(makeRequest({ themeKey: "june" }), makeCtx());
    expect(res.status).toBe(200);
  });
});
```

If the actual route is at a different path (e.g., `app/api/nights/[id]/theme/route.ts`), adjust the import + URL accordingly. Verify the actual location with: `grep -rln "themeKey" app/api/`.

- [ ] **Step 2: Update the route handler**

Add the guard:
```ts
const liveGame = await supabase
  .from("games")
  .select("id")
  .eq("night_id", nightId)
  .eq("status", "live")
  .maybeSingle();

if (liveGame.data) {
  return NextResponse.json(
    { error: "Can't change theme while a game is live. Finish or end the current game first." },
    { status: 409 }
  );
}
```

- [ ] **Step 3: Update the UI theme picker**

Disable the theme picker control when the current night has a live game. Show a tooltip / inline explanation.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/api-theme-change.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/ app/host/ tests/unit/api-theme-change.test.ts
git commit -m "feat(host): block theme changes while a game is live"
```

---

## Phase 8 — Polish, regression, validation

### Task 18: Make reveal wait up to 3s for the ceremony queue to drain

**Files:**
- Modify: `components/tv/TVStateMachine.tsx` (the reveal transition)
- Create: `tests/unit/reveal-pause.test.tsx`

- [ ] **Step 1: Extract the pause decision into a pure function**

Create a tiny helper that the TVStateMachine can call. Pure function = easy unit test.

```ts
// lib/tv/revealPause.ts
//
// Decides whether reveal should still be held back because ceremony events
// are pending. Pure function — testable without React.

export interface RevealPauseInput {
  /** Has the question timer expired? */
  timerExpired: boolean;
  /** Number of unprocessed ceremony events. */
  pendingCount: number;
  /** Date.now() when the timer first expired. null if not yet expired. */
  expiredAtMs: number | null;
  /** Date.now() at the moment of the call. */
  nowMs: number;
  /** Theme supports a ceremony (i.e., May/Storm). */
  ceremonyEnabled: boolean;
}

export const REVEAL_HOLD_MAX_MS = 3000;

export function shouldHoldReveal(input: RevealPauseInput): boolean {
  if (!input.timerExpired || !input.ceremonyEnabled) return false;
  if (input.pendingCount === 0) return false;
  if (input.expiredAtMs === null) return true;
  return input.nowMs - input.expiredAtMs < REVEAL_HOLD_MAX_MS;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/reveal-pause.test.ts
import { describe, it, expect } from "vitest";
import { shouldHoldReveal } from "@/lib/tv/revealPause";

describe("shouldHoldReveal", () => {
  it("returns false when the timer hasn't expired yet", () => {
    expect(
      shouldHoldReveal({
        timerExpired: false,
        pendingCount: 5,
        expiredAtMs: null,
        nowMs: 1000,
        ceremonyEnabled: true,
      })
    ).toBe(false);
  });

  it("returns false when ceremony is not enabled (non-May)", () => {
    expect(
      shouldHoldReveal({
        timerExpired: true,
        pendingCount: 5,
        expiredAtMs: 1000,
        nowMs: 1500,
        ceremonyEnabled: false,
      })
    ).toBe(false);
  });

  it("returns false when no events pending", () => {
    expect(
      shouldHoldReveal({
        timerExpired: true,
        pendingCount: 0,
        expiredAtMs: 1000,
        nowMs: 1500,
        ceremonyEnabled: true,
      })
    ).toBe(false);
  });

  it("returns true when events pending and within 3s of expiry", () => {
    expect(
      shouldHoldReveal({
        timerExpired: true,
        pendingCount: 3,
        expiredAtMs: 1000,
        nowMs: 2999, // 1999ms after expiry
        ceremonyEnabled: true,
      })
    ).toBe(true);
  });

  it("returns false when 3s+ has elapsed since expiry (hard cap)", () => {
    expect(
      shouldHoldReveal({
        timerExpired: true,
        pendingCount: 3,
        expiredAtMs: 1000,
        nowMs: 4001, // 3001ms after expiry
        ceremonyEnabled: true,
      })
    ).toBe(false);
  });

  it("returns true when expiredAtMs is null (just expired, no timestamp yet)", () => {
    expect(
      shouldHoldReveal({
        timerExpired: true,
        pendingCount: 1,
        expiredAtMs: null,
        nowMs: 1000,
        ceremonyEnabled: true,
      })
    ).toBe(true);
  });
});
```

- [ ] **Step 3: Wire it into TVStateMachine**

```tsx
import { shouldHoldReveal } from "@/lib/tv/revealPause";

const expiredAtRef = useRef<number | null>(null);

useEffect(() => {
  if (timerExpired && expiredAtRef.current === null) {
    expiredAtRef.current = Date.now();
  }
  if (!timerExpired) {
    expiredAtRef.current = null;
  }
}, [timerExpired]);

const holdReveal = shouldHoldReveal({
  timerExpired,
  pendingCount: ceremonyQueue.length,
  expiredAtMs: expiredAtRef.current,
  nowMs: Date.now(),
  ceremonyEnabled: hasCeremony(themeKey),
});

// In transition: only render the reveal sub-tree when !holdReveal
```

- [ ] **Step 2: Add the reveal-pause logic**

In `TVStateMachine.tsx`, near the live-question → reveal transition:

```tsx
const [revealHeld, setRevealHeld] = useState(false);
const revealHoldStartedAtRef = useRef<number | null>(null);

useEffect(() => {
  // When the timer expires AND we're on a May game
  if (timerExpired && hasCeremony(themeKey)) {
    if (ceremonyQueue.length > 0 && !revealHoldStartedAtRef.current) {
      setRevealHeld(true);
      revealHoldStartedAtRef.current = Date.now();
    }
    if (revealHoldStartedAtRef.current) {
      const elapsed = Date.now() - revealHoldStartedAtRef.current;
      if (ceremonyQueue.length === 0 || elapsed >= 3000) {
        setRevealHeld(false);
        revealHoldStartedAtRef.current = null;
      }
    }
  }
}, [timerExpired, ceremonyQueue, themeKey]);

// In the transition: only flip to reveal once revealHeld is false.
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/reveal-pause.test.ts`
Expected: PASS — 6 tests pass

Also run: `npx playwright test tests/e2e/auto-start-on-reveal.spec.ts`
Expected: PASS — adjust the existing e2e if the new 3s window changes its timing assumptions (the existing test likely runs on a non-May theme, so it should be unaffected; verify).

- [ ] **Step 5: Commit**

```bash
git add lib/tv/revealPause.ts components/tv/TVStateMachine.tsx tests/unit/reveal-pause.test.ts
git commit -m "feat(tv): reveal waits up to 3s for ceremony queue drain"
```

---

### Task 19: Update dev gallery + audit hardcoded 20s

**Files:**
- Modify: `app/dev/system/page.tsx` (line 151 reference to `seconds={14}` — verify nothing else hardcodes 20)
- Modify: `app/api/games/[id]/end-early/route.ts` (comment on line 1)
- Search: `grep -rn '\b20\b' app/ lib/ components/ | grep -iE "second|timer|duration"` and audit each hit

- [ ] **Step 1: Run the audit grep**

Run: `grep -rn '\b20\b' app/ lib/ components/ | grep -iE "second|timer|duration" | grep -v "test"`

For each remaining hit, decide:
- If it's a default that should now derive from theme → fix it
- If it's documentation about old behavior → update the doc to reflect theme-conditional
- If it's truly unrelated (e.g., 20% opacity) → leave it

- [ ] **Step 2: Fix the dev gallery static preview**

In `app/dev/system/page.tsx:151`, the static `TVTimerArc seconds={14}` is fine; but make sure a May-themed preview exists in the gallery so devs can see the marquee + ceremony locally.

- [ ] **Step 3: Update end-early comment**

In `app/api/games/[id]/end-early/route.ts:1`, replace "20s timer" with "question timer (20s default / 25s on May/Storm)".

- [ ] **Step 4: Commit**

```bash
git add app/dev/system/page.tsx app/api/games/[id]/end-early/route.ts
git commit -m "chore(timer): audit remaining 20s references + dev gallery preview"
```

---

### Task 20: E2E tests — May full flow + non-May regression guard

**Files:**
- Create: `tests/e2e/may-lightning-ceremony.spec.ts`
- Create: `tests/e2e/non-may-unchanged.spec.ts`

- [ ] **Step 1: Write `may-lightning-ceremony.spec.ts`**

Follow the existing harness pattern from `tests/e2e/full-game.spec.ts` (helpers from `./helpers/host-laptop`, `./helpers/tv`, `./helpers/player-phone`). Add a `themeKey: "may"` parameter to `seedNight` if not already supported.

```ts
// tests/e2e/may-lightning-ceremony.spec.ts
import { test, expect, type BrowserContext } from "@playwright/test";
import {
  loginAsHost,
  seedNight,
  startGame,
  revealViaApi,
  resetTestData,
} from "./helpers/host-laptop";
import { openTV } from "./helpers/tv";
import { joinPhone, tapAnswerSlot } from "./helpers/player-phone";
import { TID } from "./helpers/selectors";

test.describe.configure({ mode: "serial" });

test.describe("May theme — lightning ceremony", () => {
  test.setTimeout(120_000);

  let host: BrowserContext;
  let tv: BrowserContext;
  let p1: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    host = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    tv = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    p1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const cleanup = await host.newPage();
    await resetTestData(cleanup);
    await cleanup.close();
  });

  test.afterAll(async () => {
    await Promise.all([host, tv, p1].map((c) => c.close().catch(() => {})));
  });

  test("tap → server confirm → phone bolt + TV marquee strike", async () => {
    const hostPage = await host.newPage();
    const tvPage = await tv.newPage();
    const phone1 = await p1.newPage();

    await loginAsHost(hostPage);
    const { nightId, roomCode } = await seedNight(hostPage, { themeKey: "may" });
    await startGame(hostPage, nightId);

    await openTV(tvPage, roomCode);
    await joinPhone(phone1, roomCode, "TEST-MARK");

    const question = await revealViaApi(nightId, 0);

    // Phone-side: tap option 2 → bolt appears → PlayerLocked screen
    await tapAnswerSlot(phone1, 2);
    await expect(phone1.locator("[data-testid='phone-bolt']")).toBeVisible({ timeout: 1500 });
    await expect(phone1.locator(TID.playerLocked)).toBeVisible({ timeout: 3000 });

    // TV-side: marquee chip enters spotlight state
    const chip = tvPage.locator("[data-testid='marquee-chip'][data-player-id]").filter({ hasText: "TEST-MARK" });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("data-spotlight", "true", { timeout: 2000 });

    // aria-live announcement received
    await expect(tvPage.getByRole("status").first()).toContainText("TEST-MARK locked in");
  });

  test("storm mode — 10 fast locks all get ceremonies", async ({ browser }) => {
    // Spawn 10 concurrent player contexts; all tap within ~2s.
    // For each player, assert their chip eventually receives data-spotlight=true
    // OR (in storm mode) at minimum a strike effect on their chip is recorded.
    // The seenLocksRef set in TVStateMachine guarantees no missed acknowledgements.
    const contexts = await Promise.all(
      Array.from({ length: 10 }, () =>
        browser.newContext({ viewport: { width: 390, height: 844 } })
      )
    );
    try {
      const hostPage = await host.newPage();
      const tvPage = await tv.newPage();
      await loginAsHost(hostPage);
      const { nightId, roomCode } = await seedNight(hostPage, { themeKey: "may" });
      await startGame(hostPage, nightId);
      await openTV(tvPage, roomCode);

      const phones = await Promise.all(
        contexts.map(async (c, i) => {
          const p = await c.newPage();
          await joinPhone(p, roomCode, `STORM-${i}`);
          return p;
        })
      );

      await revealViaApi(nightId, 0);
      // Hammer: all 10 phones tap within ~1s.
      await Promise.all(phones.map((p) => tapAnswerSlot(p, 2)));

      // Verify each player's chip has been acknowledged (visited spotlight or recorded as locked)
      for (let i = 0; i < phones.length; i++) {
        const chip = tvPage.locator("[data-testid='marquee-chip']").filter({ hasText: `STORM-${i}` });
        await expect(chip).toBeVisible({ timeout: 10_000 });
      }
    } finally {
      await Promise.all(contexts.map((c) => c.close().catch(() => {})));
    }
  });
});
```

- [ ] **Step 2: Write `non-may-unchanged.spec.ts`**

```ts
// tests/e2e/non-may-unchanged.spec.ts
import { test, expect, type BrowserContext } from "@playwright/test";
import {
  loginAsHost,
  seedNight,
  startGame,
  revealViaApi,
  resetTestData,
} from "./helpers/host-laptop";
import { openTV } from "./helpers/tv";
import { joinPhone, tapAnswerSlot } from "./helpers/player-phone";
import { TID } from "./helpers/selectors";

test.describe.configure({ mode: "serial" });

test.describe("House theme — unchanged regression guard", () => {
  test.setTimeout(60_000);

  let host: BrowserContext;
  let tv: BrowserContext;
  let p1: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    host = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    tv = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    p1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const cleanup = await host.newPage();
    await resetTestData(cleanup);
    await cleanup.close();
  });

  test.afterAll(async () => {
    await Promise.all([host, tv, p1].map((c) => c.close().catch(() => {})));
  });

  test("House theme: no marquee, no phone bolt, existing pile renders", async () => {
    const hostPage = await host.newPage();
    const tvPage = await tv.newPage();
    const phone1 = await p1.newPage();

    await loginAsHost(hostPage);
    const { nightId, roomCode } = await seedNight(hostPage, { themeKey: "house" });
    await startGame(hostPage, nightId);
    await openTV(tvPage, roomCode);
    await joinPhone(phone1, roomCode, "HOUSE-TEST");

    await revealViaApi(nightId, 0);

    // TV: marquee should NOT render; existing pile should
    await expect(tvPage.locator("[data-testid='tv-scoreboard-marquee']")).toHaveCount(0);
    await expect(tvPage.locator("[data-testid='tv-question-pile']")).toBeVisible();

    // Phone tap → no bolt; PlayerLocked appears as usual
    await tapAnswerSlot(phone1, 2);
    await expect(phone1.locator("[data-testid='phone-bolt']")).toHaveCount(0);
    await expect(phone1.locator(TID.playerLocked)).toBeVisible({ timeout: 3000 });
  });
});
```

**Note:** The `seedNight` helper may need extension to accept `themeKey`. Verify in `tests/e2e/helpers/host-laptop.ts`; if missing, add it (small change). The `TID.playerLocked` selector should already exist in `tests/e2e/helpers/selectors.ts`.

- [ ] **Step 3: Run E2E suite**

Run: `npx playwright test tests/e2e/may-lightning-ceremony.spec.ts tests/e2e/non-may-unchanged.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/may-lightning-ceremony.spec.ts tests/e2e/non-may-unchanged.spec.ts
git commit -m "test(e2e): May ceremony + non-May regression guard"
```

---

### Task 21: Extend `full-flow-prod.mjs` to validate both theme paths

**Files:**
- Modify: `scripts/full-flow-prod.mjs`

- [ ] **Step 1: Read the existing script**

Open `scripts/full-flow-prod.mjs` and understand its current single-theme run.

- [ ] **Step 2: Run a May variant**

Add a second pass that creates a May-themed night, runs the full arc, and asserts:
- Question timer counts down from 25s (verified via a sample API check)
- A lock-in broadcast results in a marquee chip spotlight state (verified via screenshot or DOM read against the deployed TV URL)
- All locked players have a corresponding "ceremony fired" marker (or, more lightly, that no lock is left silent — by reading the locks API)

- [ ] **Step 3: Run a non-May regression pass**

Existing single-theme pass already covers this — extend it to assert the *absence* of the marquee in the rendered TV.

- [ ] **Step 4: Run the script against prod**

Run: `node scripts/full-flow-prod.mjs`
Expected: both passes green (~90s total)

- [ ] **Step 5: Commit**

```bash
git add scripts/full-flow-prod.mjs
git commit -m "test(prod): full-flow validates both May and non-May themes"
```

---

## Self-review checklist (for the engineer executing the plan)

Before opening the PR:

- [ ] All 21 tasks complete; each commit landed
- [ ] `npx vitest run` clean
- [ ] `npx playwright test tests/e2e/may-lightning-ceremony.spec.ts tests/e2e/non-may-unchanged.spec.ts` clean
- [ ] `node scripts/full-flow-prod.mjs` clean (both theme passes)
- [ ] Manual verification on actual Chromecast / HDMI stick with a May-themed game and 5+ phones
- [ ] No remaining hardcoded `20` for question duration in non-test code (re-run the audit grep)
- [ ] PR description references the spec doc and lists rollback plan (theme switch override)

## Rollout note

- Theme-gated: instant rollback by switching the night's theme away from May
- the first host goes live 2026-05-27. May ends 2026-05-31. Confirm with Brandon whether the first host should pin May or whether June theme work is queued for follow-up.
- Emergency override: `?theme=house` URL flag for in-session fallback.

---

## Open issues for the engineer to escalate (don't fix silently)

If during implementation any of these surfaces, stop and escalate:

1. **`fireLightningBeat` already has a 2nd argument incompatible with `{ tint }`** — coordinate with whoever owns the storm theme; don't break existing callsites.
2. **Phone bolt animation drops frames on iPhone SE / low-end Android** — the `generateBolt` complexity may need lowering. Don't ship a janky strike.
3. **Storm mode produces 30 simultaneous SVG elements that thrash the TV's GPU** — switch to a single canvas approach if frame rate drops below ~30fps on the Chromecast test.
4. **Reveal pause causes the existing `auto-start-on-reveal.spec.ts` to break in a way that can't be fixed by adjusting test timings alone** — the reveal contract may have changed; coordinate with Brandon before declaring victory.
5. **AI-prompt change to 25s produces noticeably easier questions** — Brandon may want to re-tune Claude's difficulty prompt for May only.
