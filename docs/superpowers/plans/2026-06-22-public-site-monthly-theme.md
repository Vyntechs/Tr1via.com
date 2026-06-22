# Public-site monthly theming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every public-facing page (landing, marketing, player `/join`, host `/login`) automatically wear the current calendar month's theme — flipping to "July · 4th" on July 1 — while live games, host surfaces, the TV, and the multi-theme showcase pages stay exactly as they are.

**Architecture:** The theme resolver already returns the current month for an anonymous surface (`resolveTheme(null, null)`). The only thing pinning the public site to "daylight" is two literals in `app/layout.tsx`. We replace them with the resolved month, and add the proven no-FOUC pattern so a statically-cached page flips correctly at a month boundary with no flash: a render-blocking inline `<script>` sets `data-theme` from the visitor's live clock before first paint, and a thin `SeasonalThemeProvider` makes React's `ThemeProvider` agree (so its mount effect can't revert to the build-time month). Both the script and the provider read ONE month→theme array derived from `resolveTheme`, so client and server can never drift.

**Tech Stack:** Next.js 16 App Router (RSC root layout), React 19, TypeScript (strict), Vitest + Testing Library, `react-dom/server` for layout markup assertions.

## Global Constraints

- Source of truth is `origin/main`; build on a fresh branch/worktree off it, NOT `fix/rls-correct-index-leak`.
- No DB/schema changes, no new themes, no palette edits, no new routes.
- Game/host/player/TV surfaces and the pricing + `/themes` showcase pages MUST be provably unchanged.
- `SYSTEM_DEFAULT_THEME` stays `"daylight"` (it is now the true last-resort fallback, not the literal root default).
- Keep the full `npm test` suite green and `npx tsc --noEmit` at its 2 known pre-existing errors (in `HostHomeClient-founder-build.test.tsx`) — no new errors.
- Deploy is Brandon's gate. This plan stops at a verified preview.

## File Structure

- **Create** `lib/theme/monthThemeScript.ts` — the single client-facing month source: `MONTH_THEME_KEYS` (derived from `resolveTheme`), `monthThemeKey(monthIndex)`, and `MONTH_THEME_SCRIPT` (the render-blocking string). One responsibility: "what theme does the client show for a given calendar month, and the script that applies it pre-paint."
- **Create** `components/system/SeasonalThemeProvider.tsx` — a `"use client"` wrapper that computes the live month on the client and renders the existing `ThemeProvider` with it. One responsibility: "feed `ThemeProvider` the live month so it never reverts a cached page."
- **Modify** `app/layout.tsx` — resolve the month for SSR, inject the script, wrap children in `SeasonalThemeProvider`.
- **Modify** `lib/theme/resolveTheme.ts` — comment-only: the two notes claiming the root `<ThemeProvider>` is `SYSTEM_DEFAULT` are now stale (the public root seasonalizes). Truthful comments only; no behavior change.
- **Modify** `tests/unit/resolveTheme.test.ts` — comment + test-name only on the `SYSTEM_DEFAULT_THEME` sanity check (now "last-resort fallback", not "layout default"). Assertion unchanged.
- **Create** tests: `tests/unit/monthThemeScript.test.ts`, `tests/unit/SeasonalThemeProvider.test.tsx`, `tests/unit/root-layout-theme.test.tsx`.

---

### Task 1: Month-theme client map + render-blocking script

**Files:**
- Create: `lib/theme/monthThemeScript.ts`
- Test: `tests/unit/monthThemeScript.test.ts`

**Interfaces:**
- Consumes: `resolveTheme(night, host, now)` from `@/lib/theme/resolveTheme`, `ThemeKey` from `@/lib/theme/tokens`.
- Produces:
  - `MONTH_THEME_KEYS: readonly ThemeKey[]` — 12 keys, Jan(0)…Dec(11).
  - `monthThemeKey(monthIndex: number): ThemeKey | undefined`.
  - `MONTH_THEME_SCRIPT: string` — IIFE that sets `document.documentElement` `data-theme` to the live month.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/monthThemeScript.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MONTH_THEME_KEYS,
  MONTH_THEME_SCRIPT,
  monthThemeKey,
} from "@/lib/theme/monthThemeScript";

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute("data-theme");
});

