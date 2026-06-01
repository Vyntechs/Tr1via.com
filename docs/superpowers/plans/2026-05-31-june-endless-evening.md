# June "Endless Evening" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace June's flat static gradient with a living, sky-led summer-evening atmosphere (warm drifting color-field + thin cool water shimmer at the bottom) that reacts to two game moments — lock-in and reveal — with light only, no objects.

**Architecture:** June's atmosphere is one new self-contained component, `JuneSky`, rendered by the existing `Weather` switch for `case "june"`. It reuses the module-level beat pattern already proven by `Lightning.tsx` (`fireLightningBeat`/`subscribeBeat`) — a new `fireJuneBeat("lock" | "reveal")` lets game-state callsites pulse the sky without prop-threading. All motion is CSS keyframes (added to `app/globals.css`) honoring `prefers-reduced-motion`. The palette is tuned in `lib/theme/tokens.ts`. TV-only, like all weather. No new dependencies.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4 (`@theme` + CSS keyframes in `app/globals.css`), the existing theme engine (`lib/theme/*` → `app/themes.generated.css`), Vitest for unit tests.

---

## Design ground truth (verified against the codebase)

- `Weather` (`components/system/Weather.tsx`) switches on `themeKey`; `case "june"` currently returns `<SunShimmer color={t.accent} />` (line 95), a static double radial-gradient (lines 221–232). `weatherLabel` returns `"sun shimmer"` for june (line 244).
- `Weather` is rendered ONLY by `TVStage` (`components/shells/TVStage.tsx:53-59`) — so this is TV-only by construction. `TVStage` passes `themeKey`, `intensity`, `lightningTriggerCount`.
- `Lightning.tsx` exposes the module-beat pattern to copy exactly: `const beatListeners = new Set<BeatListener>()` (line 53), `subscribeBeat(fn): () => void` (line 56), `export function fireLightningBeat(distance, opts)` (line 74). Mounted components subscribe in a `useEffect` and unsubscribe on cleanup. We mirror this for June.
- The TV state machine (`components/tv/TVStateMachine.tsx`) already has the two trigger points:
  - **Lock-in:** `TVQuestionView` enqueues a ceremony for each newly-seen lock at lines 465-480 (`newlyLocked` loop). That is the exact spot a lock-in beat fires.
  - **Reveal:** `TVRevealView` renders when `stickyReveal && targetQuestion.finishedAt` (line 212, returns `<TVRevealView …>` at line 238). `TVRevealView` mounting == the reveal moment.
- `prefers-reduced-motion`: `usePrefersReducedMotion()` (`lib/hooks/usePrefersReducedMotion.ts`) returns a boolean; `ParticleField` returns `null` when reduced; `globals.css` also neutralizes pure-CSS animations via a catch-all `@media (prefers-reduced-motion: reduce)`. June renders a static gradient when reduced.
- Existing keyframes live in `app/globals.css` (lines 28-60), all prefixed `tr1via-`. We add new ones with the same prefix.
- Theme tests to keep green: `tests/unit/theme.test.ts`, `tests/unit/weatherLabel.test.ts`. `weatherLabel.test.ts` only asserts every key returns a truthy label + unknown → `"ambient"`, so changing june's label string is safe.
- Dev gallery: `app/dev/tv/page.tsx` renders frames inside `<Frame>` with a theme `<select>`. Weather only shows through `TVStage`, which the gallery frames do NOT use (they render TV components directly). The real verification surface is the `/tv/[code]` route + host console; the gallery is for component layout only. We still add a dedicated June atmosphere preview frame so the sky can be eyeballed in isolation.

## File structure

- **Create** `components/system/JuneSky.tsx` — the entire June atmosphere: resting sky + water shimmer, the `fireJuneBeat`/`subscribeBeat` module beat, and the lock/reveal reactions. One responsibility: render and animate the June evening.
- **Create** `tests/unit/juneSky.test.tsx` — unit tests for the beat module (`fireJuneBeat` notifies subscribers; unsubscribe works) and that `JuneSky` renders nothing-breaking under reduced motion.
- **Modify** `components/system/Weather.tsx` — `case "june"` returns `<JuneSky intensity={…} />` instead of `SunShimmer`; update `weatherLabel` june string; remove the now-unused `SunShimmer` if nothing else uses it.
- **Modify** `app/globals.css` — add `tr1via-june-drift`, `tr1via-june-shimmer`, `tr1via-june-breathe` keyframes.
- **Modify** `lib/theme/tokens.ts` — tune the `june` ThemeDef for the sky-led evening palette.
- **Modify** `components/system/index.ts` — export `JuneSky`, `fireJuneBeat`.
- **Modify** `components/tv/TVStateMachine.tsx` — fire `fireJuneBeat("lock")` on newly-seen lock-ins (june only); fire `fireJuneBeat("reveal")` when the reveal view mounts (june only).
- **Modify** `app/dev/tv/page.tsx` — add a "00 · June atmosphere" preview frame wrapping `JuneSky` in a TVStage-like box so it's eyeballable.

