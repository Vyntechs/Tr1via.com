# July Pyrotechnics — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On July nights, make correct players' phones ignite real fireworks in sync with the TV when a question resolves (earned, dark→bright), show count-only social awareness on both correct + wrong screens, then settle into a ±4 standings neighborhood — plus a whole-room finale at game end — all riding the existing Phase-2 beat with no migration and no new per-client reads.

**Architecture:** The Phase-2 `fireworks` broadcast already reaches every phone as `useRoom().lastFireworksBeat`. We consume it on the player route: a *gated* `PyrotechnicsBeatConductor` (salvo fires only for the correct player; finale for everyone), a dark→bright correct-celebration sequence, a ±4 standings beat after the celebration, social-count lines from the resolve broadcast's `awards`, and a phone-tuned particle/DPR budget on the engine (TV path unchanged).

**Tech Stack:** Next.js 16 / React 19 / TypeScript (strict), Vitest + Testing Library, the existing `Pyrotechnics` canvas engine + `PyrotechnicsBeatConductor`, `useRoom`.

**Spec:** `tasks/july-pyrotechnics-phase3-spec.md`. **Figma:** https://www.figma.com/design/lANVldTnzvKmxPv1kmQzZg

---

## File map

- **Create** `lib/player/standings.ts` — `buildNeighborhood(±4)` pure builder.
- **Create** `lib/player/celebrationCopy.ts` — resolve-summary + social-line phrasing (pure).
- **Create** `lib/game/revealOutcome.ts` — `playerWasCorrect()` extracted from RevealView (DRY; reused by the gate).
- **Create** `components/player/PlayerStandingsNeighborhood.tsx` — the ±4 beat-3 screen.
- **Create** `components/player/PlayerRevealCorrectSequence.tsx` — dark→bright wrapper.
- **Modify** `components/player/PlayerRevealCorrect.tsx` — add the social-count line.
- **Modify** `components/player/PlayerRevealWrong.tsx` — add the awareness-count line.
- **Modify** `components/system/Pyrotechnics.tsx` — phone particle/DPR budget (new pure `pyroBudget`, TV unchanged).
- **Modify** `components/player/index.ts` — export the two new components.
- **Modify** `app/(player)/room/[code]/page.tsx` — mount the gated conductor; drive the 3-beat reveal + standings beat; capture per-question resolve summary; compute `amCorrect`/neighborhood.
- **Tests:** `tests/unit/standings.test.ts`, `tests/unit/celebration-copy.test.ts`, `tests/unit/reveal-outcome.test.ts`, `tests/unit/pyro-budget.test.ts`, `tests/unit/player-standings-neighborhood.test.tsx`, `tests/unit/player-reveal-correct-sequence.test.tsx`, plus added cases in the reveal component tests.

Build order is bottom-up: pure logic (Tasks 1–4) → components (5–8) → wiring (9) → verify (10).

---

### Task 1: `buildNeighborhood` — ±4 standings slice

**Files:**
- Create: `lib/player/standings.ts`
- Test: `tests/unit/standings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/standings.test.ts
import { describe, it, expect } from "vitest";
import { buildNeighborhood } from "@/lib/player/standings";
import type { GameScoreRow } from "@/lib/supabase/types";

function scores(n: number): GameScoreRow[] {
  // Descending scores; player ids "p1".."pN", names "P1".."PN".
  return Array.from({ length: n }, (_, i) => ({
    game_id: "g1",
    player_id: `p${i + 1}`,
    display_name: `P${i + 1}`,
    score: (n - i) * 100,
  })) as unknown as GameScoreRow[];
}

describe("buildNeighborhood", () => {
  it("returns up to 4 above + you + 4 below, you flagged, centered when mid-pack", () => {
    const nb = buildNeighborhood(scores(24), "p7", 4);
    expect(nb.meRank).toBe(7);
    expect(nb.total).toBe(24);
    expect(nb.rows.map((r) => r.rank)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(nb.rows.find((r) => r.isYou)?.rank).toBe(7);
    expect(nb.rows.filter((r) => r.isYou)).toHaveLength(1);
  });

  it("clamps at the top edge (fewer above)", () => {
    const nb = buildNeighborhood(scores(24), "p2", 4);
    expect(nb.meRank).toBe(2);
    expect(nb.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("clamps at the bottom edge (fewer below)", () => {
    const nb = buildNeighborhood(scores(10), "p9", 4);
    expect(nb.rows.map((r) => r.rank)).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it("returns empty rows + null meRank when the player is absent (no '#0')", () => {
    const nb = buildNeighborhood(scores(5), "ghost", 4);
    expect(nb.meRank).toBeNull();
    expect(nb.rows).toEqual([]);
    expect(nb.total).toBe(5);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`buildNeighborhood` not defined)

Run: `npx vitest run tests/unit/standings.test.ts`

- [ ] **Step 3: Implement**

```ts
// lib/player/standings.ts
import type { GameScoreRow } from "@/lib/supabase/types";
import type { StandingRow } from "@/lib/player/betweenGames";

