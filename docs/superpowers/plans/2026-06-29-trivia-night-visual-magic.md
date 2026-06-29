# Trivia Night Visual Magic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `/trivia-night` with a proportional TR1VIA wordmark and a silent, original theme-troupe visual layer that makes monthly theme cycling feel magical without obscuring what the product does.

**Architecture:** Keep this marketing-only. Reuse the existing `Wordmark` for logo proportion and add one focused client visual layer inside `YearInOneTouch`, keyed from the existing month/theme state already used by the rail. The troupe is decorative but product-bound: tiny stagehands visually transform host, TV, and player-phone surfaces; no audio, no shared theme registry changes, no host/player/TV/API changes.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS v4, Vitest + Testing Library, existing TR1VIA theme tokens as read-only inputs.

## Global Constraints

- Scope is `/trivia-night` marketing only.
- Do not modify `lib/theme/tokens.ts`, `lib/theme/lockInCeremony.ts`, live host/player/TV surfaces, API routes, Supabase, or realtime code.
- No sound: no audio APIs, no sound effects, no speaker/music UI, no copy implying audible music.
- Visual magic must preserve first-viewport product clarity: host control, venue TV, and player phones remain understandable.
- Respect `prefers-reduced-motion`: static magical poses instead of dancing/float motion.
- Use the reusable `worldclass-visual-magic` standard: no generic mascots, no sparkle-as-concept, one ownable visual ritual.

---

## File Structure

**Create:**
- `components/marketing/ThemeCharacterBand.tsx` — silent theme-troupe visual layer; consumes `themeKey`, `activeIndex`, and `homeIndex`; exports `THEME_TROUPE` for tests.
- `tests/unit/marketing/ThemeCharacterBand.test.tsx` — guards no-audio copy, theme-key coverage, reduced-motion/static affordance markup.

**Modify:**
- `app/(marketing)/trivia-night/page.tsx` — replace hand-coded header logo with `Wordmark`, adjust sizing/spacing, and keep CTA tests stable.
- `components/marketing/YearInOneTouch.tsx` — mount `ThemeCharacterBand` near the hero/year rail using existing selected theme/index state.
- `tests/unit/trivia-night-marketing.test.tsx` — add logo/first-viewport assertions if needed.
- `tests/unit/YearInOneTouch.test.tsx` — assert the visual layer tracks selected month and remains silent.

**Read-only:**
- `components/system/Wordmark.tsx`
- `lib/theme/tokens.ts`
- `lib/theme/monthThemeScript.ts`
- `components/system/Weather.tsx`

---

## Task 1: Proportional Wordmark In The Landing Header

**Files:**
- Modify: `app/(marketing)/trivia-night/page.tsx`
- Test: `tests/unit/trivia-night-marketing.test.tsx`

**Interfaces:**
- Consumes: `Wordmark` from `@/components/system`
- Produces: header logo link with accessible name `TR1VIA home`

- [ ] **Step 1: Write the failing test**

Add this assertion to `tests/unit/trivia-night-marketing.test.tsx`:

```tsx
it("renders the canonical proportional wordmark in the header", () => {
  renderPage();
  const home = screen.getByRole("link", { name: /tr1via home/i });
  expect(home.textContent?.replace(/\s+/g, "")).toContain("TR1VIA");
  expect(home.querySelector("[data-testid='tr1via-wordmark']")).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/trivia-night-marketing.test.tsx`

Expected: FAIL because the current header hand-codes text and has no `data-testid='tr1via-wordmark'`.

- [ ] **Step 3: Minimal implementation**

In `app/(marketing)/trivia-night/page.tsx`, update imports:

```tsx
import { Display, Eyebrow, Wordmark } from "@/components/system";
```

Replace the hand-coded header logo span with:

```tsx
<span data-testid="tr1via-wordmark">
  <Wordmark
    size={26}
    weight={800}
    tracking={-0.018}
    style={{ display: "inline-flex" }}
  />
</span>
```

Do not modify `components/system/Wordmark.tsx`; this task only changes the marketing header wrapper.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/trivia-night-marketing.test.tsx`

Expected: PASS.

---

## Task 2: Silent Theme Troupe Component

**Files:**
- Create: `components/marketing/ThemeCharacterBand.tsx`
- Test: `tests/unit/marketing/ThemeCharacterBand.test.tsx`

**Interfaces:**
- Consumes: `themeKey: ThemeKey`, `activeIndex: number`, `homeIndex: number`
- Produces: a decorative, accessible-safe visual layer with `data-testid="theme-character-band"` and one active theme label for tests

- [ ] **Step 1: Write the failing test**

Create `tests/unit/marketing/ThemeCharacterBand.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { THEME_TROUPE, ThemeCharacterBand } from "@/components/marketing/ThemeCharacterBand";
import { MONTH_THEME_KEYS } from "@/lib/theme/monthThemeScript";