---

### Task 1: Tune the June palette for the sky-led evening

**Files:**
- Modify: `lib/theme/tokens.ts:47` (the `june` ThemeDef)
- Test: `tests/unit/theme.test.ts` (existing — must stay green)

June today: `paper #FCDEC8, ink #26120A, accent #E04A6B, pop #F2A02D, correct #3F8030, wrong #A92E22, mode light`. The plan keeps `mode: light` and the existing answer colors (correct/wrong/accent) so the game reads unchanged, and warms `paper`/`pop` toward the drifting-evening sky. The atmosphere itself (gradients) lives in `JuneSky`, not the tokens — tokens only set the base `paper` the sky sits over and the `ink` text color.

- [ ] **Step 1: Update the june ThemeDef**

In `lib/theme/tokens.ts`, replace the `june` line (line 47):

```ts
  june:      { name: "June · Summer",        mode: "light", paper: "#F7D9B0", ink: "#2A1620", accent: "#E04A6B", pop: "#F2A02D", correct: "#3F8030", wrong: "#A92E22" },
```

(Rationale: `paper` shifts from the pinkish cream `#FCDEC8` to a warmer golden horizon tone `#F7D9B0` that reads as the bottom of an evening sky; `ink` deepens slightly to `#2A1620` for contrast against the warmer paper. Accent/pop/correct/wrong unchanged so answer semantics are identical.)

- [ ] **Step 2: Regenerate the theme CSS**

Run: `npx tsx lib/theme/__build__.ts`
Expected: `Wrote /Volumes/Creativity/dev/projects/tr1via/app/themes.generated.css (14 themes)`

- [ ] **Step 3: Run theme tests**

