# June Reactive Water Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (Brandon's chosen mode) to implement this plan task-by-task with two-stage review (spec compliance, then code quality) between each. Steps use checkbox (`- [ ]`) syntax. Brandon clears context before starting; this plan is self-contained.

**Goal:** Make June's water *behave* like water — a faintly-breathing cool mirror of the warm sky that ripples on lock-in and swells a cool reflection on reveal — and make it shared, so the room's moments ripple across the TV **and every player's phone** at once.

**Architecture:** Enrich `JuneSky`'s bottom water band with three CSS-only behaviors driven by the existing module beat (`fireJuneBeat`): a resting breath, a lock ripple (keyed per beat), and a reveal reflection (cool mirror of the warm bloom). The TV already fires both beats. Add phone-side firing from the player room's own shared feed: reveal on resolve, own-lock instantly, other players' locks via the existing `useLockInSync` poll (`/api/games/:id/locks`) — reliable, since raw realtime is the known weak spot for phone sessions. Plus a standalone contrast fix on the host live console's black action bar.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4 + CSS keyframes in `app/globals.css`, the existing `JuneSky`/`Weather`/`fireJuneBeat` system, `useLockInSync`, Vitest. No new dependencies.

---

## Design ground truth (verified against the codebase, 2026-05-31)

- `components/system/JuneSky.tsx` (post-cohesion): module beat `fireJuneBeat(kind)` + subscribed `const [beat, setBeat] = useState<{ kind; at } | null>` (line 48), `lockActive`/`revealActive` (lines 84-85), reduced-motion early return (line 68), Layer 1 sky (uses `backgroundImage`, line 103), Layer 2 water shimmer sliver (bottom, ~18%, `tr1via-june-shimmer`), Layer 3 horizon seam (`revealActive` swells height/opacity), Layer 4 warm reveal bloom (`revealActive`, `key={beat?.at}`, `tr1via-june-breathe`). Beat auto-clears after 1400ms (the unchanged subscribe effect).
- Keyframes live in `app/globals.css` (the `tr1via-june-*` block, before the `@media (prefers-reduced-motion: reduce)` block).
- `Weather` renders `JuneSky` for `case "june"` on the **TV** (`TVStage`) and **player phones** (`PhoneScreen`, `weatherIntensity=0.5` — JuneSky renders full regardless of intensity).
- TV already fires beats: `components/tv/TVStateMachine.tsx` — `fireJuneBeat("lock")` per newly-seen lock; `fireJuneBeat("reveal")` on `TVRevealView` mount.
- `lib/hooks/useLockInSync.ts`: `useLockInSync({ gameId, active, acknowledged, onMissed })` polls `GET /api/games/:id/locks` every 3s and calls `onMissed(lock: { playerId, msToLock, lockedAtMs })` for each lock whose `playerId` is not in `acknowledged`.
- Player room `app/(player)/room/[code]/page.tsx`: `RoomStateMachine` has `snapshot` (from `useRoom`), `currentGame`, `currentQuestion`, `themeKey`, `me`, and `snapshot.lastBroadcast` (`.event`, `.serverNow`, `.questionId`). `RevealView` renders when `currentQuestion.finished_at !== null` (line ~406/440) or via the `lastResolvedQuestion` fallback (~467). `fireJuneBeat` is exported from `@/components/system`.
- Host live console `components/host/HostLiveConsole.tsx:208` has the `background: "#000"` bar; it renders a footer (onOpenPlayers ~263) + a `PlayersSheet`. The bar's control text is dark-on-black (the bug).
- Tests: `tests/unit/juneSky.test.tsx` (beat module). Baseline suite: 68 files / 481 pass / 8 skip.

## File structure

- **Modify** `app/globals.css` — add `tr1via-water-breathe`, `tr1via-water-ripple`, `tr1via-water-reflect` keyframes.
- **Modify** `components/system/JuneSky.tsx` — calmer breathing water reflection (resting), a lock-ripple layer, a reveal cool-reflection layer. All CSS, beat-driven.
- **Create** `lib/player/waterPulse.ts` — tiny pure helpers for the phone: de-dup which resolved question has fired a reveal, and which lock playerIds have rippled. Unit-tested (this is the TDD core; the visual layers gate on tsc + browser).
- **Create** `tests/unit/waterPulse.test.ts` — tests for the helpers.
- **Modify** `app/(player)/room/[code]/page.tsx` — fire `fireJuneBeat("reveal")` once per resolved question (june only); fire `fireJuneBeat("lock")` on own lock (instant) + others via `useLockInSync` (june only), using `waterPulse` de-dup.
- **Modify** `components/host/HostLiveConsole.tsx` — fix the black action-bar control text contrast.

