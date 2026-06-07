# TASK: June "Endless Evening" theme — implement the plan

Re-plans: 0/3

**Phase:** planning DONE → implementation NEXT (fresh session). Brandon chose **subagent-driven execution** (one fresh subagent per task, review the diff between each).

## Start here (next session)
1. Read `docs/superpowers/specs/2026-05-31-june-endless-evening-design.md` (the approved design).
2. Read `docs/superpowers/plans/2026-05-31-june-endless-evening.md` (8 TDD tasks, verified anchors).
3. Invoke **superpowers:subagent-driven-development** and execute the plan task-by-task.
4. Branch is already `june-endless-evening` (off `staging`); spec + plan already committed there. PR-first into `staging` — Brandon merges. Never `main`.

## What it is (one line)
Replace June's flat static gradient with a living, sky-led summer-evening atmosphere (warm drifting sky + thin cool water shimmer) that reacts to lock-in (sky warms) and reveal (horizon swells + soft bloom) with light only — no objects. TV-only. Honors reduced-motion.

## Scope fence (decided with Brandon)
- **June theme ONLY.** Not the other 11 months. Not the 4 app-wide audit moments. No game-logic change.
- Feel = "atmosphere only" (no literal objects/characters), brightness follows season, **sky-led** weighting.

## Two flags to show Brandon at PR time (from plan self-review)
- Reveal bloom is centered atmosphere, NOT pixel-locked behind the answer card (locking it would couple the sky to TVReveal internals — avoided on purpose).
- "Motion quiets while reading" is honored by NOT adding question-screen motion; if Brandon wants the drift to actively slow during a question, that's a small follow-up.

## Validation gate (Task 8 — required before PR ready)
- `npx tsc --noEmit && npx vitest run` green (ESLint is known-broken — do NOT gate on `npm run lint`).
- `SMOKE_THEME_SINGLE=june node --env-file=.env.local scripts/full-flow-prod.mjs > /tmp/june.log 2>&1; echo exit=$?` → exit=0, and `grep -iE "GREEN|RED|FAIL" /tmp/june.log` shows GREEN (don't pipe through `tee`).
- Real-route `/tv/[code]` prod screenshots: resting / lock-in / reveal (use a `@tr1via.test` host, not founder).

## Status
- Audit → ranked moments → Brandon greenlit → scope narrowed to June → visual brainstorm (sky-led "Endless Evening") → spec → plan. ALL DONE.
- Context cleared here on purpose; resume from the plan.

**Skipped/Failed:** None.

---

# TASK: Marketing polish — root→marketing redirect, player entry, monthly-theme showcase

Branch `worktree-marketing-root-themes` off `origin/main` d3d7709. Re-plans: 0/3. Brandon-approved 2026-06-07.

## What shipped
- [x] **Root redirect.** `app/page.tsx` (was a 207-line client room-code form) → server component
      `redirect("/trivia-night")` (307). Verified live: `GET / → 307 → /trivia-night`.
- [x] **Player entry preserved.** Did NOT migrate the old root form (Simplicity First): the existing
      `/join` no-code screen is already phone-native + has a scan-QR hint, so it's the better home. Repointed
      marketing's "Got a code? Join a game" CTA `/` → `/join` (was an infinite-loop after the redirect) and
      the logo `/` → `/trivia-night`.
- [x] **Theme showcase (one component, two contexts).** `components/marketing/ThemeShowcase.tsx` — server
      component, renders the 12 monthly themes as mini in-product cards painted from the registry via
      `resolveTheme(key)` (zero duplicated colors), each with its signature SVG motif. `variant="teaser"`
      (horizontal strip on /trivia-night) + `variant="full"` (grid). CSS-only motion in globals.css.
- [x] **`/themes` gallery page** — `app/(marketing)/themes/page.tsx`, server-rendered, SEO metadata, links
      back to the pitch.
- [x] **Tests:** updated `trivia-night-marketing` (join CTA → /join); added `root-redirect`,
      `theme-showcase` (all 12 months render in their OWN palettes, not daylight's), `themes-page`.
- [x] **Critic pass (fixed):** caught a keyframe-name collision — my `tr1via-float` was overriding the
      existing one used by `TVLobbyTopics` (−4px→−7px). Renamed mine to `tr1via-showcase-float`. Also fixed a
      stale header comment + removed the now-dead `home` e2e selector.

## Review
- Verified by: full unit suite **585 passed / 8 skipped / 0 failed** (92 files); changed files tsc + eslint
  clean; Playwright screenshots of `/` (redirects), `/join`, `/trivia-night` teaser, `/themes` all HTTP 200
  and visually confirmed (sent to Brandon).
- Engineering calls: Figma skipped for code-first (design system lives in code → higher fidelity; can mirror
  to Figma after). No parallel subagents — remaining steps were sequential (card → teaser/gallery). Root
  redirect is 307 (temporary) to keep the apex flexible.

## Skipped/Failed
- Pre-existing tsc error in `tests/unit/HostHomeClient-founder-build.test.tsx` (stale props from #80, NOT
  this diff, passes at runtime) — left untouched (out of scope). Flagged to Brandon.
