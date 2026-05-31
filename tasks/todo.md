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