describe("monthThemeScript", () => {
  it("MONTH_THEME_KEYS lists all 12 months in calendar order", () => {
    expect(MONTH_THEME_KEYS).toEqual([
      "january", "february", "march", "april", "may", "june",
      "july", "august", "september", "october", "november", "december",
    ]);
  });

  it("monthThemeKey maps JS month index (0-11) to the right theme", () => {
    expect(monthThemeKey(5)).toBe("june");
    expect(monthThemeKey(6)).toBe("july");
    expect(monthThemeKey(0)).toBe("january");
    expect(monthThemeKey(11)).toBe("december");
  });

  it("the script sets data-theme to the visitor's live month before paint", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 1)); // July
    // eslint-disable-next-line no-eval
    (0, eval)(MONTH_THEME_SCRIPT);
    expect(document.documentElement.getAttribute("data-theme")).toBe("july");
  });

  it("the script swallows errors and leaves the SSR attribute intact", () => {
    document.documentElement.setAttribute("data-theme", "june");
    // Force getMonth() to throw; the IIFE must not propagate it.
    const spy = vi.spyOn(Date.prototype, "getMonth").mockImplementation(() => {
      throw new Error("boom");
    });
    // eslint-disable-next-line no-eval
    expect(() => (0, eval)(MONTH_THEME_SCRIPT)).not.toThrow();
    expect(document.documentElement.getAttribute("data-theme")).toBe("june");
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/monthThemeScript.test.ts`
Expected: FAIL — `Cannot find module '@/lib/theme/monthThemeScript'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/theme/monthThemeScript.ts
// The single client-facing month source. Both the pre-paint inline script and
// SeasonalThemeProvider read MONTH_THEME_KEYS, which is DERIVED from the one
// server resolver (resolveTheme) — so the client can never disagree with the
// server about which month wears which palette.
import { resolveTheme } from "@/lib/theme/resolveTheme";
import type { ThemeKey } from "@/lib/theme/tokens";

/** 12 month theme keys in JS-month order: index 0 = January … 11 = December.
 *  Derived from resolveTheme(null, null, <date in month N>) so this list and
 *  the server's month fallback are guaranteed identical. */
export const MONTH_THEME_KEYS: readonly ThemeKey[] = Array.from(
  { length: 12 },
  (_, i) => resolveTheme(null, null, new Date(2026, i, 15)),
);

/** Pure: a JS Date month index (0-11) → the month's ThemeKey. */
export function monthThemeKey(monthIndex: number): ThemeKey | undefined {
  return MONTH_THEME_KEYS[monthIndex];
}

/** A render-blocking IIFE for the top of <body>. It reads the visitor's LIVE
 *  local month and sets data-theme before first paint, so a statically-cached
 *  page flips at a month boundary with no flash and without forcing dynamic
 *  rendering. Self-contained vanilla JS (no imports at runtime); on any error
 *  it no-ops and the SSR-rendered data-theme stands. */
export const MONTH_THEME_SCRIPT = `(function(){try{var k=${JSON.stringify(
  MONTH_THEME_KEYS,
)};var t=k[new Date().getMonth()];if(t){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/monthThemeScript.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/theme/monthThemeScript.ts tests/unit/monthThemeScript.test.ts
git commit -m "feat(theme): derive client month-theme map + pre-paint script from resolveTheme"
```

---

### Task 2: SeasonalThemeProvider

**Files:**
- Create: `components/system/SeasonalThemeProvider.tsx`
- Test: `tests/unit/SeasonalThemeProvider.test.tsx`

**Interfaces:**
- Consumes: `ThemeProvider` + `useTheme` from `@/components/system/ThemeProvider`, `monthThemeKey` from `@/lib/theme/monthThemeScript`, `ThemeKey` from `@/lib/theme/tokens`.
- Produces: `SeasonalThemeProvider({ ssrThemeKey: ThemeKey, children: ReactNode })`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/SeasonalThemeProvider.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SeasonalThemeProvider } from "@/components/system/SeasonalThemeProvider";
import { useTheme } from "@/components/system/ThemeProvider";

function Probe() {
  const { themeKey } = useTheme();
  return <span data-testid="k">{themeKey}</span>;
}

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute("data-theme");
});