---

### Task 1: Water keyframes

**Files:** Modify `app/globals.css` (in the `tr1via-june-*` keyframe block, before the `@media (prefers-reduced-motion: reduce)` block)

- [ ] **Step 1: Add three keyframes**

Insert after the existing `tr1via-june-breathe` keyframe:

```css
/* June water — the surface that answers the room. CSS-only (no SVG turbulence:
   venue-TV performance). breathe = low resting life; ripple = a lock-in drop;
   reflect = the reveal bloom mirrored cool and settling. */
@keyframes tr1via-water-breathe {
  0%, 100% { opacity: .42; transform: translateY(0) scaleY(1); }
  50%      { opacity: .60; transform: translateY(-1px) scaleY(1.04); }
}
@keyframes tr1via-water-ripple {
  0%   { transform: translate(-50%, -50%) scale(0.25); opacity: .55; }
  100% { transform: translate(-50%, -50%) scale(1.8);  opacity: 0; }
}
@keyframes tr1via-water-reflect {
  0%   { opacity: 0;   transform: translateY(10px) scaleY(.7); }
  28%  { opacity: .85; transform: translateY(0)    scaleY(1); }
  100% { opacity: 0;   transform: translateY(0)    scaleY(1.05); }
}
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → PASS (CSS isn't type-checked; confirms nothing else broke).
- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat(theme): June water keyframes — breathe, ripple, reflect"
```

---

### Task 2: JuneSky resting water — a faintly-breathing cool mirror

**Files:** Modify `components/system/JuneSky.tsx` (Layer 2 region — the bottom water band)

The current Layer 2 is a thin shimmer sliver. Add, just before it, a **reflection layer**: a cool-tinted mirror of the warm sky pinned to the bottom band, with the slow resting breath. Keep Layer 2's shimmer (the sparkle on the surface) but let this new layer carry the body of the water.

- [ ] **Step 1: Add the resting reflection layer**

In `JuneSky.tsx`, immediately before the `{/* Layer 2 — thin cool water shimmer ... */}` comment, insert:

```tsx
      {/* Water body — a cool mirror of the warm sky, pinned to the bottom band,
          breathing slowly at rest. The same evening light, reflected cooler. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "26%",
          mixBlendMode: "screen",
          backgroundImage:
            "linear-gradient(0deg, rgba(120,200,220,.55) 0%, rgba(150,190,225,.30) 45%, transparent 100%)," +
            "radial-gradient(120% 90% at 50% 120%, rgba(255,225,180,.28) 0%, transparent 60%)",
          filter: "blur(3px)",
          animation: "tr1via-water-breathe 7s ease-in-out infinite",
        }}
      />
```

(The cool linear gradient is the water; the faint warm radial low in it is the warm sky caught in the surface — "one light, two media." `mixBlendMode: screen` lets it sit over Layer 1 like light on water.)

- [ ] **Step 2: Typecheck + beat tests**

Run: `npx tsc --noEmit && npx vitest run tests/unit/juneSky.test.tsx`
Expected: PASS (2 beat tests unchanged).

- [ ] **Step 3: Commit**

```bash
git add components/system/JuneSky.tsx
git commit -m "feat(theme): June resting water — breathing cool mirror of the sky"
```

---

### Task 3: JuneSky lock-in ripple (a drop)

**Files:** Modify `components/system/JuneSky.tsx`

When `lockActive`, render an expanding cool ring centered in the water band, keyed by `beat.at` so each lock restarts it.

- [ ] **Step 1: Add the ripple layer**

In `JuneSky.tsx`, after the reveal bloom (Layer 4) block, before the closing `</div>` of the root, insert:

```tsx
      {/* Lock-in ripple — a drop into the pool. key={beat.at} restarts the ring
          on every new lock so bursts read as multiple drops. */}
      {lockActive && (
        <div
          key={beat?.at}
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            bottom: "13%",
            width: "42%",
            height: "42%",
            borderRadius: "50%",
            border: "2px solid rgba(170,225,235,.5)",
            transform: "translate(-50%, -50%)",
            animation: "tr1via-water-ripple 1100ms ease-out forwards",
          }}
        />
      )}
```

- [ ] **Step 2: Typecheck + beat tests**