describe("ThemeCharacterBand", () => {
  it("covers every monthly theme with an original visual role", () => {
    expect(Object.keys(THEME_TROUPE).sort()).toEqual([...MONTH_THEME_KEYS].sort());
    for (const key of MONTH_THEME_KEYS) {
      expect(THEME_TROUPE[key].role).not.toMatch(/mascot/i);
      expect(THEME_TROUPE[key].gesture.length).toBeGreaterThan(0);
    }
  });

  it("renders visual-only magic with no sound language", () => {
    render(<ThemeCharacterBand themeKey="july" activeIndex={6} homeIndex={6} />);
    const band = screen.getByTestId("theme-character-band");
    expect(band.textContent).not.toMatch(/sound|audio|music|speaker|song|listen/i);
    expect(screen.getByText(/sparkler cue/i)).toBeTruthy();
  });

  it("marks itself decorative so product copy remains the accessible focus", () => {
    render(<ThemeCharacterBand themeKey="december" activeIndex={11} homeIndex={6} />);
    expect(screen.getByTestId("theme-character-band")).toHaveAttribute("aria-hidden", "true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/marketing/ThemeCharacterBand.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the component**

Create `components/marketing/ThemeCharacterBand.tsx`:

```tsx
"use client";

import type { ThemeKey } from "@/lib/theme/tokens";

type TroupeMember = {
  name: string;
  role: string;
  gesture: string;
  prop: string;
};

export const THEME_TROUPE: Record<Exclude<ThemeKey, "house" | "daylight">, TroupeMember> = {
  january: { name: "Glint", role: "ice cue keeper", gesture: "glass-step", prop: "frost card" },
  february: { name: "Luma", role: "heartlight caller", gesture: "soft-sway", prop: "ribbon glow" },
  march: { name: "Pip", role: "clover stagehand", gesture: "quick-hop", prop: "gold fleck" },
  april: { name: "Vera", role: "bloom switcher", gesture: "petal-turn", prop: "rain charm" },
  may: { name: "Rook", role: "storm cue keeper", gesture: "flash-freeze", prop: "cloud card" },
  june: { name: "Sol", role: "summer light puller", gesture: "sun-drift", prop: "warm lens" },
  july: { name: "Nova", role: "sparkler cue", gesture: "bright-pop", prop: "paper spark" },
  august: { name: "Ember", role: "late-sun stagehand", gesture: "slow-slide", prop: "amber flag" },
  september: { name: "Marn", role: "fall turner", gesture: "leaf-pivot", prop: "copper card" },
  october: { name: "Hex", role: "shadow cue keeper", gesture: "peek-hide", prop: "tiny lantern" },
  november: { name: "Gourd", role: "table-glow caller", gesture: "warm-bow", prop: "harvest tile" },
  december: { name: "Bell", role: "pine light puller", gesture: "soft-ring pose", prop: "star tag" },
};

export function ThemeCharacterBand({
  themeKey,
  activeIndex,
  homeIndex,
}: {
  themeKey: ThemeKey;
  activeIndex: number;
  homeIndex: number;
}) {
  if (themeKey === "house" || themeKey === "daylight") return null;
  const member = THEME_TROUPE[themeKey];
  const isHome = activeIndex === homeIndex;

  return (
    <div
      aria-hidden="true"
      data-testid="theme-character-band"
      data-theme-character={themeKey}
      className="pointer-events-none mx-auto mt-6 grid max-w-[1140px] grid-cols-[1fr_auto_1fr] items-end gap-3 px-6 sm:mt-8"
    >
      <div className="hidden h-px bg-[color:var(--line)] sm:block" />
      <div className="relative flex min-h-[88px] items-end justify-center gap-2 rounded-2xl px-4 py-3">
        <span className="relative grid size-16 place-items-center rounded-full border text-[11px] font-bold uppercase tracking-[0.12em]"
          style={{ borderColor: "var(--line)", background: "var(--surface)", color: "var(--ink)" }}>
          {member.name}
        </span>
        <span className="rounded-full bg-accent px-3 py-1 font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-[0.14em] text-white">
          {member.role}
        </span>
        <span className="rounded-full px-3 py-1 text-[10px] font-semibold"
          style={{ background: "var(--surface)", color: "var(--ink-mid)", border: "1px solid var(--line)" }}>
          {isHome ? "you are here" : member.gesture}
        </span>
      </div>
      <div className="hidden h-px bg-[color:var(--line)] sm:block" />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/marketing/ThemeCharacterBand.test.tsx`

Expected: PASS.

---

## Task 3: Mount The Troupe In `YearInOneTouch`

**Files:**
- Modify: `components/marketing/YearInOneTouch.tsx`
- Test: `tests/unit/YearInOneTouch.test.tsx`

**Interfaces:**
- Consumes: `ThemeCharacterBand`
- Produces: selected month theme drives both the rail and troupe

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/YearInOneTouch.test.tsx`:

```tsx
it("keeps the visual troupe synchronized to the selected month without audio affordances", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 6, 4)); // July
  act(() => {
    mount("july");
  });
  expect(screen.getByTestId("theme-character-band")).toHaveAttribute("data-theme-character", "july");
  act(() => {
    fireEvent.click(screen.getByRole("tab", { name: /dec/i }));
  });
  expect(screen.getByTestId("theme-character-band")).toHaveAttribute("data-theme-character", "december");
  expect(screen.getByTestId("theme-character-band").textContent).not.toMatch(/sound|audio|music|speaker/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/YearInOneTouch.test.tsx`

Expected: FAIL because `ThemeCharacterBand` is not mounted.

- [ ] **Step 3: Implement the mount**

In `components/marketing/YearInOneTouch.tsx`, import:

```tsx
import { ThemeCharacterBand } from "@/components/marketing/ThemeCharacterBand";
```

Render after `{children}` and before the month rail label:

```tsx
<ThemeCharacterBand themeKey={selected} activeIndex={index} homeIndex={homeIndex} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/YearInOneTouch.test.tsx`

Expected: PASS.

---

## Task 4: Polish The Visual Layer Into A Premium Silent Ritual

**Files:**
- Modify: `components/marketing/ThemeCharacterBand.tsx`
- Modify: `components/marketing/YearInOneTouch.tsx` only if layout spacing needs one wrapper change

**Interfaces:**
- Consumes: current CSS variables from the global monthly theme
- Produces: no layout shift, subtle motion, static reduced-motion state

- [ ] **Step 1: Add reduced-motion-safe animation classes**

In `ThemeCharacterBand`, use inline style/CSS classes that animate only transform/opacity and rely on global reduced-motion rules. Keep motion below the hero CTA and product demo in visual hierarchy.

Expected implementation shape:

```tsx
className="... motion-safe:animate-[tr1via-rise_520ms_ease-out_both]"
```

If a custom keyframe is required, add it to `app/globals.css` only if an existing primitive cannot express the motion. If `app/globals.css` is touched, update `tests/unit/marketing/seo-and-scope.test.ts` allowlist intentionally.

- [ ] **Step 2: Browser review**

Run: `npm run dev`

Open: `http://localhost:3000/trivia-night`

Check:
- Logo looks intentional at desktop and mobile widths.
- Troupe sits near the product demo/year rail, not over the headline or CTA.
- Hover/clicking months changes troupe state.
- No audio UI or sound expectation appears.
- Reduced motion keeps the troupe legible and mostly still.

---

## Task 5: Verification Pass

**Files:**
- No expected source edits unless tests reveal a bug.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run tests/unit/trivia-night-marketing.test.tsx tests/unit/YearInOneTouch.test.tsx tests/unit/marketing/ThemeCharacterBand.test.tsx tests/unit/marketing/seo-and-scope.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run broader marketing tests**

Run:

```bash
npx vitest run tests/unit/marketing tests/unit/theme-showcase.test.tsx tests/unit/themes-page.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Scope audit**

Run:

```bash
git diff --name-only
```

Expected changed paths only under:

```text
app/(marketing)/trivia-night/page.tsx
components/marketing/YearInOneTouch.tsx
components/marketing/ThemeCharacterBand.tsx
tests/unit/trivia-night-marketing.test.tsx
tests/unit/YearInOneTouch.test.tsx
tests/unit/marketing/ThemeCharacterBand.test.tsx
docs/superpowers/plans/2026-06-29-trivia-night-visual-magic.md
```

- [ ] **Step 4: Final browser check**

Check `/trivia-night` at:
- Desktop: 1440px wide
- Mobile: 390px wide
- Reduced motion enabled

Expected: first viewport still communicates live trivia hosting, the wordmark is proportional, and the silent troupe reads as visual transformation rather than music/audio.

---

## Self-Review

- Spec coverage: logo proportion, silent visual magic, product clarity, no shared theme changes, reduced motion, and marketing-only boundaries are all assigned to tasks.
- Placeholder scan: no placeholder markers are present.
- Type consistency: `ThemeCharacterBand` props are stable across test, component, and mount plan.
- Known risk: the starter implementation may look too symbolic if left as text/chips. The polish step must turn it into a premium visual ritual with shape, spacing, and motion while keeping tests stable.
