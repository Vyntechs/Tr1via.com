# TR1VIA — Handoff (session 33, 2026-05-31 — June theme planned, ready to build)

**Next session, read in order: this → `MEMORY.md` (auto-loaded) → `CLAUDE.md` → grep `tasks/lessons.md` → `tasks/todo.md` → the June plan.**

---

## ⭐ NEXT SESSION — implement the June theme plan (subagent-driven)

The creative phase is done. We brainstormed June into a finished, approved design and a full TDD implementation plan. Next session just **builds it**.

1. `docs/superpowers/specs/2026-05-31-june-endless-evening-design.md` — approved design.
2. `docs/superpowers/plans/2026-05-31-june-endless-evening.md` — 8 TDD tasks, verified code anchors.
3. Invoke **superpowers:subagent-driven-development** (Brandon's chosen execution mode) and work task-by-task, reviewing the diff between each.
4. Branch **`june-endless-evening`** (off `staging`) already exists with spec + plan committed. PR-first into `staging`; **Brandon merges. Never push to `main`.**

**June "Endless Evening" in one line:** a living, sky-led summer-evening atmosphere (warm drifting sky + thin cool water shimmer) that reacts to lock-in (sky warms) and reveal (horizon swells + soft bloom) with light only — no objects. TV-only, honors reduced-motion. Scope is **June only** — not the other 11 months, not the app-wide audit moments, no game-logic change.

---

## How we got here (context, since this session clears)

Brandon's task was "raise perceived production quality — make it feel like a big, well-funded team built it; experience only, no features," with a strict anti-generic-AI rubric. We:
- Ran a feel-audit workflow → app already feels crafted; the gap is hard-cut seams + a silent reveal.
- Brandon greenlit 4 moments + all 12 themes, then **narrowed to June only** ("we won't need most of those for a while").
- Visual-companion brainstorm landed on **"Endless Evening" — sky-led**, atmosphere only (he rejected the porch/string-lights/fireflies concept as too literal; the artist move = "one light, two media": warm sky + its cool reflection on water).

## Workflow state
- On branch **`june-endless-evening`** (off `staging` @ `ae66063`). NOT pushed yet. `staging` was briefly ahead by my spec commit; I moved it to the feature branch and reset `staging` to match `origin/staging`.
- PR #64 (`tv-join-topics-preview` → `staging`) from last session is still open, awaiting Brandon's merge. Unrelated to June.

## Correction logged this session
- I repeated a stale "`/tv/[code]` is crashing" blocker from the OLD todo without checking prod — Brandon confirmed prod works. Logged as lesson `stale-blocker-from-old-todo`. Re-verify prod before repeating old blockers.

## Carry-over backlog (don't bundle into June unless asked)
0. Dedicated `@tr1via.test` host for `full-flow-prod.mjs` (don't collide with founder dashboard).
1. "Molds" ghost category — G2 6th category stuck in `review`.
2. #58 freeze watchdog — still needs a live-show sleep/wake test.
3. Migration bookkeeping — `supabase/migrations/0010_fix_game_scores_per_game_filter.sql`.
4. Pre-merge CI gate — prod smoke is push-to-main-only.
5. The other 11 monthly themes + the 4 app-wide audit moments (deferred; audit lives in workflow wf_7ca9111a-283 result if revisited).

## Reference
- Prod Supabase project id `citweuctcnuxmqjxcbiz`. Debug: `vercel logs --no-branch --since 1d --query "<term>"` (Vercel MCP 403). Dev server: `npm run dev -- -p 3030`.
- June full-arc: `SMOKE_THEME_SINGLE=june node --env-file=.env.local scripts/full-flow-prod.mjs` (don't `tee` — masks exit code).
- ESLint can't run (pre-existing `@eslint/eslintrc` bug); `tsc` + vitest cover it.
- Uncommitted working-tree extras are intentional and persist: this `HANDOFF.md`, `tasks/*`, `.claude/` + `CLAUDE.md`, `docs/superpowers/*`, validation PNGs/scripts. The `.superpowers/` brainstorm output is gitignored.

**Skipped/Failed:** None — June planning complete; implementation is the next session's job.