export interface Neighborhood {
  /** Up to `radius` rows above me, my row, up to `radius` below — ranked. Empty when I'm absent. */
  rows: StandingRow[];
  /** My 1-based rank, or null when I have no row in this game's view yet. */
  meRank: number | null;
  /** Total ranked players in this game. */
  total: number;
}

/**
 * A window of the leaderboard centered on the player: up to `radius` ranks
 * above, the player (flagged isYou), up to `radius` below — from the
 * already-sorted (score desc) `game_scores`. Clamps at the board edges. When
 * the player has no row yet, returns empty rows + null meRank so the UI shows a
 * calm placeholder instead of "#0".
 */
export function buildNeighborhood(
  scores: GameScoreRow[],
  meId: string,
  radius = 4,
): Neighborhood {
  const total = scores.length;
  const meIndex = scores.findIndex((s) => s.player_id === meId);
  if (meIndex < 0) return { rows: [], meRank: null, total };
  const start = Math.max(0, meIndex - radius);
  const end = Math.min(total, meIndex + radius + 1);
  const rows: StandingRow[] = scores.slice(start, end).map((s, i) => ({
    rank: start + i + 1,
    name: s.display_name ?? "",
    score: s.score ?? 0,
    isYou: s.player_id === meId,
  }));
  return { rows, meRank: meIndex + 1, total };
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run tests/unit/standings.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/player/standings.ts tests/unit/standings.test.ts
git commit -m "feat(july): ±4 standings neighborhood builder (Phase 3)"
```

---

### Task 2: Resolve summary + social-line copy

**Files:**
- Create: `lib/player/celebrationCopy.ts`
- Test: `tests/unit/celebration-copy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/celebration-copy.test.ts
import { describe, it, expect } from "vitest";
import {
  summarizeResolve,
  nailedItLine,
  gotItLine,
  type ResolveAward,
} from "@/lib/player/celebrationCopy";

const awards = (flags: boolean[]): ResolveAward[] =>
  flags.map((isCorrect, i) => ({ playerId: `p${i}`, awarded: isCorrect ? 110 : 0, isCorrect }));

describe("summarizeResolve", () => {
  it("counts correct vs answered from the awards array", () => {
    expect(summarizeResolve(awards([true, false, true, true]))).toEqual({ correctCount: 3, answeredCount: 4 });
  });
  it("handles undefined / empty awards", () => {
    expect(summarizeResolve(undefined)).toEqual({ correctCount: 0, answeredCount: 0 });
    expect(summarizeResolve([])).toEqual({ correctCount: 0, answeredCount: 0 });
  });
});

describe("nailedItLine (correct screen — you are one of the correct)", () => {
  it("you alone", () => expect(nailedItLine(1)).toBe("You nailed it"));
  it("you + one other", () => expect(nailedItLine(2)).toBe("You + 1 other nailed it"));
  it("you + many", () => expect(nailedItLine(8)).toBe("You + 7 others nailed it"));
  it("guards a zero/below count to the solo line", () => expect(nailedItLine(0)).toBe("You nailed it"));
});

describe("gotItLine (wrong screen — awareness)", () => {
  it("fraction of answered", () => expect(gotItLine(8, 23)).toBe("8 of 23 got this one"));
  it("singular correct", () => expect(gotItLine(1, 12)).toBe("1 of 12 got this one"));
  it("nobody got it", () => expect(gotItLine(0, 15)).toBe("Nobody got this one"));
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run tests/unit/celebration-copy.test.ts`

- [ ] **Step 3: Implement**

```ts
// lib/player/celebrationCopy.ts
// Pure copy + counts for the July per-question celebration. Counts come from
// the resolve broadcast's `awards` (already on the phone — no new read).

export interface ResolveAward {
  playerId: string;
  awarded: number;
  isCorrect: boolean;
}

export interface ResolveSummary {
  /** How many answerers got it right. */
  correctCount: number;
  /** How many players answered (the awards array length). */
  answeredCount: number;
}

export function summarizeResolve(awards: ResolveAward[] | undefined): ResolveSummary {
  if (!awards || awards.length === 0) return { correctCount: 0, answeredCount: 0 };
  return {
    correctCount: awards.reduce((n, a) => n + (a.isCorrect ? 1 : 0), 0),
    answeredCount: awards.length,
  };
}

/** Correct screen: the player is one of the correct, so `correctCount` includes them. */
export function nailedItLine(correctCount: number): string {
  const others = Math.max(0, correctCount - 1);
  if (others === 0) return "You nailed it";
  if (others === 1) return "You + 1 other nailed it";
  return `You + ${others} others nailed it`;
}

/** Wrong / no-answer screen: awareness of who got it, no celebration. */
export function gotItLine(correctCount: number, answeredCount: number): string {
  if (correctCount <= 0) return "Nobody got this one";
  return `${correctCount} of ${answeredCount} got this one`;
}
```

> Note: `answeredCount` is "of those who answered" (awards length). If Brandon prefers room size as the denominator, pass `players.length` at the call site instead — keep this helper denominator-agnostic.

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run tests/unit/celebration-copy.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/player/celebrationCopy.ts tests/unit/celebration-copy.test.ts
git commit -m "feat(july): resolve-summary + social-line copy (Phase 3)"
```

---

### Task 3: Extract `playerWasCorrect` + gate the beat

**Files:**
- Create: `lib/game/revealOutcome.ts`
- Test: `tests/unit/reveal-outcome.test.ts`
- Modify (later, Task 9): `components/player/PlayerRevealCorrect`/`RevealView` to reuse it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/reveal-outcome.test.ts
import { describe, it, expect } from "vitest";
import { playerWasCorrect, gateBeatForPlayer } from "@/lib/game/revealOutcome";
import type { AnswerRow } from "@/lib/supabase/types";
import type { FireworksBeat } from "@/components/system/PyrotechnicsBeatConductor";

const ans = (over: Partial<AnswerRow>): AnswerRow =>
  ({ chosen_index: 1, is_correct: null, ...over } as AnswerRow);

describe("playerWasCorrect", () => {
  it("true when is_correct echo is true", () => {
    expect(playerWasCorrect(ans({ is_correct: true, chosen_index: 0 }), 2)).toBe(true);
  });
  it("true when chosen matches correct_index even before the echo lands", () => {
    expect(playerWasCorrect(ans({ is_correct: null, chosen_index: 2 }), 2)).toBe(true);
  });
  it("false when wrong", () => {
    expect(playerWasCorrect(ans({ is_correct: false, chosen_index: 1 }), 2)).toBe(false);
  });
  it("false with no answer or unknown correct index", () => {
    expect(playerWasCorrect(null, 2)).toBe(false);
    expect(playerWasCorrect(ans({ chosen_index: 2 }), null)).toBe(false);
  });
});

const beat = (kind: "salvo" | "finale"): FireworksBeat => ({
  kind, fireAt: "x", serverNow: "y", receivedAtMs: 1,
});

describe("gateBeatForPlayer", () => {
  it("passes a finale beat through for everyone", () => {
    expect(gateBeatForPlayer(beat("finale"), false)).toEqual(beat("finale"));
  });
  it("passes a salvo beat only when the player was correct", () => {
    expect(gateBeatForPlayer(beat("salvo"), true)).toEqual(beat("salvo"));
    expect(gateBeatForPlayer(beat("salvo"), false)).toBeNull();
  });
  it("passes null through", () => {
    expect(gateBeatForPlayer(null, true)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run tests/unit/reveal-outcome.test.ts`

- [ ] **Step 3: Implement**

```ts
// lib/game/revealOutcome.ts
import type { AnswerRow } from "@/lib/supabase/types";
import type { FireworksBeat } from "@/components/system/PyrotechnicsBeatConductor";

/**
 * Did this player get the question right? Trust the data on hand — the player's
 * own chosen_index vs correct_index — OR'd with the server's is_correct echo
 * (which lands a few hundred ms later via a refetch). Mirrors RevealView's
 * `wasCorrect`; extracted so the firework gate uses the identical rule.
 */
export function playerWasCorrect(
  myAnswer: AnswerRow | null,
  correctIndex: number | null | undefined,
): boolean {
  if (!myAnswer || typeof correctIndex !== "number") return false;
  return myAnswer.is_correct === true || myAnswer.chosen_index === correctIndex;
}

/**
 * Gate a firework beat for ONE player's phone: a `finale` fires for everyone
 * (whole-room game-end eruption); a `salvo` fires only for the player who got
 * the question right (fireworks are earned). Returns the beat to publish, or
 * null to stay calm. Passing the gated beat to PyrotechnicsBeatConductor means
 * a wrong player simply never publishes the salvo.
 */
export function gateBeatForPlayer(
  beat: FireworksBeat | null,
  amCorrect: boolean,
): FireworksBeat | null {
  if (!beat) return null;
  if (beat.kind === "finale") return beat;
  return amCorrect ? beat : null;
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run tests/unit/reveal-outcome.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/game/revealOutcome.ts tests/unit/reveal-outcome.test.ts
git commit -m "feat(july): playerWasCorrect + correct-only beat gate (Phase 3)"
```

---

### Task 4: Phone particle/DPR budget on the engine

**Files:**
- Create: `tests/unit/pyro-budget.test.ts`
- Modify: `components/system/Pyrotechnics.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/pyro-budget.test.ts
import { describe, it, expect } from "vitest";
import { pyroBudget } from "@/components/system/Pyrotechnics";

describe("pyroBudget — self-degrade by canvas size", () => {
  it("TV-sized canvas keeps the full budget (unchanged)", () => {
    expect(pyroBudget(1280, 8)).toEqual({ maxParticles: 1600, dprCap: 2 });
  });
  it("phone-sized canvas caps particles + DPR", () => {
    const b = pyroBudget(390, 8);
    expect(b.maxParticles).toBeLessThanOrEqual(600);
    expect(b.dprCap).toBeLessThanOrEqual(1.5);
  });
  it("low-core phone degrades further", () => {
    expect(pyroBudget(390, 2).maxParticles).toBeLessThanOrEqual(pyroBudget(390, 8).maxParticles);
  });
  it("treats unknown core count as mid", () => {
    expect(pyroBudget(390, undefined).maxParticles).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run tests/unit/pyro-budget.test.ts`

- [ ] **Step 3: Implement — add the helper + wire it**

In `components/system/Pyrotechnics.tsx`, add the exported helper near the tuning constants (keep `MAX_PARTICLES = 1600` as the TV ceiling the helper returns):

```ts
// Per-instance performance budget. The venue TV (large canvas) keeps the full
// 1600-particle / DPR-2 budget — byte-identical to Phase 1/2. Phone-sized
// canvases (and low-core devices) self-degrade so 20-40 phones, including
// low-end ones, never jank the reveal UI. Pure + exported for unit testing.
const PHONE_CANVAS_MAX_W = 520; // below this, treat as a phone surface
export function pyroBudget(
  cssW: number,
  cores: number | undefined,
): { maxParticles: number; dprCap: number } {
  if (cssW >= PHONE_CANVAS_MAX_W) return { maxParticles: MAX_PARTICLES, dprCap: 2 };
  const lowCore = typeof cores === "number" && cores <= 4;
  return { maxParticles: lowCore ? 350 : 550, dprCap: 1.5 };
}
```

Then in the engine effect, after the first `resize()` (so `cssW` is known), compute the budget and use it instead of the bare constants:

```ts
// after resize();
const budget = pyroBudget(cssW, typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined);
const maxParticles = budget.maxParticles;
```

- Change the DPR line from `Math.min(window.devicePixelRatio || 1, 2)` to clamp by `budget.dprCap`. Because DPR is read before `resize()`, read it as `Math.min(window.devicePixelRatio || 1, 2)` first, then after resize re-clamp: `const dpr = Math.min(window.devicePixelRatio || 1, budget.dprCap)` and re-run `resize()` once so the canvas backing store uses the clamped DPR. (Simplest: move the `const dpr = ...` to after the first `resize()`/budget computation, and have `resize()` read `dpr` from a `let`.)
- Replace the two `MAX_PARTICLES` reads inside `explode()` and the spawn loop with `maxParticles` (closure variable). Leave the module `MAX_PARTICLES` constant as the TV ceiling that `pyroBudget` returns.

> Guard: the TV stage canvas measures ~1280px wide, so `pyroBudget` returns the unchanged `{1600, 2}` — **verify no TV regression** via the existing `/dev/tv` July capture in Task 10.

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run tests/unit/pyro-budget.test.ts tests/unit/pyrotechnics-component.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add components/system/Pyrotechnics.tsx tests/unit/pyro-budget.test.ts
git commit -m "perf(july): phone particle/DPR budget for the firework engine (TV unchanged) (Phase 3)"
```

---

### Task 5: `PlayerStandingsNeighborhood` component

**Files:**
- Create: `components/player/PlayerStandingsNeighborhood.tsx`
- Modify: `components/player/index.ts` (add export)
- Test: `tests/unit/player-standings-neighborhood.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/player-standings-neighborhood.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/components/system";
import { PlayerStandingsNeighborhood } from "@/components/player/PlayerStandingsNeighborhood";
import type { StandingRow } from "@/lib/player/betweenGames";

const rows: StandingRow[] = [
  { rank: 6, name: "Theo", score: 2540, isYou: false },
  { rank: 7, name: "You", score: 2340, isYou: true },
  { rank: 8, name: "Sam", score: 2210, isYou: false },
];

function renderIt(meRank: number | null) {
  return render(
    <ThemeProvider themeKey="july">
      <PlayerStandingsNeighborhood rows={rows} meRank={meRank} total={24} />
    </ThemeProvider>,
  );
}

describe("PlayerStandingsNeighborhood", () => {
  it("shows the player's rank headline and every neighborhood row", () => {
    renderIt(7);
    expect(screen.getByText(/#7/)).toBeTruthy();
    expect(screen.getByText("Theo")).toBeTruthy();
    expect(screen.getByText("Sam")).toBeTruthy();
    expect(screen.getByTestId("standings-neighborhood")).toBeTruthy();
  });

  it("flags the player's own row", () => {
    renderIt(7);
    expect(screen.getByTestId("standings-you")).toBeTruthy();
  });

  it("renders a calm placeholder (no '#0') when rank is unknown", () => {
    render(
      <ThemeProvider themeKey="july">
        <PlayerStandingsNeighborhood rows={[]} meRank={null} total={24} />
      </ThemeProvider>,
    );
    expect(screen.queryByText(/#0/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run tests/unit/player-standings-neighborhood.test.tsx`

- [ ] **Step 3: Implement** (mirrors `PlayerBetweenGames`'s row style; navy via `PhoneScreen` so it carries ambient July weather + can host the finale burst)

```tsx
// components/player/PlayerStandingsNeighborhood.tsx
"use client";

import { useTheme, Display, Eyebrow, Numeric } from "@/components/system";
import { PhoneScreen, PhoneHeader } from "@/components/shells";
import type { StandingRow } from "@/lib/player/betweenGames";

export interface PlayerStandingsNeighborhoodProps {
  rows: StandingRow[];
  meRank: number | null;
  total: number;
}

export function PlayerStandingsNeighborhood({
  rows,
  meRank,
  total,
}: PlayerStandingsNeighborhoodProps) {
  const { t } = useTheme();
  return (
    <PhoneScreen data-testid="standings-neighborhood">
      <PhoneHeader eyebrow="WHERE YOU STAND" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingTop: 12 }}>
        <Display size={40} color={t.ink}>
          {meRank ? <>You&apos;re <span style={{ color: t.accent }}>#{meRank}</span></> : "Nice run."}
        </Display>
        {meRank && (
          <div style={{ marginTop: 4, fontSize: 14, color: t.inkMid }}>of {total} tonight</div>
        )}

        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 7 }}>
          {rows.map((row) => (
            <div
              key={`${row.rank}-${row.name}`}
              data-testid={row.isYou ? "standings-you" : "standings-row"}
              style={{
                display: "grid",
                gridTemplateColumns: "40px 1fr auto",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                borderRadius: 12,
                background: row.isYou ? t.accent : t.surface,
                color: row.isYou ? "#0E0805" : t.ink,
                fontWeight: row.isYou ? 700 : 500,
              }}
            >
              <Numeric size={16} weight={700} color="currentColor">#{row.rank}</Numeric>
              <span style={{ fontSize: 16, fontWeight: row.isYou ? 700 : 600 }}>{row.name}</span>
              <Numeric size={16} weight={700} color="currentColor">{row.score.toLocaleString()}</Numeric>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: "auto",
            padding: "16px 18px",
            borderRadius: 12,
            background: t.surface,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 99, background: t.pop, animation: "tr1via-pulse 1.8s ease-in-out infinite" }} />
          <Eyebrow color={t.inkMute} size={11}>NEXT QUESTION COMING UP…</Eyebrow>
        </div>
      </div>
    </PhoneScreen>
  );
}
```

Add to `components/player/index.ts`:
```ts
export { PlayerStandingsNeighborhood } from "./PlayerStandingsNeighborhood";
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run tests/unit/player-standings-neighborhood.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add components/player/PlayerStandingsNeighborhood.tsx components/player/index.ts tests/unit/player-standings-neighborhood.test.tsx
git commit -m "feat(july): ±4 standings-neighborhood screen (Phase 3)"
```

---

### Task 6: Awareness line on `PlayerRevealWrong`

**Files:**
- Modify: `components/player/PlayerRevealWrong.tsx`
- Test: add to `tests/unit/` (new `tests/unit/player-reveal-wrong-awareness.test.tsx`)

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/player-reveal-wrong-awareness.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/components/system";
import { PlayerRevealWrong } from "@/components/player/PlayerRevealWrong";

describe("PlayerRevealWrong awareness line", () => {
  it("shows the count line when given counts", () => {
    render(
      <ThemeProvider themeKey="july">
        <PlayerRevealWrong correctCount={8} answeredCount={23} />
      </ThemeProvider>,
    );
    expect(screen.getByText("8 of 23 got this one")).toBeTruthy();
  });
  it("omits the line when counts are absent (back-compat default render)", () => {
    render(
      <ThemeProvider themeKey="july">
        <PlayerRevealWrong />
      </ThemeProvider>,
    );
    expect(screen.queryByText(/got this one/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run tests/unit/player-reveal-wrong-awareness.test.tsx`

- [ ] **Step 3: Implement** — add optional props + render. In `PlayerRevealWrong.tsx`:
  - Import: `import { gotItLine } from "@/lib/player/celebrationCopy";`
  - Add to props interface: `correctCount?: number; answeredCount?: number;`
  - Add to the destructure (no defaults so "absent" stays absent).
  - Render the line just under the "No points lost…" copy, only when both counts are numbers:

```tsx
{typeof correctCount === "number" && typeof answeredCount === "number" && (
  <div
    data-testid="reveal-awareness"
    style={{
      marginTop: 14,
      alignSelf: "flex-start",
      padding: "8px 14px",
      borderRadius: 99,
      background: t.surface,
      color: t.inkMid,
      fontSize: 14,
      fontWeight: 600,
    }}
  >
    {gotItLine(correctCount, answeredCount)}
  </div>
)}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run tests/unit/player-reveal-wrong-awareness.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add components/player/PlayerRevealWrong.tsx tests/unit/player-reveal-wrong-awareness.test.tsx
git commit -m "feat(july): 'N of M got this one' awareness line on wrong reveal (Phase 3)"
```

---

### Task 7: Social line on `PlayerRevealCorrect`

**Files:**
- Modify: `components/player/PlayerRevealCorrect.tsx`
- Test: `tests/unit/player-reveal-correct-social.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/player-reveal-correct-social.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/components/system";
import { PlayerRevealCorrect } from "@/components/player/PlayerRevealCorrect";

describe("PlayerRevealCorrect social line", () => {
  it("shows 'You + N others nailed it'", () => {
    render(
      <ThemeProvider themeKey="july">
        <PlayerRevealCorrect correctCount={8} />
      </ThemeProvider>,
    );
    expect(screen.getByText("You + 7 others nailed it")).toBeTruthy();
  });
  it("shows the solo line for a lone correct player", () => {
    render(
      <ThemeProvider themeKey="july">
        <PlayerRevealCorrect correctCount={1} />
      </ThemeProvider>,
    );
    expect(screen.getByText("You nailed it")).toBeTruthy();
  });
  it("omits the line when no count is given", () => {
    render(
      <ThemeProvider themeKey="july">
        <PlayerRevealCorrect />
      </ThemeProvider>,
    );
    expect(screen.queryByText(/nailed it/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run tests/unit/player-reveal-correct-social.test.tsx`

- [ ] **Step 3: Implement** — in `PlayerRevealCorrect.tsx`:
  - Import: `import { nailedItLine } from "@/lib/player/celebrationCopy";`
  - Add prop `correctCount?: number;` (no default).
  - Render between the speed-bonus block and the "NOW AT" rail (uses the dark-ink-on-lime treatment so it reads on the bright bg):

```tsx
{typeof correctCount === "number" && (
  <div
    data-testid="reveal-social"
    style={{
      marginTop: 16,
      alignSelf: "flex-start",
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "9px 16px",
      borderRadius: 99,
      background: "rgba(14,8,5,.10)",
      border: "1.5px solid rgba(14,8,5,.25)",
      color: "#0E0805",
      fontSize: 15,
      fontWeight: 700,
    }}
  >
    <span aria-hidden style={{ width: 9, height: 9, borderRadius: 99, background: "#0E0805" }} />
    {nailedItLine(correctCount)}
  </div>
)}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run tests/unit/player-reveal-correct-social.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add components/player/PlayerRevealCorrect.tsx tests/unit/player-reveal-correct-social.test.tsx
git commit -m "feat(july): 'You + N others nailed it' social line on correct reveal (Phase 3)"
```

---

### Task 8: `PlayerRevealCorrectSequence` (dark → bright)

**Files:**
- Create: `components/player/PlayerRevealCorrectSequence.tsx`
- Modify: `components/player/index.ts` (export)
- Test: `tests/unit/player-reveal-correct-sequence.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/player-reveal-correct-sequence.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ThemeProvider } from "@/components/system";
import { PlayerRevealCorrectSequence } from "@/components/player/PlayerRevealCorrectSequence";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("PlayerRevealCorrectSequence", () => {
  it("starts on the dark celebration, then reveals the bright payoff after the hold", () => {
    render(
      <ThemeProvider themeKey="july">
        <PlayerRevealCorrectSequence correctCount={8} payoffProps={{ awardedPoints: 220 }} darkMs={1000} />
      </ThemeProvider>,
    );
    // Dark phase first — the bright payoff is not yet shown.
    expect(screen.getByTestId("reveal-correct-dark")).toBeTruthy();
    expect(screen.queryByTestId("player-reveal-correct")).toBeNull();

    act(() => { vi.advanceTimersByTime(1000); });

    // Bright payoff now shown.
    expect(screen.getByTestId("player-reveal-correct")).toBeTruthy();
    expect(screen.getByText("You + 7 others nailed it")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run tests/unit/player-reveal-correct-sequence.test.tsx`

- [ ] **Step 3: Implement**

```tsx
// components/player/PlayerRevealCorrectSequence.tsx
"use client";

import { useEffect, useState } from "react";
import { Weather, useTheme } from "@/components/system";
import { PlayerRevealCorrect, type PlayerRevealCorrectProps } from "./PlayerRevealCorrect";

export interface PlayerRevealCorrectSequenceProps {
  /** Total correct (incl. you) — drives the social line on the payoff. */
  correctCount?: number;
  /** Everything the bright payoff needs (category, value, awardedPoints, …). */
  payoffProps?: PlayerRevealCorrectProps;
  /** How long the dark fireworks moment holds before the payoff. */
  darkMs?: number;
}

/**
 * The correct player's cinematic reveal: a dark navy sky where real fireworks
 * ignite in sync with the TV (the salvo beat is published by the gated
 * conductor in RoomRoute, and the engine mounted here draws it), then a gentle
 * transition into the bright "Correct! +points" payoff carrying the social
 * line. Glowing fireworks wash out on the bright takeover, so they play during
 * this dark beat first. Reduced motion: Weather renders its static glow.
 */
export function PlayerRevealCorrectSequence({
  correctCount,
  payoffProps,
  darkMs = 1000,
}: PlayerRevealCorrectSequenceProps) {
  const { themeKey } = useTheme();
  const [phase, setPhase] = useState<"dark" | "bright">("dark");

  useEffect(() => {
    const h = window.setTimeout(() => setPhase("bright"), darkMs);
    return () => window.clearTimeout(h);
  }, [darkMs]);

  if (phase === "bright") {
    return <PlayerRevealCorrect {...payoffProps} correctCount={correctCount} />;
  }

  return (
    <div
      data-testid="reveal-correct-dark"
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background: "#0E1A36",
        display: "flex",
        flexDirection: "column",
        animation: "tr1via-correct-flash .5s ease-out both",
      }}
    >
      {/* Phase-1 engine on a dark sky; the salvo beat ignites the burst in sync. */}
      <Weather themeKey={themeKey} intensity={2.2} />
    </div>
  );
}
```

Add to `components/player/index.ts`:
```ts
export { PlayerRevealCorrectSequence } from "./PlayerRevealCorrectSequence";
```

> Note: `Weather` only renders the firework engine when `themeKey === "july"`; on any other theme this dark frame is a brief navy flash (harmless — the sequence is only used on July, see Task 9 gating).

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run tests/unit/player-reveal-correct-sequence.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add components/player/PlayerRevealCorrectSequence.tsx components/player/index.ts tests/unit/player-reveal-correct-sequence.test.tsx
git commit -m "feat(july): dark→bright correct-reveal sequence (Phase 3)"
```

---

### Task 9: Wire the player route — gated conductor, 3-beat reveal, standings beat

**Files:**
- Modify: `app/(player)/room/[code]/page.tsx`

This is the integration task. Implement in small commits; run the full reveal-related suite after each sub-step.

- [ ] **Step 1: Imports + capture the per-question resolve summary**

In `PlayerRoomInner`/`RoomBody` area, import the new helpers:
```ts
import { PyrotechnicsBeatConductor } from "@/components/system";
import { gateBeatForPlayer, playerWasCorrect } from "@/lib/game/revealOutcome";
import { summarizeResolve } from "@/lib/player/celebrationCopy";
import { buildNeighborhood } from "@/lib/player/standings";
import {
  PlayerRevealCorrectSequence,
  PlayerStandingsNeighborhood,
} from "@/components/player";
```

In `RoomStateMachine`, capture the resolve summary per question (survives later broadcasts) — the awards live on `snapshot.lastBroadcast` only at resolve time:
```ts
// Per-question {correctCount, answeredCount} captured at resolve so a later
// broadcast (e.g. player-joined) overwriting lastBroadcast.awards can't blank
// the social line during the reveal hold.
const resolveSummaries = useRef<Map<string, { correctCount: number; answeredCount: number }>>(new Map());
useEffect(() => {
  const b = snapshot.lastBroadcast;
  if (b && (b.event === "resolve" || b.event === "end-early") && b.questionId) {
    resolveSummaries.current.set(b.questionId, summarizeResolve(b.awards));
  }
}, [snapshot.lastBroadcast]);
```

- [ ] **Step 2: Mount the gated conductor (July only)**

Compute `amCorrect` for the current resolved question and mount the conductor next to `{inner}` in the `RoomStateMachine` return. `amCorrect` reuses `playerWasCorrect` against whichever question is resolved:
```ts
const resolvedQ =
  snapshot.currentQuestion?.finished_at ? snapshot.currentQuestion
  : snapshot.lastResolvedQuestion;
const myResolvedAnswer = resolvedQ
  ? myAnswers.find((a) => a.question_id === resolvedQ.id) ?? null
  : null;
const amCorrect = playerWasCorrect(myResolvedAnswer, resolvedQ?.correct_index ?? null);
const isJuly = themeKey === "july";
```
In the return:
```tsx
return (
  <>
    {boltActive && me && (
      <PlayerLockInBolt active tint={playerColorHex(me.id)} onComplete={() => setBoltActive(false)} />
    )}
    {inner}
    {isJuly && (
      <PyrotechnicsBeatConductor
        beat={gateBeatForPlayer(snapshot.lastFireworksBeat, amCorrect)}
      />
    )}
  </>
);
```

- [ ] **Step 3: Drive the 3-beat reveal in `RevealView`**

`RevealView` already computes `wasCorrect`. Add a beat-phase timer so a correct reveal runs dark → payoff, and BOTH outcomes settle into standings after a hold. Pass `themeKey`, the resolve summary, and the neighborhood down into `RevealView`. Concretely, in `RevealView`:
  - Add props: `themeKey: ThemeKey; summary?: { correctCount: number; answeredCount: number }; neighborhood: Neighborhood;`
  - Add a phase state that advances on mount-per-question:
```ts
// celebrate → (payoff) → standings. Reset when the resolved question changes.
const [beat, setBeat] = useState<"reveal" | "standings">("reveal");
useEffect(() => {
  setBeat("reveal");
  const h = window.setTimeout(() => setBeat("standings"), 3200); // ~dark+payoff
  return () => window.clearTimeout(h);
}, [question.id]);
if (beat === "standings") {
  return (
    <PlayerStandingsNeighborhood
      rows={neighborhood.rows}
      meRank={neighborhood.meRank}
      total={neighborhood.total}
    />
  );
}
```
  - Replace the correct branch's `<PlayerRevealCorrect .../>` with, on July, the sequence:
```tsx
if (wasCorrect && myAnswer) {
  const payoffProps = { category: category.name, value: question.point_value ?? 100, awardedPoints: awarded, msToLock: myAnswer.ms_to_lock, streak, rank, totalScore, rankDelta: 0, nextHint: "Hold tight — the next question is on its way." };
  return themeKey === "july"
    ? <PlayerRevealCorrectSequence correctCount={summary?.correctCount} payoffProps={payoffProps} />
    : <PlayerRevealCorrect {...payoffProps} correctCount={summary?.correctCount} />;
}
```
  - Pass the counts into the wrong branch:
```tsx
return (
  <PlayerRevealWrong
    /* …existing props… */
    correctCount={summary?.correctCount}
    answeredCount={summary?.answeredCount}
  />
);
```

- [ ] **Step 4: Pass the new data into both `RevealView` call sites**

Both `RevealView` usages in `RoomStateMachine` (the live-resolved path and the between-questions hold path) get the extra props. Compute once:
```ts
const neighborhood = buildNeighborhood(scores ?? [], me.id, 4);
const summaryFor = (qid: string | undefined) => (qid ? resolveSummaries.current.get(qid) : undefined);
```
Add `themeKey={themeKey}`, `summary={summaryFor(question.id)}`, `neighborhood={neighborhood}` to both `<RevealView .../>` elements. (`themeKey` is already a prop of `RoomStateMachine`.)

- [ ] **Step 5: Run the player suite + typecheck**

Run: `npx vitest run tests/unit/ tests/integration/ && npx tsc --noEmit`
Expected: green (the 2 known `HostHomeClient` tsc errors are pre-existing baseline).

- [ ] **Step 6: Commit**

```bash
git add "app/(player)/room/[code]/page.tsx"
git commit -m "feat(july): wire phones — gated beat, dark→bright reveal, ±4 standings beat (Phase 3)"
```

---

### Task 10: Full verification + live multi-screen check

- [ ] **Step 1: Full unit/component/integration suite**

Run: `npm test`
Expected: all green (baseline was 768/0 after Phase 2; new tests add to that).

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: only the 2 known `HostHomeClient-founder-build.test.tsx` tsc errors; eslint introduces 0 new problems.

- [ ] **Step 3: Live dev harness — multi-screen**

- Start: `npm run dev`. Open `/dev/player` (and `/dev/tv`) on a July theme; or seed a July dev night and open 2–3 player browser contexts + the TV.
- Trigger a resolve. Confirm:
  - correct phones snap to the dark sky, fireworks ignite ~in step with the TV, then resolve to the bright payoff with "You + N others nailed it";
  - wrong phones stay calm with "N of M got this one" (no burst);
  - both settle into the ±4 standings, your row highlighted;
  - the answer/reveal UI stays responsive on the slowest context.
- Trigger a game end. Confirm the whole-room finale erupts on every phone + TV.
- Reduced motion (emulate `prefers-reduced-motion: reduce`): the dark beat shows the calm static glow, no flashing; standings render normally.
- **TV no-regression:** capture `/dev/tv` July before/after; confirm the venue TV fireworks are unchanged (the phone budget must not touch the large-canvas path). Use the headless-canvas frame-isolation trick from `tasks/lessons.md` if screenshotting deep in `/dev/tv`.

- [ ] **Step 4: Adversarial review (per the plan's quality bar)**

Run the repo review agents (`silent-failure-hunter`, `code-reviewer`) on the diff; specifically try to prove: a wrong phone can fire a salvo (it must not); a stale/late beat double-fires across the dark→bright remount (Phase-2 de-dup must hold — see lesson `sync-beat-schedule-against-target-not-fire-on-mount`); the standings beat reads stale scores; the phone budget regresses the TV.

- [ ] **Step 5: Update the master plan + memory**

Mark Phase 3 done in `tasks/july-pyrotechnics-plan.md` (status header + Phase 3 section), write a `tasks/july-pyrotechnics-phase3-report.md`, and update the `july-pyrotechnics` memory. STOP — do not start Phase 4 (hard gate).

---

## Self-review (against the spec)

- **Earned fireworks (correct only):** Task 3 gate + Task 9 Step 2 (`gateBeatForPlayer` salvo→amCorrect). ✓
- **Dark→bright cinematic:** Tasks 8 + 9 Step 3. ✓
- **Social lines, count-only, both directions:** Tasks 2, 6, 7 + 9. ✓
- **±4 standings, 3rd beat, never overlaps fireworks:** Tasks 1, 5 + 9 Step 3 (standings is a separate phase after a 3.2s hold; fireworks live in the dark/payoff phases only). ✓
- **Whole-room finale:** Task 3 (`finale` ungated) + 9 Step 2; standings beat uses `PhoneScreen` so its engine can host the finale burst. ✓
- **Phone budget, TV unchanged:** Task 4 (`pyroBudget`, threshold gates the TV out). ✓
- **No migration / no new reads:** counts from `awards` (already on `lastBroadcast`), standings from the already-loaded `scores`; one beat broadcast. ✓
- **Reduced motion / fail-soft:** Weather static fallback in Task 8; gated beat is best-effort (Phase-2 behavior). ✓
- **Type consistency:** `StandingRow` (from `betweenGames`) reused by `buildNeighborhood` + `PlayerStandingsNeighborhood`; `FireworksBeat` reused by the gate; `ResolveAward` shape matches `useRoom`'s `awards`. ✓
- **Deferred to Phase 4:** lock-in ceremony, finale crescendo, palette sweep — not in any task. ✓