Run: `npx tsc --noEmit && npx vitest run tests/unit/juneSky.test.tsx`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/system/JuneSky.tsx
git commit -m "feat(theme): June lock-in ripple — a drop into the water"
```

---

### Task 4: JuneSky reveal reflection (the warm bloom, mirrored cool)

**Files:** Modify `components/system/JuneSky.tsx`

When `revealActive`, swell a cool-tinted reflection of the warm reveal bloom up from the water, then settle. This is the "transient blue."

- [ ] **Step 1: Add the reflection layer**

In `JuneSky.tsx`, immediately after the Layer 4 warm bloom block (the `{revealActive && (...)}` for `tr1via-june-breathe`), insert a sibling cool reflection:

```tsx
      {/* Reveal reflection — the warm bloom above, caught cool on the water.
          Same light, two media. Mirrors the bloom's centered position. */}
      {revealActive && (
        <div
          key={`reflect-${beat?.at}`}
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            bottom: 0,
            width: "70%",
            height: "30%",
            transform: "translateX(-50%)",
            transformOrigin: "bottom center",
            mixBlendMode: "screen",
            backgroundImage:
              "radial-gradient(closest-side, rgba(150,225,235,.6) 0%, rgba(170,210,240,.25) 45%, transparent 75%)",
            filter: "blur(4px)",
            animation: "tr1via-water-reflect 1300ms ease-out forwards",
          }}
        />
      )}
```

- [ ] **Step 2: Typecheck + beat tests** — `npx tsc --noEmit && npx vitest run tests/unit/juneSky.test.tsx` → PASS.
- [ ] **Step 3: Commit**

```bash
git add components/system/JuneSky.tsx
git commit -m "feat(theme): June reveal reflection — the warm bloom mirrored cool"
```

---

### Task 5: Phone water-pulse helpers (TDD)

**Files:** Create `lib/player/waterPulse.ts` + `tests/unit/waterPulse.test.ts`

Two tiny pure helpers so the phone fires each beat exactly once per moment, de-duped — testable without a renderer.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/waterPulse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldFireReveal, newLockIds } from "@/lib/player/waterPulse";

describe("waterPulse", () => {
  it("fires reveal once per resolved question id", () => {
    expect(shouldFireReveal("q1", null)).toBe(true);
    expect(shouldFireReveal("q1", "q1")).toBe(false); // already fired
    expect(shouldFireReveal("q2", "q1")).toBe(true);  // new question
    expect(shouldFireReveal(null, "q1")).toBe(false); // not resolved
  });

  it("returns only lock playerIds not already rippled", () => {
    const seen = new Set<string>(["a"]);
    expect(newLockIds(["a", "b", "c"], seen)).toEqual(["b", "c"]);
    expect(newLockIds(["a"], seen)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — FAIL** — `npx vitest run tests/unit/waterPulse.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `lib/player/waterPulse.ts`:

```ts
// Pure de-dup helpers for the phone's reactive water. The phone fires the June
// beat from its own shared feed; these keep each moment firing exactly once.

/** True when a newly-resolved question should fire a reveal pulse — i.e. it's
 *  resolved and differs from the last question we already pulsed for. */
export function shouldFireReveal(
  resolvedQuestionId: string | null,
  lastFiredQuestionId: string | null,
): boolean {
  if (!resolvedQuestionId) return false;
  return resolvedQuestionId !== lastFiredQuestionId;
}

/** The lock playerIds we haven't rippled yet (preserves input order). */
export function newLockIds(playerIds: string[], rippled: Set<string>): string[] {
  return playerIds.filter((id) => !rippled.has(id));
}
```

- [ ] **Step 4: Run it — PASS** — `npx vitest run tests/unit/waterPulse.test.ts` → PASS (2).
- [ ] **Step 5: Commit**

```bash
git add lib/player/waterPulse.ts tests/unit/waterPulse.test.ts
git commit -m "feat(player): water-pulse de-dup helpers (TDD)"
```

---

### Task 6: Wire the phone's reactive water

**Files:** Modify `app/(player)/room/[code]/page.tsx`

Fire the June beat from the player room's own feed: reveal on resolve, own lock instantly, other players' locks via `useLockInSync`. All gated to `themeKey === "june"`. The phone renders `JuneSky` via `PhoneScreen`, so its local water reacts.

- [ ] **Step 1: Imports**

Add to the existing imports:

```tsx
import { fireJuneBeat } from "@/components/system";
import { useLockInSync } from "@/lib/hooks/useLockInSync";
import { shouldFireReveal, newLockIds } from "@/lib/player/waterPulse";
```

