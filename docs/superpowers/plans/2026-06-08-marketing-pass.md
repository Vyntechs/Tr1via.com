# Full Marketing Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the public marketing hub (`/trivia-night`) into a world-class, conversion-first showpiece that tours all 12 monthly themes as you scroll ("The Year Scroll"), add a `/pricing` page with FAQ, and lightly polish `/themes` — all built Figma-first, touching nothing the live host/player/TV experience uses.

**Architecture:** Server-rendered marketing pages on the existing Next 16 / React 19 / Tailwind 4 stack and the existing daylight design system. Each hub section is a server-rendered `ThemedSection` that paints itself in one month's real `{paper, ink, accent, …}` palette by setting CSS vars **inline** from `lib/theme/tokens.ts` (read-only) — so the page is readable, themed, and SEO-complete with **zero JavaScript**. A thin client island (`YearScroll`) layers smooth accent cross-fades + ambient motion on top as pure progressive enhancement, suppressed under `prefers-reduced-motion`.

**Tech Stack:** Next.js 16 (App Router, server components), React 19, Tailwind v4, Vitest + @testing-library/react, the `lib/theme` token system (read-only), the `components/system` + `components/marketing` design system.

**Source spec:** `docs/superpowers/specs/2026-06-08-marketing-pass-design.md`

**Hard guardrail (every task):** changes are confined to `app/(marketing)/**`, `app/page.tsx`, `components/marketing/**`, `docs/superpowers/**`, and `tests/**` for the new marketing tests. NOTHING under `app/host/**`, `app/(host)/**`, `app/(player)/**`, `app/tv/**`, `app/api/**`, `lib/**`, or `supabase/**` may be modified. Task 0 enforces this mechanically.

---

## File Structure

