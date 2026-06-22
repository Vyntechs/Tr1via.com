# Public-site monthly theming — design spec

- **Date:** 2026-06-22
- **Status:** Approved (design); plan + build pending
- **Owner gate:** Deploy is Brandon's call only (prod, real users, never during a Wednesday show).
- **Branch:** build on a fresh branch off `origin/main` (source of truth), NOT the in-flight `fix/rls-correct-index-leak`.

## Problem / intent

The themes are beautiful and already rotate by calendar month **inside a live game and on host setup/dashboard surfaces**. But the **public-facing pages** — landing/marketing, the player `/join` screen, host `/login` — are pinned to one neutral "daylight" look. A first-time visitor never feels the season change. Brandon's intent: when someone hits any public page, it should wear **whatever month it actually is** — so the site auto-flips to the "July · 4th" look on July 1 with zero effort, and rotates forever after.

## Decisions locked (from brainstorm)

1. **Reach = every public page.** Landing, all marketing pages, player `/join`, and host `/login` follow the current month. A live game still follows the host's pick.
2. **Keep the variety showcase.** The pricing page and `/themes` gallery keep showing several month-looks side by side as a sales pitch. (This is automatic — see Mechanism.)

## Why this is small

`resolveTheme(night, host, now)` already exists and, called as `resolveTheme(null, null)`, returns the **current month's** `ThemeKey` (layer 3 of its fallback chain — `lib/theme/resolveTheme.ts:119-134`). The only thing pinning the public site to daylight is two literals in **one file**:

- `app/layout.tsx:42` — `<html ... data-theme="daylight">`
- `app/layout.tsx:47` — `<ThemeProvider themeKey="daylight">`

Everything else stays as-is. Game/host/player surfaces each mount their own `ThemeProvider` (`app/host/layout.tsx`, `app/(player)/room/[code]/page.tsx`), whose client effect re-sets `data-theme` on mount — so they **override the root**; changing the root cannot alter a live game's palette. Showcase sections paint themselves with inline CSS vars via `ThemedSection`/`themeVars`, and inline styles beat the `:root[data-theme=…]` cascade — so the multi-theme pitch survives unchanged for free.

## Mechanism (the design)

Three layers, smallest-change-first:

1. **Server default = current month.** In `app/layout.tsx` (a sync server component today), resolve `const themeKey = resolveTheme(null, null)` and use it for both `<html data-theme={themeKey}>` and `<ThemeProvider themeKey={themeKey}>`. This makes a *freshly rendered* page correct and gives crawlers/no-JS a correct theme in the HTML.

2. **No-FOUC, cache-immune correction (the real fix for the boundary problem).** Add a tiny **blocking inline script** in `<head>` that derives the current month from the **client clock** and sets `document.documentElement.dataset.theme` **before first paint**. This is the standard no-flash theme pattern (the root already carries `suppressHydrationWarning` on `<html>`, line 44, so a stale-SSR-vs-fresh-client mismatch is expected and silent). Rationale: marketing pages are statically cached; a page **built in June and cached would otherwise serve June into July**. The script reads the real date at view time, so the flip is always correct regardless of cache age, with no visible flash.
   - The script's month→theme map MUST stay in lockstep with `themeKeyForMonth` (`lib/theme/resolveTheme.ts:48-64`). A unit test asserts parity so they can't drift.

3. **Existing client effect (belt-and-suspenders).** `ThemeProvider`'s mount effect already sets `data-theme` from its prop; it remains consistent with the above.

**Alternative considered & rejected for the boundary problem:** `export const dynamic = 'force-dynamic'` / `revalidate` on the root layout. Rejected as the *primary* mechanism: route config on the root cascades app-wide and trades marketing static-perf/SEO for a problem the inline script solves with no perf cost and no flash. (Plan may still add a modest `revalidate` as defense-in-depth if TDD shows it's warranted — but the script is the contract.)

## Coverage matrix

| Surface | Today | After | How |
|---|---|---|---|
| Landing / marketing pages | daylight | current month | root default + script |
| Player `/join` | daylight | current month | inherits root |
| Host `/login` | daylight | current month | inherits root |
| Pricing page showcase sections | multi-theme (pinned) | **unchanged** | inline `themeVars` overrides root |
| `/themes` gallery cards | all 12 (pinned) | **unchanged**; page chrome follows month | inline vars per card |
| Live player room | night/host resolved | **unchanged** | own `ThemeProvider` overrides root |
| Host dashboard/setup | host resolved | **unchanged** | own `ThemeProvider` overrides root |
| TV `/tv/[code]` | hardcoded black | **unchanged** | no `ThemeProvider`, hardcoded `#000` |

## Risks & mitigations

- **Image/asset clash in dark months.** Some marketing hero images/screenshots may have been composed for the light daylight background and could look off on a dark month (July navy, October near-black). **Mitigation:** a verification pass renders every public page in **all 12 month palettes** and flags any clashing asset with a fix recommendation. None of these block the core wiring; they're polish surfaced for Brandon's call.
- **Hydration mismatch noise.** Handled — `<html suppressHydrationWarning>` is already present; the script pattern is the intended use.
- **Status-bar tint** (`viewport.themeColor` hardcoded `#1B130C`, `app/layout.tsx:35`) won't track the month. **Out of scope / optional polish**; note only.

## Out of scope

- TV display stays black (intentional).
- Game/host/player in-experience theming is untouched (already correct).
- No new themes, no palette edits, no DB/schema changes, no new routes.
- `viewport.themeColor` month-tinting (optional follow-up).

## Testing & verification

1. **Unit (TDD, deterministic via `now`):**
   - `resolveTheme(null, null, <date in month N>)` → the month-N theme, for representative months incl. a light month (June) and a dark month (July).
   - **Map-parity test:** the inline script's month→theme table equals `themeKeyForMonth` for all 12 months (guards drift).
2. **Keep green:** existing `tests/unit/marketing/seo-and-scope.tsx` (marketing import-scope) and the full `npm test` suite.
3. **Type-check:** `npx tsc --noEmit` (2 known pre-existing errors in `HostHomeClient-founder-build.test.tsx` are baseline noise).
4. **Visual verification (workflow, ultracode):** render each public page under all 12 month `data-theme` values; confirm (a) the page actually adopts the palette, (b) showcase pages still show multiple looks, (c) flag asset clashes. Spot-check the June→July boundary by forcing the client date.
5. **Done = ** wiring verified green + a screenshot/preview set across the seasons handed to Brandon, with any flagged asset issues listed. **No deploy** — Brandon holds the go/no-go.

## Definition of done

- One file (`app/layout.tsx`) + one tiny script/helper changed; public pages follow the live month; game/host/player/TV/showcase all provably unchanged; tests + types green; verified preview + risk list delivered for Brandon's deploy gate.