- [ ] **Step 2: Reveal pulse — once per resolved question (june only)**

Inside `RoomStateMachine` (which has `snapshot`, `currentGame`, `currentQuestion`, `themeKey`), add near the other hooks:

```tsx
  // June: the water reflects the reveal the moment this phone enters it. Uses
  // the same resolve signal that already flips the screen — reliable on phones.
  const lastRevealFiredRef = useRef<string | null>(null);
  const resolvedQId =
    currentQuestion && currentQuestion.finished_at !== null ? currentQuestion.id : null;
  useEffect(() => {
    if (themeKey !== "june") return;
    if (shouldFireReveal(resolvedQId, lastRevealFiredRef.current)) {
      lastRevealFiredRef.current = resolvedQId;
      fireJuneBeat("reveal");
    }
  }, [themeKey, resolvedQId]);
```

(`useRef`/`useEffect` are already imported in this file.)

- [ ] **Step 3: Lock ripples — own lock instant + others via poll (june only)**

Add, also inside `RoomStateMachine`:

```tsx
  // June: every lock-in ripples this phone's water — the room's pulse, felt on
  // your own screen. Own lock is known locally (instant); other players' locks
  // ride the existing lock-sync poll (raw realtime is the weak spot on phones).
  // de-dup by playerId so a lock ripples once. coalesce: cap to one ripple per
  // ~250ms so a burst reads as a living surface, not noise.
  const rippledLocksRef = useRef<Set<string>>(new Set());
  const lastRippleAtRef = useRef<number>(0);
  const rippleForLocks = useCallback((playerIds: string[]) => {
    if (themeKey !== "june") return;
    const fresh = newLockIds(playerIds, rippledLocksRef.current);
    if (fresh.length === 0) return;
    for (const id of fresh) rippledLocksRef.current.add(id);
    const now = Date.now();
    if (now - lastRippleAtRef.current < 250) return; // coalesce bursts
    lastRippleAtRef.current = now;
    fireJuneBeat("lock");
  }, [themeKey]);

  // Reset the de-dup set when the live question changes (each question is a
  // fresh round of locks).
  useEffect(() => {
    rippledLocksRef.current = new Set();
  }, [currentQuestion?.id]);

  // Own lock — the moment my optimistic/real answer for the live question exists.
  const myLiveLockId = useMemo(() => {
    if (!currentQuestion) return null;
    return myAnswers.some((a) => a.question_id === currentQuestion.id) ? me.id : null;
  }, [currentQuestion, myAnswers, me.id]);
  useEffect(() => {
    if (myLiveLockId) rippleForLocks([myLiveLockId]);
  }, [myLiveLockId, rippleForLocks]);

  // Other players' locks — reliable server poll (RLS-safe; /api/games/:id/locks).
  useLockInSync({
    gameId: currentGame?.id ?? "",
    active: themeKey === "june" && !!currentGame?.id,
    acknowledged: rippledLocksRef.current,
    onMissed: (lock) => rippleForLocks([lock.playerId]),
  });
```

(`useCallback`/`useMemo` are already imported. `myAnswers` and `me` are in `RoomStateMachine` scope.)

- [ ] **Step 4: Typecheck + full suite** — `npx tsc --noEmit && npx vitest run` → tsc clean; 68+ files green (incl. `waterPulse.test.ts`).
- [ ] **Step 5: Commit**

```bash
git add "app/(player)/room/[code]/page.tsx"
git commit -m "feat(player): phone water reacts to the room — reveal + own/others' locks"
```

---

### Task 7: Fix the host live console black action-bar contrast (bug)

**Files:** Modify `components/host/HostLiveConsole.tsx`

The bar at `:208` is `background: "#000"`; its controls (players count, point +/-) render in dark text and are invisible. Make the controls/text light on the black bar.

- [ ] **Step 1: Locate the controls**

Read `components/host/HostLiveConsole.tsx` around the `background: "#000"` bar (~line 200-270) and the footer/PlayersSheet trigger it renders. Identify every text/icon/button on the black bar whose color resolves to a dark theme token (`t.ink`, `t.inkMid`, `#0E…`, etc.).

- [ ] **Step 2: Recolor for the dark bar**

For text/controls sitting ON the `#000` bar, set readable light colors (e.g. `#F4ECDC` / `rgba(255,255,255,.72)` for secondary, the theme `accent`/`pop` for emphasis like point deltas). Keep the existing pink "End early · reveal" button as-is (already readable). Ensure the players-count tap target and the +/- point-adjust controls have clearly visible labels and a visible affordance.