**New files:**
- `components/marketing/ThemedSection.tsx` — server component; wraps children in a section that applies one theme's CSS vars inline + a `data-theme` attr + `data-ys-section` marker for the client island.
- `components/marketing/themeVars.ts` — pure helper: `themeVars(key): React.CSSProperties` mapping a `ThemeKey` to the inline CSS-var object (reads `TR1VIA_THEMES` + `resolveTheme`, both read-only).
- `components/marketing/YearScroll.tsx` — `"use client"` island; IntersectionObserver that marks the active section for cross-fade + ambient motion; no-ops under reduced-motion / no-JS.
- `components/marketing/TheMoment.tsx` — the anti-cheat centerpiece (TV + 3 phones, answers shuffled per phone).
- `components/marketing/SegmentCues.tsx` — the venue/night/group strip.
- `components/marketing/Proof.tsx` — anonymized real-quote + honest-signal block (quote behind a flag until Heather's words arrive).
- `components/marketing/Pricing.tsx` — shared free-vs-AI block used inline on the hub and on `/pricing`.
- `components/marketing/Faq.tsx` — objection-killing FAQ (used on `/pricing`).
- `app/(marketing)/pricing/page.tsx` — the `/pricing` route.
- `tests/unit/marketing/themeVars.test.ts`
- `tests/unit/marketing/ThemedSection.test.tsx`
- `tests/unit/marketing/Proof.test.tsx`
- `tests/unit/marketing/seo-and-scope.test.ts` — asserts SEO presence + the scope guard.

**Modified files:**
- `app/(marketing)/trivia-night/page.tsx` — reassembled from the new section components, wrapped in `ThemedSection`s + the `YearScroll` island.
- `app/(marketing)/themes/page.tsx` — light polish to match (no structural change).

**Read-only (consumed, never edited):**
- `lib/theme/tokens.ts`, `lib/theme/resolve.ts`, `lib/theme/resolveTheme.ts`, `components/system/**`, `app/themes.generated.css`.

---

## Phase A — Figma design (visual source of truth)

> No code. Output: approved comps that the build phases implement. Brandon reviews at each ★ gate.

### Task A1: Pull the real palettes + design tokens into Figma

**Deliverable:** a Figma file "TR1VIA — Marketing" containing a styles/tokens page with all 12 month palettes (paper/ink/accent/pop) from `lib/theme/tokens.ts`, the daylight base, and the type styles (`Display`, `Eyebrow` sizes) used in `components/system`.

- [ ] **Step 1:** Read the exact hex values from `lib/theme/tokens.ts` (already in spec §5) and the derived tokens by running `npx tsx -e "import('./lib/theme/resolve.ts').then(m=>console.log(m.resolveTheme('june')))"` for a representative dark + light theme.
- [ ] **Step 2:** Using the figma-generate-library skill, create the tokens page (12 palettes + daylight + type scale). Verify each swatch matches the hex in `tokens.ts`.
- [ ] **★ GATE A1:** Brandon confirms the palette page reads the product's real colors.

### Task A2: Three hero art-directions of "The Year Scroll"

**Deliverable:** 3 distinct hero frames, each showing the hero wearing the **current month (June)** palette, exploring how the 12-theme tour is signaled (e.g. a peek of the next month's color at the fold, a vertical "month rail," an ambient-motif treatment).

- [ ] **Step 1:** Using figma-generate-design, build 3 hero frames (desktop + mobile each) on the June palette, with the locked headline "Everybody plays solo. / Nobody can cheat." and dual CTA.
- [ ] **★ GATE A2:** Brandon picks ONE hero direction (or a blend). Record the choice in the Figma file.

### Task A3: Full comps of every hub section + /pricing + /themes polish

**Deliverable:** full-page Figma comps (desktop + mobile) for the entire hub spine (spec §7), each section shown in its assigned month's palette (the section→month map below), plus `/pricing` and the polished `/themes`.

Section→month map (atmosphere tours the calendar; content order fixed):

| # | Section | Month palette |
| --- | --- | --- |
| 2 | Hero | **current month** (June now) |
| 3 | The Moment | July · 4th |
| 4 | How it works | August · Late Sun |
| 5 | Segment cues | October · Halloween |
| 6 | Why it's different | December · Christmas |
| 7 | Theme showcase | January · Ice → (cycles) |
| 8 | Proof | April · Spring |
| 9 | Pricing | June · Summer (returns home) |
| 10 | Final CTA | current month (bookend) |

- [ ] **Step 1:** Build each section comp on its mapped palette per the chosen hero direction.
- [ ] **Step 2:** Build `/pricing` (free-vs-AI + FAQ) and the polished `/themes`.
- [ ] **★ GATE A3:** Brandon approves the full comp set. These comps are the visual acceptance criteria for Phases B–E.

---

## Phase B — Build infrastructure (the Heather-safe theming engine)

### Task 0: Lock the scope guard FIRST

**Files:**
- Test: `tests/unit/marketing/seo-and-scope.test.ts`

- [ ] **Step 1: Write the scope-guard test**

```ts
import { execSync } from "node:child_process";
import { describe, it, expect } from "vitest";

// The marketing pass must never touch the live host/player/TV/API/DB surface.
// This test fails loudly if any staged/working change escapes the allowed dirs.
const ALLOWED = [
  /^app\/\(marketing\)\//,
  /^app\/page\.tsx$/,
  /^components\/marketing\//,
  /^docs\/superpowers\//,
  /^tests\/unit\/marketing\//,
  /^app\/globals\.css$/, // only if a marketing-only utility is added; see note
];

describe("marketing pass scope guard", () => {
  it("touches only marketing-safe paths", () => {
    const out = execSync("git diff --name-only HEAD", { encoding: "utf8" });
    const changed = out.split("\n").map((s) => s.trim()).filter(Boolean);
    const escaped = changed.filter((f) => !ALLOWED.some((re) => re.test(f)));
    expect(escaped, `These files are outside the marketing scope: ${escaped.join(", ")}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run tests/unit/marketing/seo-and-scope.test.ts`. Expected: PASS now (no out-of-scope changes yet). This test is the canary for the whole pass.
- [ ] **Step 3: Commit** — `git add tests/unit/marketing/seo-and-scope.test.ts && git commit -m "test(marketing): scope guard — marketing pass touches only marketing files"`

> Note: prefer NOT to touch `app/globals.css`. The `globals.css` entry exists only as an escape hatch for a marketing-only utility class; if unused, remove it from `ALLOWED` before the final PR.

### Task 1: `themeVars` — map a ThemeKey to inline CSS vars

**Files:**
- Create: `components/marketing/themeVars.ts`
- Test: `tests/unit/marketing/themeVars.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { themeVars } from "@/components/marketing/themeVars";
import { TR1VIA_THEMES } from "@/lib/theme/tokens";

describe("themeVars", () => {
  it("maps a theme's core palette to CSS custom properties", () => {
    const v = themeVars("june");
    expect(v["--paper"]).toBe(TR1VIA_THEMES.june.paper);
    expect(v["--ink"]).toBe(TR1VIA_THEMES.june.ink);
    expect(v["--accent"]).toBe(TR1VIA_THEMES.june.accent);
  });

  it("includes derived tokens (surface, ink-mid, line) so sections are self-sufficient", () => {
    const v = themeVars("october");
    expect(v["--surface"]).toBeTruthy();
    expect(v["--ink-mid"]).toBeTruthy();
    expect(v["--line"]).toBeTruthy();
  });

  it("sets color-scheme so form controls/scrollbars match the section mode", () => {
    expect(themeVars("october").colorScheme).toBe("dark");
    expect(themeVars("june").colorScheme).toBe("light");
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run tests/unit/marketing/themeVars.test.ts`. Expected: FAIL ("Cannot find module … themeVars").

- [ ] **Step 3: Implement**

```ts
// components/marketing/themeVars.ts
//
// Map a ThemeKey -> the inline CSS-var object a marketing section needs to
// fully paint itself in that month's palette. READ-ONLY consumer of the theme
// system: it imports the token table + the pure `resolveTheme` derivation and
// never mutates global theme state, so nothing the host/player/TV renders is
// affected (the marketing pass is isolated by construction).
import type { CSSProperties } from "react";
import { TR1VIA_THEMES, type ThemeKey } from "@/lib/theme/tokens";
import { resolveTheme } from "@/lib/theme/resolve";

export function themeVars(key: ThemeKey): CSSProperties {
  const def = TR1VIA_THEMES[key];
  const r = resolveTheme(key);
  return {
    ["--paper" as string]: def.paper,
    ["--ink" as string]: def.ink,
    ["--accent" as string]: def.accent,
    ["--pop" as string]: def.pop,
    ["--correct" as string]: def.correct,
    ["--wrong" as string]: def.wrong,
    ["--surface" as string]: r.surface,
    ["--surface-h" as string]: r.surfaceH,
    ["--ink-mid" as string]: r.inkMid,
    ["--ink-mute" as string]: r.inkMute,
    ["--line" as string]: r.line,
    ["--line-soft" as string]: r.lineSoft,
    colorScheme: def.mode,
  };
}
```

> Verify `resolve.ts` exports `resolveTheme(key)` returning `{ surface, surfaceH, inkMid, inkMute, line, lineSoft }` (confirmed from `lib/theme/__build__.ts`). If the property names differ, match them exactly — do not rename anything in `lib`.

- [ ] **Step 4: Run it** — `npx vitest run tests/unit/marketing/themeVars.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add components/marketing/themeVars.ts tests/unit/marketing/themeVars.test.ts && git commit -m "feat(marketing): themeVars — inline per-section palette from the real theme tokens"`

### Task 2: `ThemedSection` — a server-rendered, self-theming section

**Files:**
- Create: `components/marketing/ThemedSection.tsx`
- Test: `tests/unit/marketing/ThemedSection.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ThemedSection } from "@/components/marketing/ThemedSection";
import { TR1VIA_THEMES } from "@/lib/theme/tokens";

describe("ThemedSection", () => {
  it("applies the theme's paper as background via inline var (no-JS readable)", () => {
    const { container } = render(
      <ThemedSection themeKey="october" id="why">content</ThemedSection>,
    );
    const section = container.querySelector("section")!;
    expect(section.style.getPropertyValue("--paper")).toBe(TR1VIA_THEMES.october.paper);
    expect(section.getAttribute("data-theme")).toBe("october");
    expect(section.getAttribute("data-ys-section")).toBe("october"); // hook for YearScroll island
  });

  it("renders its children", () => {
    const { getByText } = render(<ThemedSection themeKey="june">hello</ThemedSection>);
    expect(getByText("hello")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it** — Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```tsx
// components/marketing/ThemedSection.tsx
//
// A server-rendered section that fully paints itself in one month's palette by
// setting the theme CSS vars INLINE (via themeVars). Because the vars are in the
// static HTML, the section is themed + readable with zero client JS — the
// "Year Scroll" tour exists even for crawlers and no-JS visitors. The client
// `YearScroll` island only adds cross-fades + ambient motion on top, keyed off
// `data-ys-section`.
import type { ReactNode } from "react";
import type { ThemeKey } from "@/lib/theme/tokens";
import { themeVars } from "./themeVars";

export function ThemedSection({
  themeKey,
  id,
  className = "",
  children,
}: {
  themeKey: ThemeKey;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-theme={themeKey}
      data-ys-section={themeKey}
      className={`relative isolate ${className}`}
      style={{ ...themeVars(themeKey), background: "var(--paper)", color: "var(--ink)" }}
    >
      {children}
    </section>
  );
}
```

- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add components/marketing/ThemedSection.tsx tests/unit/marketing/ThemedSection.test.tsx && git commit -m "feat(marketing): ThemedSection — SSR self-theming section (no-JS readable)"`

### Task 3: `YearScroll` client island (progressive enhancement)

**Files:**
- Create: `components/marketing/YearScroll.tsx`

> Visual/behavioral, low unit-test value; verified in the browser (Task V2). Keep it strictly additive.

- [ ] **Step 1: Implement the island**

```tsx
// components/marketing/YearScroll.tsx
"use client";
//
// PROGRESSIVE ENHANCEMENT ONLY. The page is already fully themed + readable from
// the server (ThemedSection sets palettes inline). This island watches which
// section is in view and (a) cross-fades a top-level accent glow and (b) toggles
// ambient motion. If JS never loads, or prefers-reduced-motion is set, the page
// is unchanged and fully functional. It mutates only its own overlay + a
// data-attr on <html data-ys-active>; it never touches app theme state.
import { useEffect } from "react";

export function YearScroll() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-ys-section]"));
    if (!sections.length) return;
    const root = document.documentElement;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!top) return;
        const key = (top.target as HTMLElement).dataset.ysSection!;
        root.dataset.ysActive = key; // an overlay can read this for an accent wash
        if (!reduce) root.dataset.ysMotion = "on";
      },
      { threshold: [0.25, 0.5, 0.75] },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);
  return null;
}
```

- [ ] **Step 2: Commit** — `git add components/marketing/YearScroll.tsx && git commit -m "feat(marketing): YearScroll island — scroll-driven theme tour as progressive enhancement"`

---

## Phase C — Build the hub sections (per approved Figma comps)

> Each task implements one comp from GATE A3. Carry over existing copy verbatim where the current page already has it (cited). New copy is given inline below. Exact layout/spacing comes from the approved comp; these tasks fix structure, copy, theming, and verification.

### Task 4: The Moment (anti-cheat centerpiece)

**Files:**
- Create: `components/marketing/TheMoment.tsx`

**Copy (new):** headline "Calling out the answer helps no one." · sub "Every phone shuffles the four answers into its own order. One question on the screen, four different layouts in four hands — so 'it's number three!' means nothing." · visual: a TV tile showing Q + 4 options, and 3 phone tiles each showing the SAME 4 options in a visibly different order, one highlighted as the correct one in each.

- [ ] **Step 1:** Build `TheMoment` as a server component matching the GATE A3 comp; the shuffled-order proof is real markup (3 hardcoded distinct permutations), not an image.
- [ ] **Step 2: Verify** — render in `npm run dev -- -p 3030`, confirm the three phones show different orderings and it reads on mobile. Screenshot for Brandon.
- [ ] **Step 3: Commit** — `git commit -m "feat(marketing): The Moment — visual proof of per-phone answer shuffle"`

### Task 5: Segment cues (venue / night / group)

**Files:**
- Create: `components/marketing/SegmentCues.tsx`

**Copy (new):** eyebrow "WHATEVER YOUR ROOM IS" · three cards: **For your venue** — "Fill the slow nights. Regulars come back for the next one." · **For your night** — "Look pro with zero prep — TR1VIA writes the questions and runs the clock." · **For your group** — "Office, club, or kitchen table. Free, fair, no app to download."

- [ ] **Step 1:** Build `SegmentCues` to the comp. **Step 2:** dev-verify + screenshot. **Step 3:** commit `feat(marketing): segment cues strip (venue/night/group)`.

### Task 6: Pricing block (shared) + extract reusable pieces

**Files:**
- Create: `components/marketing/Pricing.tsx`

**Copy:** carry over the existing free-vs-AI copy from `app/(marketing)/trivia-night/page.tsx:255-270` verbatim ("Free forever to host." + the $4.99 line).

- [ ] **Step 1:** Build `Pricing` as a server component reusable on hub + `/pricing`. **Step 2:** dev-verify. **Step 3:** commit `feat(marketing): shared Pricing block`.

### Task 7: Reassemble the hub from ThemedSections

**Files:**
- Modify: `app/(marketing)/trivia-night/page.tsx`

- [ ] **Step 1:** Keep the entire `metadata`, `JSON_LD`, header, and footer EXACTLY as-is (SEO must not change — spec §2). Wrap each content beat (spec §7) in a `ThemedSection` with the mapped `themeKey` (Task A3 table). Carry over existing Step/Differentiator/Hero/ThemeShowcase/Final-CTA copy verbatim (cited lines: hero `:153-195`, steps `:198-224`, differentiators `:226-249`, showcase `:252`, final CTA `:272-286`). Insert `TheMoment` after the hero, `SegmentCues` after how-it-works, `Pricing` before the final CTA, and `Proof` (Task 8) before pricing.
- [ ] **Step 2:** Mount `<YearScroll />` once near the end of `<main>`.
- [ ] **Step 3: Verify SEO unchanged** (Task V1) and **scope guard** (`npx vitest run tests/unit/marketing/seo-and-scope.test.ts`).
- [ ] **Step 4: Commit** — `feat(marketing): hub reassembled as the Year Scroll`.

---

## Phase D — /pricing + /themes

### Task 8 (Proof): honest, anonymized, flag-gated

**Files:**
- Create: `components/marketing/Proof.tsx`
- Test: `tests/unit/marketing/Proof.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Proof } from "@/components/marketing/Proof";

describe("Proof", () => {
  it("never renders a quote unless a real one is provided (no fabrication)", () => {
    const { queryByTestId } = render(<Proof quote={null} />);
    expect(queryByTestId("proof-quote")).toBeNull(); // honest signal only
  });
  it("renders the real quote with anonymous attribution when provided", () => {
    const { getByTestId } = render(
      <Proof quote={{ text: "My Tuesdays are packed now.", attribution: "a host running TR1VIA weekly" }} />,
    );
    expect(getByTestId("proof-quote").textContent).toContain("My Tuesdays are packed now.");
    expect(getByTestId("proof-quote").textContent).not.toMatch(/Heather/i); // never the real name
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3:** Implement `Proof` so `quote` is an optional prop; with `null` it renders only honest signal ("live trivia nights running weekly", the anti-cheat guarantee, free-forever); with a quote it renders `data-testid="proof-quote"` + the anonymous attribution. The hub passes `quote={null}` until Brandon supplies Heather's real words. **Step 4: Run** — PASS. **Step 5:** commit `feat(marketing): Proof — honest signal now, real anonymized quote when available`.

### Task 9: `/pricing` page + FAQ

**Files:**
- Create: `app/(marketing)/pricing/page.tsx`, `components/marketing/Faq.tsx`

**FAQ copy (new):**
- *Is it really free to host?* "Yes — unlimited games, unlimited players, no per-night fee. The only paid thing is optional AI question-writing at $4.99/month, cancel anytime."
- *Do players need to download an app?* "No. They scan a code on the screen and play in their phone's browser. No install, no sign-up."
- *What gear do I need?* "A laptop to drive the venue TV and the phones already in everyone's pockets. No buzzers, no hardware."
- *Can I write my own questions?* "Always. Type your own, or let TR1VIA write a whole category for you."
- *Can people cheat?* "No — every phone shuffles the four answers into its own order, so calling out 'number three' means nothing."

- [ ] **Step 1:** Build `Faq` + the `/pricing` page (full `metadata`, canonical `https://tr1via.com/pricing`, JSON-LD `FAQPage`, the shared `Pricing` block, the `Faq`). Mirror the server-component pattern of `app/(marketing)/themes/page.tsx`.
- [ ] **Step 2: Verify** SEO present (curl + grep, Task V1 pattern) + scope guard. **Step 3:** commit `feat(marketing): /pricing page with FAQ + FAQPage structured data`.

### Task 10: `/themes` polish

**Files:**
- Modify: `app/(marketing)/themes/page.tsx`

- [ ] **Step 1:** Apply only the visual polish from the GATE A3 comp (spacing/headers) — NO structural or `ThemeShowcase` change. **Step 2:** dev-verify + scope guard. **Step 3:** commit `chore(marketing): polish /themes to match the refreshed hub`.

---

## Phase E — Verification & ship

### Task V1: SEO + no-JS baseline regression test

**Files:**
- Modify: `tests/unit/marketing/seo-and-scope.test.ts`

- [ ] **Step 1:** Add assertions that the rendered hub HTML still contains: the `<h1>`/Display headline text, the `application/ld+json` block with `"@type":"SoftwareApplication"`, the canonical `https://tr1via.com/trivia-night`, and the description string. Drive it by building + curling, or by importing the page's exported `metadata` and asserting fields. Expected: PASS (SEO unchanged).
- [ ] **Step 2: Commit** — `test(marketing): lock SEO fields + canonical against regression`.

### Task V2: Manual browser verification (the craft check)

- [ ] **Step 1:** `npm run dev -- -p 3030`; load `/trivia-night`. Confirm: (a) sections visibly change palette as you scroll (the tour); (b) copy is legible in every section; (c) the dual CTA reaches `/login` and `/join`; (d) mobile layout holds.
- [ ] **Step 2:** DevTools → disable JS → reload. Confirm the page is fully readable and still themed per section (no-JS baseline). Re-enable.
- [ ] **Step 3:** DevTools → Rendering → emulate `prefers-reduced-motion: reduce`. Confirm ambient motion stops; palettes still switch.
- [ ] **Step 4:** Screenshot desktop + mobile + a dark section for Brandon.

### Task V3: Final guardrail + typecheck + tests, then PR

- [ ] **Step 1: Scope guard** — `npx vitest run tests/unit/marketing/seo-and-scope.test.ts` → PASS (only marketing files changed).
- [ ] **Step 2: Unit tests** — `npx vitest run tests/unit/marketing` → all PASS.
- [ ] **Step 3: Typecheck the changed files** — `npx tsc --noEmit` (note: a pre-existing unrelated failure in `tests/unit/HostHomeClient-founder-build.test.tsx` is known per HANDOFF; confirm no NEW errors in marketing files). Lint changed files with `npx eslint app/\(marketing\) components/marketing` (repo-wide `next lint` is broken — HANDOFF).
- [ ] **Step 4: Build** — `npm run build` → succeeds.
- [ ] **Step 5: Open PR** to `main` (Brandon merges; never push to `main` directly). PR body lists the Heather-safe guarantee + the `git diff --name-only` proof that only marketing files changed.

---

## Open items / blocking
- **Heather's real quote** blocks ONLY the Proof quote (Task 8 ships honest-signal-only until then). Everything else proceeds.
- **Section→month map** (Task A3 table) is the current proposal; finalize visually at GATE A3.

## Self-review notes
- Spec §2 (Heather-safe) → Task 0 + V3 scope guard. Spec §3 (segments) → Task 5. Spec §5 (Year Scroll + SSR-first + reduced-motion) → Tasks 1–3, V2. Spec §6 (honest proof) → Task 8. Spec §7 (spine) → Tasks 4–7. Spec §4 (/pricing, /themes) → Tasks 9–10. Spec §10 (verification) → V1–V3. All spec sections have a task.