Run: `npx vitest run tests/unit/theme.test.ts`
Expected: PASS (the test only checks derived tokens are truthy for every key — palette value changes don't break it).

- [ ] **Step 4: Commit**

```bash
git add lib/theme/tokens.ts app/themes.generated.css
git commit -m "feat(theme): warm June palette toward the evening-sky horizon"
```

---

### Task 2: Add the June motion keyframes

**Files:**
- Modify: `app/globals.css` (after the existing keyframes block, before the `@media (prefers-reduced-motion)` block at line ~62)

- [ ] **Step 1: Add three keyframes**

In `app/globals.css`, insert immediately after the `tr1via-spin` keyframe (line 60), before the `/* Respect user preference for reduced motion */` comment:

```css
/* June "Endless Evening" — sky drift, water shimmer, reactive breathe.
   Slow on purpose: the resting sky is ambient, never attention-grabbing. */
@keyframes tr1via-june-drift {
  0%   { background-position: 0% 0%, 100% 0%, 0% 0%; }
  50%  { background-position: 40% 25%, 60% 35%, 0% 0%; }
  100% { background-position: 0% 0%, 100% 0%, 0% 0%; }
}
@keyframes tr1via-june-shimmer {
  0%   { transform: translateX(0) scaleY(1); opacity: .55; }
  50%  { transform: translateX(-14px) scaleY(1.06); opacity: .75; }
  100% { transform: translateX(0) scaleY(1); opacity: .55; }
}
@keyframes tr1via-june-breathe {
  0%   { opacity: 0; }
  18%  { opacity: 1; }
  100% { opacity: 0; }
}
```

- [ ] **Step 2: Verify the CSS still parses (build the theme + typecheck don't touch CSS, so just confirm dev compiles)**

Run: `npx tsc --noEmit`
Expected: PASS (no TS errors; CSS isn't type-checked but this confirms nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat(theme): June sky-drift, water-shimmer, breathe keyframes"
```

---

### Task 3: Build the JuneSky beat module (TDD)

**Files:**
- Create: `components/system/JuneSky.tsx`
- Test: `tests/unit/juneSky.test.tsx`

The module-level beat mirrors `Lightning.tsx` exactly: a `Set` of listeners, a `subscribeBeat` returning an unsubscribe, and an exported `fireJuneBeat`. This task builds ONLY the beat plumbing + a minimal component shell so we can test the beat in isolation. The visual layers come in Task 4.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/juneSky.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { fireJuneBeat, __subscribeJuneBeatForTest } from "@/components/system/JuneSky";

describe("June beat module", () => {
  it("notifies subscribers when a beat fires", () => {
    const seen: string[] = [];
    const unsub = __subscribeJuneBeatForTest((kind) => seen.push(kind));
    fireJuneBeat("lock");
    fireJuneBeat("reveal");
    expect(seen).toEqual(["lock", "reveal"]);
    unsub();
  });

  it("stops notifying after unsubscribe", () => {
    const fn = vi.fn();
    const unsub = __subscribeJuneBeatForTest(fn);
    unsub();
    fireJuneBeat("lock");
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/juneSky.test.tsx`
Expected: FAIL — cannot resolve `@/components/system/JuneSky`.

- [ ] **Step 3: Create the module with the beat plumbing + shell**

Create `components/system/JuneSky.tsx`:

```tsx
// June "Endless Evening" — the summer-evening atmosphere for the june theme.
//
// A living, sky-led color-field (warm coral/gold/periwinkle drifting, never
// quite repeating) with a thin cool water shimmer along the bottom edge. No
// objects, ever — pure light + motion. Rendered only via Weather → TVStage,
// so it is TV-only by construction.
//
// Reacts to two game moments via a module-level beat (mirrors Lightning.tsx's
// fireLightningBeat pattern so game-state callsites don't have to thread a
// prop 3-4 levels down through every TVStage):
//   • "lock"   — a player committed; the sky warms a touch.
//   • "reveal" — the answer is shown; the horizon swells + a soft bloom rises.
//
// Honors prefers-reduced-motion: renders a tasteful static gradient, no motion.

"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

export type JuneBeatKind = "lock" | "reveal";
type JuneBeatListener = (kind: JuneBeatKind) => void;

const beatListeners = new Set<JuneBeatListener>();

function subscribeJuneBeat(fn: JuneBeatListener): () => void {
  beatListeners.add(fn);
  return () => beatListeners.delete(fn);
}

/** Test-only alias so unit tests can subscribe without a mounted component. */
export const __subscribeJuneBeatForTest = subscribeJuneBeat;

/** Pulse the June sky from a game-state callsite. No-op unless a JuneSky is
 *  mounted (i.e. the current theme is june and a TVStage is on screen). */
export function fireJuneBeat(kind: JuneBeatKind): void {
  for (const fn of beatListeners) fn(kind);
}

export interface JuneSkyProps {
  /** 0 = off, 1 = default, >1 = heightened (finale). Matches Weather's contract. */
  intensity?: number;
}

export function JuneSky({ intensity = 1 }: JuneSkyProps) {
  const reduced = usePrefersReducedMotion();
  // beat state drives the reactive overlays; set in Task 4.
  const [, setBeat] = useState<{ kind: JuneBeatKind; at: number } | null>(null);
  const clearRef = useRef<number | null>(null);

  useEffect(() => {
    const unsub = subscribeJuneBeat((kind) => {
      setBeat({ kind, at: Date.now() });
      if (clearRef.current) window.clearTimeout(clearRef.current);
      clearRef.current = window.setTimeout(() => setBeat(null), 1400);
    });
    return () => {
      unsub();
      if (clearRef.current) window.clearTimeout(clearRef.current);
    };
  }, []);

  if (intensity <= 0) return null;

  // Visual layers added in Task 4. For now render the static base so the
  // theme never looks broken mid-implementation.
  return (
    <div
      data-testid="june-sky"
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        background:
          "linear-gradient(180deg,#6E5DB6 0%, #C56E84 52%, #F2A65C 100%)",
        opacity: reduced ? 1 : 1,
      }}
    />
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/juneSky.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add components/system/JuneSky.tsx tests/unit/juneSky.test.tsx
git commit -m "feat(theme): JuneSky beat module + static base (TDD)"
```

---

### Task 4: Build the JuneSky visual layers (resting + reactive)

**Files:**
- Modify: `components/system/JuneSky.tsx`

This replaces the static shell's `return` with the real layered atmosphere: a drifting warm sky, a thin cool water shimmer at the bottom, a horizon glow, and two reactive overlays driven by `beat`. Reduced-motion renders the static gradient only.

- [ ] **Step 1: Replace the component body**

In `components/system/JuneSky.tsx`, replace the `JuneSky` function body from `if (intensity <= 0) return null;` to the end of the function with:

```tsx
  if (intensity <= 0) return null;

  // Reduced motion: a single calm static evening gradient. No animation,
  // no reactive overlays.
  if (reduced) {
    return (
      <div
        data-testid="june-sky"
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "linear-gradient(180deg,#6E5DB6 0%, #C56E84 52%, #F7D9B0 100%)",
        }}
      />
    );
  }

  const lockActive = beat?.kind === "lock";
  const revealActive = beat?.kind === "reveal";

  return (
    <div
      data-testid="june-sky"
      aria-hidden
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}
    >
      {/* Layer 1 — the drifting warm sky (sky-led: fills the whole stage). */}
      <div
        style={{
          position: "absolute",
          inset: "-20%",
          filter: "blur(6px)",
          background:
            "radial-gradient(55% 50% at 28% 22%, #F6B45C 0%, transparent 60%)," +
            "radial-gradient(60% 55% at 82% 26%, #E85C82 0%, transparent 60%)," +
            "linear-gradient(180deg,#6E5DB6 0%, #C56E84 52%, #F2A65C 100%)",
          backgroundSize: "200% 200%, 200% 200%, 100% 100%",
          animation: "tr1via-june-drift 18s ease-in-out infinite",
          // Lock-in warms the whole field a touch via saturation/brightness.
          filter: lockActive ? "blur(6px) saturate(1.18) brightness(1.06)" : "blur(6px)",
          transition: "filter 700ms ease-out",
        }}
      />

      {/* Layer 2 — thin cool water shimmer along the very bottom (the sliver). */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "18%",
          mixBlendMode: "screen",
          background:
            "radial-gradient(closest-side, rgba(190,255,248,.55), transparent 70%) 18% 60%/110px 60px," +
            "radial-gradient(closest-side, rgba(210,255,250,.45), transparent 70%) 62% 70%/140px 70px," +
            "radial-gradient(closest-side, rgba(255,245,220,.5), transparent 70%) 84% 55%/90px 50px",
          backgroundRepeat: "no-repeat",
          filter: "blur(2px)",
          animation: "tr1via-june-shimmer 9s ease-in-out infinite",
        }}
      />

      {/* Layer 3 — the glowing horizon seam where sky meets water. Swells on reveal. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: "16%",
          height: revealActive ? "44px" : "26px",
          background:
            "linear-gradient(180deg, transparent 0%, rgba(255,236,190,.7) 50%, rgba(160,220,225,.35) 70%, transparent 100%)",
          filter: "blur(2px)",
          opacity: revealActive ? 1 : 0.7,
          transition: "height 600ms ease-out, opacity 600ms ease-out",
        }}
      />

      {/* Layer 4 — reveal bloom: a soft light rising once when "reveal" fires.
          key={beat.at} restarts the one-shot breathe animation each reveal. */}
      {revealActive && (
        <div
          key={beat?.at}
          style={{
            position: "absolute",
            left: "50%",
            bottom: "10%",
            width: "60%",
            height: "55%",
            transform: "translateX(-50%)",
            background:
              "radial-gradient(closest-side, rgba(255,238,200,.6), transparent 72%)",
            animation: "tr1via-june-breathe 1300ms ease-out forwards",
          }}
        />
      )}
    </div>
  );
```

Note: the duplicate `filter` key in Layer 1 above is intentional shorthand in this snippet — when implementing, keep ONLY the second `filter` line (the conditional one) and delete the first `filter: "blur(6px)"` line so there's a single `filter` property. The transition handles the animation between states.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Re-run the beat tests (still green)**

Run: `npx vitest run tests/unit/juneSky.test.tsx`
Expected: PASS (2 tests — the module behavior is unchanged).

- [ ] **Step 4: Commit**

```bash
git add components/system/JuneSky.tsx
git commit -m "feat(theme): JuneSky layered atmosphere + reactive lock/reveal"
```

---

### Task 5: Wire JuneSky into Weather + exports

**Files:**
- Modify: `components/system/Weather.tsx:95` (the `case "june"`), `:244` (`weatherLabel`), and `SunShimmer` (lines 221-232) if now unused
- Modify: `components/system/index.ts`

(Note: there is no `weatherLabel`/`Weather` unit test in the repo — verified — so this task gates on `tsc` only, not a label test.)

- [ ] **Step 1: Swap the june case**

In `components/system/Weather.tsx`, change the import line 12 area to add JuneSky and replace `case "june"` (line 95):

Add to the imports near the top (after the existing `Lightning` import, line 11):

```tsx
import { JuneSky } from "./JuneSky";
```

Replace line 95:

```tsx
    case "june":
      return <JuneSky intensity={intensity} />;
```

- [ ] **Step 2: Update the weatherLabel for june**

In `components/system/Weather.tsx`, change the june entry in the `weatherLabel` map (line 244) from `june: "sun shimmer",` to:

```tsx
    june: "endless evening",
```

- [ ] **Step 3: Remove the now-unused SunShimmer**

Confirm nothing else references it:

Run: `grep -rn "SunShimmer" components app lib`
Expected: only the definition in `Weather.tsx`. If so, delete the `SunShimmer` function (lines 221-232). If `grep` shows another user, leave it.

- [ ] **Step 4: Export JuneSky + fireJuneBeat**

In `components/system/index.ts`, after the `Lightning` export (line 17), add:

```tsx
export { JuneSky, fireJuneBeat } from "./JuneSky";
export type { JuneBeatKind } from "./JuneSky";
```

- [ ] **Step 5: Typecheck + full unit suite (no weatherLabel test exists)**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS — tsc clean; full suite green (nothing imports `SunShimmer` or asserts the june label, so removal/relabel is safe).

- [ ] **Step 6: Commit**

```bash
git add components/system/Weather.tsx components/system/index.ts
git commit -m "feat(theme): render JuneSky for june; retire SunShimmer"
```

---

### Task 6: Fire the lock-in + reveal beats from the TV state machine

**Files:**
- Modify: `components/tv/TVStateMachine.tsx` — import `fireJuneBeat`; fire on new lock-ins (june only) and on reveal mount (june only)

The beat is a no-op unless a `JuneSky` is mounted, but we still gate on `themeKey === "june"` so the intent is explicit and we never fire on other themes.

- [ ] **Step 1: Import fireJuneBeat**

In `components/tv/TVStateMachine.tsx`, add to the `@/components/system` imports. There is no existing system import block, so add a new import after line 58 (`import type { ThemeKey } from "@/lib/theme/tokens";`):

```tsx
import { fireJuneBeat } from "@/components/system";
```

- [ ] **Step 2: Fire the lock-in beat on newly-seen locks**

In `TVQuestionView`, inside the `useEffect` that enqueues ceremonies (lines 465-480), the `newlyLocked` array already holds the just-arrived locks. Add a June pulse when there are new locks. Replace the block:

```tsx
  useEffect(() => {
    if (!hasCeremony(themeKey)) return;
    const newlyLocked = lockedAnswers.filter((a) => !seenLocksRef.current.has(a.player_id));
    for (const a of newlyLocked) seenLocksRef.current.add(a.player_id);
    if (newlyLocked.length > 0) {
```

with:

```tsx
  useEffect(() => {
    // June pulses the sky on every new lock-in, independent of the May-only
    // ceremony queue. Compute new locks first so both paths can use them.
    const newlyLockedAll = lockedAnswers.filter((a) => !juneSeenLocksRef.current.has(a.player_id));
    if (themeKey === "june" && newlyLockedAll.length > 0) {
      for (const a of newlyLockedAll) juneSeenLocksRef.current.add(a.player_id);
      fireJuneBeat("lock");
    }
    if (!hasCeremony(themeKey)) return;
    const newlyLocked = lockedAnswers.filter((a) => !seenLocksRef.current.has(a.player_id));
    for (const a of newlyLocked) seenLocksRef.current.add(a.player_id);
    if (newlyLocked.length > 0) {
```

- [ ] **Step 3: Add the june-specific seen-locks ref**

In `TVQuestionView`, next to `seenLocksRef` (line 462), add a separate ref so June's de-dup is independent of the May ceremony de-dup:

```tsx
  const seenLocksRef = useRef<Set<string>>(new Set());
  // June de-dups lock pulses separately from the May ceremony queue.
  const juneSeenLocksRef = useRef<Set<string>>(new Set());
```

- [ ] **Step 4: Fire the reveal beat when the reveal view mounts**

In `TVRevealView` (starts line 566), add a `useEffect` that fires once on mount when the theme is june. `TVRevealView` does not currently receive `themeKey`, so thread it in. First update the call site (line 238):

```tsx
      return <TVRevealView snapshot={snapshot} question={targetQuestion} themeKey={themeKey} />;
```

Then update the `TVRevealView` signature + body. Change the function declaration (lines 566-571):

```tsx
function TVRevealView({
  snapshot,
  question,
  themeKey,
}: {
  snapshot: TVSnapshot;
  question: TVSnapshot["questions"][number];
  themeKey?: ThemeKey;
}) {
  useEffect(() => {
    if (themeKey === "june") fireJuneBeat("reveal");
  }, [themeKey]);
```

(`useEffect` is already imported on line 29.)

- [ ] **Step 5: Typecheck + full unit suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS — tsc clean; full suite green (the new juneSky tests included, existing suite unaffected).

- [ ] **Step 6: Commit**

```bash
git add components/tv/TVStateMachine.tsx
git commit -m "feat(tv): fire June lock-in + reveal beats on june nights"
```

---

### Task 7: Add a June atmosphere preview to the dev gallery

**Files:**
- Modify: `app/dev/tv/page.tsx`

The gallery frames render TV components directly (no `TVStage`), so the weather never shows there. Add one dedicated frame that mounts `JuneSky` inside a TVStage-like box so the sky can be eyeballed and the beats fired manually.

- [ ] **Step 1: Import JuneSky + fireJuneBeat**

In `app/dev/tv/page.tsx`, add after the `@/components/system` import (line 44):

```tsx
import { JuneSky, fireJuneBeat } from "@/components/system";
```

- [ ] **Step 2: Add a preview frame**

In `app/dev/tv/page.tsx`, add as the FIRST child inside the `flexDirection: "column", gap: 56` container (immediately before `<Frame label="01 · Lobby">`, line 98):

```tsx
          <Frame label="00 · June · Endless Evening atmosphere">
            <div style={{ position: "relative", width: "100%", height: "100%", background: "#6E5DB6" }}>
              <JuneSky />
              <div style={{ position: "absolute", inset: 0, display: "flex", gap: 12, alignItems: "flex-end", padding: 24 }}>
                <button className="mock-button" onClick={() => fireJuneBeat("lock")} style={{ pointerEvents: "auto", padding: "8px 14px", borderRadius: 8 }}>
                  Fire lock-in
                </button>
                <button className="mock-button" onClick={() => fireJuneBeat("reveal")} style={{ pointerEvents: "auto", padding: "8px 14px", borderRadius: 8 }}>
                  Fire reveal
                </button>
              </div>
            </div>
          </Frame>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual eyeball (dev server)**

Run: `npm run dev -- -p 3030`
Open `http://localhost:3030/dev/tv`. Confirm frame "00" shows a drifting warm sky with a cool shimmer at the bottom; clicking "Fire lock-in" warms the field; "Fire reveal" swells the horizon + a bloom rises. Stop the server when done.

- [ ] **Step 5: Commit**

```bash
git add app/dev/tv/page.tsx
git commit -m "chore(dev): June atmosphere preview frame in the TV gallery"
```

---

### Task 8: Validation gate (project rules) + PR

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + unit suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass (note: ESLint is known-broken via `@eslint/eslintrc` — do NOT gate on `npm run lint`).

- [ ] **Step 2: Full-flow prod driver (reveal + lock-in are exercised)**

Run: `SMOKE_THEME_SINGLE=june node --env-file=.env.local scripts/full-flow-prod.mjs > /tmp/june-fullflow.log 2>&1; echo "exit=$?"`
Expected: `exit=0` and the log ends with a GREEN summary. (Do NOT pipe through `tee` — it masks the exit code. Per lessons.md.)
If it needs a deployed field that only exists on this branch, point at local dev instead: `SMOKE_BASE_URL=http://localhost:3030` with `npm run dev` running. June's changes add no new API fields, so prod should work directly.

- [ ] **Step 2a: Read the log to confirm GREEN (don't trust exit code alone)**

Run: `grep -iE "GREEN|RED|FAIL|leaderboard" /tmp/june-fullflow.log | tail -20`
Expected: a GREEN summary, no RED/FAIL lines.

- [ ] **Step 3: Real-route browser pass on prod**

Drive a real June night and screenshot: the `/tv/[code]` resting sky, a lock-in (sky warms), and the reveal (horizon swell + bloom). Use a `@tr1via.test` host so it doesn't collide with the founder dashboard (per lessons.md). Save screenshots to repo root as `verify-june-tv-resting.png`, `verify-june-tv-lockin.png`, `verify-june-tv-reveal.png`.

- [ ] **Step 4: Push the branch + open the PR into staging**

```bash
git push -u origin june-endless-evening
gh pr create --base staging --head june-endless-evening \
  --title "June 'Endless Evening' — living summer-evening atmosphere" \
  --body "$(cat <<'EOF'
## What
Replaces June's flat static gradient with a living, sky-led summer-evening atmosphere — a warm drifting color-field with a thin cool water shimmer at the bottom — that reacts to two game moments with light only (no objects):
- **Lock-in:** the sky warms as players commit.
- **Reveal:** the horizon swells and a soft bloom rises behind the answer.

Spec: `docs/superpowers/specs/2026-05-31-june-endless-evening-design.md`
Plan: `docs/superpowers/plans/2026-05-31-june-endless-evening.md`

## Scope
June theme only. No other months, no app-wide moment rework, no game-logic change. Honors `prefers-reduced-motion` (static gradient fallback). TV-only (rendered via TVStage).

## Validation
- `tsc` clean, full `vitest` suite green (incl. new `juneSky.test.tsx`).
- `full-flow-prod.mjs` (june) GREEN — reveal/lock-in exercised.
- Real-route `/tv/[code]` screenshots: resting / lock-in / reveal (attached).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opened into `staging`. **Brandon merges — never push to main.**

- [ ] **Step 5: Update HANDOFF + todo, capture any lesson**

Mark the todo block done, note the open PR in `HANDOFF.md`, and add a lesson to `tasks/lessons.md` only if something non-obvious surfaced during the build.

---

## Self-review

**Spec coverage:**
- Resting sky (warm drift + cool water sliver + horizon glow) → Task 4 layers 1-3. ✓
- 3 reactive beats: idle (always-on resting) → Task 4; lock-in warmth → Task 4 (layer 1 filter) + Task 6; reveal bloom behind correct answer → Task 4 (layers 3-4) + Task 6. ✓ (Note: the bloom is centered on the stage, not pixel-aligned behind the specific answer card — `JuneSky` is a background layer beneath `TVReveal` and doesn't know the card's geometry. This matches "soft bloom of light rises" as atmosphere; pixel-locking to the card would require coupling the sky to TVReveal's internals, which the spec's "the light reacts, nothing gets added" favors avoiding. Flagged for Brandon at review.)
- No objects → only gradients/blurs used; `SunShimmer` retired, no motifs imported. ✓
- Restraint rule (motion quiets during question reading) → the resting drift is already slow/ambient; no new motion fires during a question except the brief lock pulse. The spec's "quiet while reading" is honored by NOT adding question-screen motion. ✓ (If Brandon wants the drift to actively slow during a question, that's a follow-up — flagged.)
- prefers-reduced-motion static fallback → Task 4 Step 1. ✓
- Palette tuned, contract names unchanged → Task 1. ✓
- TV-only → JuneSky only rendered via Weather→TVStage. ✓
- Validation (tsc/vitest/full-flow/real-route/PR-to-staging) → Task 8. ✓

**Placeholder scan:** No TBD/TODO. The one ambiguity (duplicate `filter` key in the Task 4 snippet) is explicitly called out with the resolution (keep the conditional one). ✓

**Type consistency:** `JuneBeatKind` ("lock"|"reveal"), `fireJuneBeat(kind)`, `JuneSky({ intensity })`, `__subscribeJuneBeatForTest` — names consistent across Tasks 3-7. `themeKey?: ThemeKey` threaded into `TVRevealView` matches the existing `ThemeKey` import. ✓

**Known risks:**
- The reveal bloom is a centered atmosphere effect, not locked to the answer card (flagged above).
- `mixBlendMode: "screen"` + blur can be GPU-heavy on old venue TVs; intensity stays low and it's a small bottom strip. If a venue TV stutters, the reduced-motion path or lowering blur is the lever. (Matches spec's platform-limits honesty.)