- [ ] **Step 3: Typecheck + full suite** — `npx tsc --noEmit && npx vitest run` → PASS.
- [ ] **Step 4: Commit**

```bash
git add components/host/HostLiveConsole.tsx
git commit -m "fix(host): readable controls on the live-console black action bar"
```

---

### Task 8: Validation gate + PR

**Files:** none (verification only)

- [ ] **Step 1: tsc + full suite** — `npx tsc --noEmit && npx vitest run` → tsc clean; all green (note: ESLint is known-broken — do NOT gate on lint).
- [ ] **Step 2: Full-flow prod (june)** — `SMOKE_THEME_SINGLE=june node --env-file=.env.local scripts/full-flow-prod.mjs > /tmp/water.log 2>&1; echo exit=$?` → exit=0; then `grep -iE "GREEN|RED|FAIL" /tmp/water.log | tail` shows GREEN. (Do NOT `tee`.)
- [ ] **Step 3: Real-route browser proof** (dev server `npm run dev -- -p 3030`; use a `@tr1via.test` host, and `SMOKE_PARK_LOBBY=1 SMOKE_THEME_SINGLE=june SMOKE_BASE_URL=http://localhost:3030 …full-flow-prod.mjs` to park a june room):
  - TV `/tv/[code]`: resting water breathing; a lock-in ripples; the reveal casts the cool reflection. Screenshots `verify-water-tv-*.png`.
  - **Two player phones in the same room**: locking in on phone A ripples phone B's water (the shared-moment proof). Screenshot/note.
  - A phone reveal reflection on a calm reveal state.
  - Host live console: the black-bar controls are readable.
  - Console clean of React style warnings on `/tv` and `/room`.
- [ ] **Step 4: Push + PR into staging**

```bash
git push -u origin june-reactive-water
gh pr create --base staging --head june-reactive-water \
  --title "June reactive water — the surface that answers the room" \
  --body "Spec: docs/superpowers/specs/2026-05-31-june-reactive-water-design.md. Reactive water on TV + every phone (reveal reflection, lock ripples — own + others via lock-sync), plus the host live-console action-bar contrast fix. No game-logic change. Brandon feels it on the preview, then merges."
```

Expected: PR into `staging`. **Brandon feels it live on the preview, then merges. Never main.**

- [ ] **Step 5: Update HANDOFF + todo; capture any lesson.**

---

## Self-review

**Spec coverage:**
- Rest = breathing cool mirror → Task 2. ✓
- Lock-in ripple (drop) → Task 3 (visual) + Task 6 (TV already fires; phone fires). ✓
- Reveal cool reflection ("transient blue") → Task 4 (visual) + Task 6 (phone fires; TV already fires). ✓
- Reduced motion → unchanged JuneSky early return covers all new layers (they live after it). ✓
- Shared across phones (every phone reacts off the shared feed) → Task 6 (reveal on resolve, own lock instant, others via `useLockInSync` poll). ✓
- Restraint (quiet while reading) → resting breath is low-amplitude; ripple/reflect only on beats. ✓
- Host black-bar contrast bug → Task 7. ✓
- Pure CSS, no deps, venue-TV-safe → CSS-only chosen (no SVG turbulence). ✓
- Validation incl. two-phone shared-moment proof → Task 8. ✓

**Placeholder scan:** Task 7 Step 2 intentionally leaves exact tokens to the implementer because they must match what's actually on the bar (read in Step 1) — it specifies the rule (light-on-black, named token candidates) not a vague "fix colors." All other tasks have concrete code.

**Type consistency:** `fireJuneBeat("lock"|"reveal")`, `shouldFireReveal(resolvedQuestionId, lastFiredQuestionId)`, `newLockIds(playerIds, rippled)`, `useLockInSync({ gameId, active, acknowledged, onMissed })` — consistent across Tasks 5-6 and match the verified signatures. Keyframe names (`tr1via-water-breathe/ripple/reflect`) match between Task 1 and Tasks 2-4.

**Known risks:**
- Others'-lock ripples on phones arrive on the 3s poll cadence (reliable, slightly delayed) — own lock is instant. If Brandon wants others' ripples snappier, add the snapshot's live-locks as an instant source with the poll as backstop (only if the phone snapshot exposes other players' locks — verify RLS first; don't assume).
- Burst coalescing caps phone ripples to ~1/250ms — tune live if it feels too sparse or too busy.
- Water values (opacity, blur, sizes) are starting points — tune on the preview; this is *feel*, judged live.