describe("SeasonalThemeProvider", () => {
  it("themes to the visitor's live month, ignoring a stale SSR key", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 2)); // July; SSR baked June
    render(
      <SeasonalThemeProvider ssrThemeKey="june">
        <Probe />
      </SeasonalThemeProvider>,
    );
    expect(screen.getByTestId("k").textContent).toBe("july");
    expect(document.documentElement.getAttribute("data-theme")).toBe("july");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/SeasonalThemeProvider.test.tsx`
Expected: FAIL — `Cannot find module '@/components/system/SeasonalThemeProvider'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/system/SeasonalThemeProvider.tsx
"use client";

import { useState, type ReactNode } from "react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { monthThemeKey } from "@/lib/theme/monthThemeScript";
import type { ThemeKey } from "@/lib/theme/tokens";

/**
 * The public-site default theme: the LIVE calendar month, computed on the
 * client so a statically-cached page wears the real current month (matching
 * the pre-paint inline script) instead of the month it was built in.
 *
 * `ssrThemeKey` is the server's best-effort month, used for the first server
 * paint and the no-JS case. Surfaces that need a specific theme (a live game,
 * host setup) mount their own <ThemeProvider> deeper in the tree and override
 * this — so this only governs anonymous/public pages.
 */
export function SeasonalThemeProvider({
  ssrThemeKey,
  children,
}: {
  ssrThemeKey: ThemeKey;
  children: ReactNode;
}) {
  const [themeKey] = useState<ThemeKey>(() =>
    typeof document === "undefined"
      ? ssrThemeKey
      : monthThemeKey(new Date().getMonth()) ?? ssrThemeKey,
  );
  return <ThemeProvider themeKey={themeKey}>{children}</ThemeProvider>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/SeasonalThemeProvider.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/system/SeasonalThemeProvider.tsx tests/unit/SeasonalThemeProvider.test.tsx
git commit -m "feat(theme): SeasonalThemeProvider — public default follows the live month"
```

---

### Task 3: Wire the public root layout (+ truthful comments)

**Files:**
- Modify: `app/layout.tsx`
- Modify: `lib/theme/resolveTheme.ts` (comments only)
- Modify: `tests/unit/resolveTheme.test.ts` (comment + test name only)
- Test: `tests/unit/root-layout-theme.test.tsx`

**Interfaces:**
- Consumes: `resolveTheme` (`@/lib/theme/resolveTheme`), `MONTH_THEME_SCRIPT` (`@/lib/theme/monthThemeScript`), `SeasonalThemeProvider` (`@/components/system/SeasonalThemeProvider`).
- Produces: a root layout whose `<html data-theme>` is the current month, with the pre-paint script first in `<body>` and children wrapped in `SeasonalThemeProvider`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/root-layout-theme.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// next/font/google is a build-time transform; stub it so the RSC layout renders
// under vitest.
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono" }),
  Bricolage_Grotesque: () => ({ variable: "--font-bricolage" }),
}));

import RootLayout from "@/app/layout";

afterEach(() => vi.useRealTimers());

describe("RootLayout seasonal theming", () => {
  it("sets <html data-theme> to the current month and injects the pre-paint script", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 1)); // July
    const html = renderToStaticMarkup(
      <RootLayout>
        <div id="kid" />
      </RootLayout>,
    );
    expect(html).toContain('data-theme="july"');
    // pre-paint correction script present
    expect(html).toContain("setAttribute('data-theme'");
    // children still render
    expect(html).toContain('id="kid"');
  });

  it("falls to a valid month for any calendar month (no daylight pin)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 9)); // January
    const html = renderToStaticMarkup(
      <RootLayout>
        <div />
      </RootLayout>,
    );
    expect(html).toContain('data-theme="january"');
    expect(html).not.toContain('data-theme="daylight"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/root-layout-theme.test.tsx`
Expected: FAIL — markup still contains `data-theme="daylight"`, not `"july"`.

- [ ] **Step 3: Modify `app/layout.tsx`**

Replace the imports block and the `RootLayout` function:

```tsx
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import { SeasonalThemeProvider } from "@/components/system/SeasonalThemeProvider";
import { resolveTheme } from "@/lib/theme/resolveTheme";
import { MONTH_THEME_SCRIPT } from "@/lib/theme/monthThemeScript";
```

(Keep the existing `geist`/`geistMono`/`bricolage`, `metadata`, and `viewport` declarations untouched, then:)

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Public-site default = the live calendar month. resolveTheme(null, null)
  // returns the current month's key (its layer-3 fallback); the inline script
  // + SeasonalThemeProvider correct a statically-cached page to the visitor's
  // real month at runtime. Surfaces that need a specific theme (a live game,
  // host setup) mount their own <ThemeProvider> deeper and override this.
  const ssrThemeKey = resolveTheme(null, null);
  return (
    <html
      lang="en"
      data-theme={ssrThemeKey}
      className={`${geist.variable} ${geistMono.variable} ${bricolage.variable}`}
      suppressHydrationWarning
    >
      <body>
        {/* Render-blocking: flip data-theme to the visitor's live month before
            first paint, so a cached page wakes up in the right season. */}
        <script dangerouslySetInnerHTML={{ __html: MONTH_THEME_SCRIPT }} />
        <SeasonalThemeProvider ssrThemeKey={ssrThemeKey}>
          {children}
        </SeasonalThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Update stale comments in `lib/theme/resolveTheme.ts`**

In the file header comment, change the `SYSTEM_DEFAULT` note (around lines 21-23) from claiming it "matches `app/layout.tsx`'s root `<ThemeProvider>`" to the truthful:

```ts
// SYSTEM_DEFAULT is the true last-resort fallback. The public root layout now
// seasonalizes (resolveTheme(null, null) → current month); daylight only shows
// if month resolution itself somehow fails.
```

And in the `SYSTEM_DEFAULT_THEME` jsdoc (around lines 40-42), replace the "Matches `app/layout.tsx`'s root `<ThemeProvider>`…" sentence with:

```ts
 *  Last-resort only; the public root layout renders the current month, not
 *  this constant. Kept as the stable floor for surfaces with no calendar.
```

- [ ] **Step 5: Update the now-stale test comment/name in `tests/unit/resolveTheme.test.ts`**

Change the test at ~line 134 from:

```ts
    it("SYSTEM_DEFAULT_THEME matches the layout default ('daylight')", () => {
      // Sanity check: if this fails, app/layout.tsx and resolveTheme
      // disagree about the first-paint theme — back to the inconsistency
      // bug that motivated PR #28.
      expect(SYSTEM_DEFAULT_THEME).toBe("daylight");
    });
```

to:

```ts
    it("SYSTEM_DEFAULT_THEME is the documented last-resort fallback ('daylight')", () => {
      // The public root now renders the live month, not this constant; daylight
      // remains only the floor for surfaces with no calendar/host/night.
      expect(SYSTEM_DEFAULT_THEME).toBe("daylight");
    });
```

- [ ] **Step 6: Run the focused tests**

Run: `npx vitest run tests/unit/root-layout-theme.test.tsx tests/unit/resolveTheme.test.ts`
Expected: PASS (both files).

- [ ] **Step 7: Commit**

```bash
git add app/layout.tsx lib/theme/resolveTheme.ts tests/unit/resolveTheme.test.ts tests/unit/root-layout-theme.test.tsx
git commit -m "feat(theme): public site follows the live month (seasonal root); truthful default comments"
```

---

### Task 4: Full-suite + type verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole unit/component/integration suite**

Run: `npm test`
Expected: PASS for all theme/marketing tests; no NEW failures vs baseline. Specifically confirm green: `tests/unit/resolveTheme.test.ts`, `tests/unit/themes-page.test.tsx`, `tests/unit/theme-showcase.test.tsx`, `tests/unit/marketing/ThemedSection.test.tsx`, `tests/unit/marketing/themeVars.test.ts`, `tests/unit/marketing/seo-and-scope.test.ts`, plus the 3 new files.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: ONLY the 2 known pre-existing errors in `HostHomeClient-founder-build.test.tsx`. Any other error = fix before proceeding.

- [ ] **Step 3: Commit (if any fixups were needed)**

```bash
git add -A && git commit -m "test(theme): keep full suite + types green for seasonal root"
```

---

### Task 5: Visual verification across all 12 months (workflow + manual eyeball)

**Files:** none (verification only). This is the asset-clash safety pass promised to Brandon.

- [ ] **Step 1: Boot the dev server** (`npm run dev`) and, for each public page (`/trivia-night`, `/pricing`, `/themes`, `/join`, `/login`, and `/`), confirm under a forced `data-theme` for each of the 12 months:
  - the page adopts the month's palette (paper/ink/accent visibly change),
  - text stays legible (contrast is token-designed, but verify),
  - the pricing page + `/themes` gallery STILL show multiple month-looks side by side (showcase intact),
  - flag any hero image/screenshot that was composed for the light look and clashes on a dark month (July/October/etc).
- [ ] **Step 2: Confirm the June→July boundary** by faking the client date to `2026-07-01` and reloading a cached page — it must paint July with no flash back to June.
- [ ] **Step 3: Produce a screenshot set** (one per season, key pages) and a written list of any flagged asset issues with fix recommendations — this is the package handed to Brandon for the deploy gate.

---

## Self-Review

**Spec coverage:**
- "Every public page follows the month" → Task 3 (root) + Task 2 (live-month provider). ✅
- "Keep the variety showcase" → no change to `ThemedSection`/pricing/`themes`; verified in Task 4 (showcase tests green) + Task 5 (eyeball). ✅
- "Flip correctly at a month boundary even on cached pages, no flash" → Task 1 script + Task 2 provider; verified Task 5 Step 2. ✅
- "Game/host/player/TV unchanged" → those mount their own `ThemeProvider`/hardcoded black; Task 4 suite + Task 5. ✅
- "No DB/theme/route changes" → file list is layout + 2 new theme/system files + tests. ✅
- "Image clash risk surfaced" → Task 5. ✅
- "No deploy" → plan terminates at the preview package. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows the command + expected result. ✅

**Type consistency:** `MONTH_THEME_KEYS` / `monthThemeKey` / `MONTH_THEME_SCRIPT` (Task 1) are consumed verbatim in Tasks 2-3. `SeasonalThemeProvider({ ssrThemeKey, children })` (Task 2) matches its use in `app/layout.tsx` (Task 3). `resolveTheme(null, null)` returns `ThemeKey`, matching `ssrThemeKey: ThemeKey`. ✅

## Execution

Execute INLINE in this session via superpowers:executing-plans (3 small, tightly-coupled TDD tasks), in a fresh git worktree off `origin/main`. Then run Task 5 as a verification workflow (parallel per-theme eyeball + an adversarial "did anything in a live game/showcase change?" reviewer) before handing Brandon the preview + deploy gate.
