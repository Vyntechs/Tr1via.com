# Locked-screen live count + 30s answer timer — design

**Date:** 2026-06-07
**Branch:** `feat-locked-room-rank-30s` (off `origin/main`)
**Driver:** Brandon, mid-show validation on prod. Two asks + one investigation.

## Problem (Brandon's words)

1. A Video Games question's "correct answer" looked wrong.
2. Bump the answer timer **25 → 30s**, and make sure the ring animation doesn't "overlap for the additional seconds."
3. After a player answers, the phone is **static** — "doesn't show any new info." Capture their attention.

## What's actually on prod (verified, `origin/main`)

- The answer timer is **25s for every theme**, defined once in `lib/theme/lockInCeremony.ts` and read everywhere via `questionDurationFor()`. The arcs (`TimerRing`, `TVTimerArc`) are already **duration-relative** (`frac = seconds / resolvedMax`) — no hardcoded 25 in the sweep.
- The locked screen **already shows the full standings board** ("WHERE YOU STAND") — merged days ago. It only updates on reveal, so during the wait it's static = the "no new info" Brandon sees.
- The "21/32" lock count beside it is a **hardcoded placeholder** — `LockedView` never feeds `lockedSummary`, so it never moves.
- `GET /api/games/:id/locks` returns `{ locks: [...] }` for the live question — `locks.length` is the real live lock-in count. The TV already polls it every 3s.

## Decisions

- **Timer → 30s, all themes.** One source change; the arc scales itself. Visually verify the ring on TV + phone; only touch arc code if a real glitch appears (none expected). Speed-bonus window stays the first 5s.
- **Locked screen: keep the board, make it live.** Replace the fake "21/32" with a real, prominent **"X of Y locked in"** progress bar that fills as the room answers. Keep the standings board (the highlighted "you" row already conveys rank).

## Out of scope (separate track)

- The Video Games wrong answer. Today's played set all read factually correct on inspection (Pauline/Donkey Kong and The Skeld/Among Us are the "feels wrong but isn't" ones). The durable fix is the already-specced *Sonnet-writes / Opus-verifies* generation pipeline — not this PR.

## Build

### Part 1 — Timer 25 → 30
- `lib/theme/lockInCeremony.ts`: `DEFAULT_CONFIG.duration` and `may.duration` → 30; update the "25s" doc comments.
- Update stale comments in `lib/hooks/useTimer.ts`, `components/system/TimerRing.tsx`, `components/system/TVTimerArc.tsx`, `lib/ai/prompts.ts`, and the end-early route ("20s default, 25s May" → "30s every theme").
- The AI prompt text auto-updates (it interpolates `questionDurationFor()`).
- Tests (update 25 → 30): `ai-prompts-duration`, `room-page-duration`, `useTimer-theme`, `timer-rings-theme`, `lockInCeremony-theme`. Add a SYSTEM_PROMPT "does not contain '30 seconds'" guard (cache stability).

### Part 2 — Live lock-in count on the locked screen
- New hook `useLockCount(gameId, active)` — polls `GET /api/games/:id/locks` (~2s) while on the locked screen, returns `locks.length`. Poll-based on purpose (realtime is the weak spot on phones; the TV already polls this).
- `PlayerLocked` gains `lockedCount?: number` + `totalPlayers?: number`. Renders a prominent **"X of Y locked in"** bar (fill = count/total) where the placeholder "21/32" was. Board + speed-bonus line unchanged. Backward compatible: props omitted → no bar (gallery/demo).
- `LockedView` wires it: `useLockCount` for the numerator, `snapshot` participant count for the denominator (`game_scores` rows, fallback room players), pass both down.
- Dev gallery `app/dev/player/page.tsx`: Locked frame shows the live count.

### Tests (TDD)
- `player-locked-live-count.test.tsx`: bar renders "X of Y", fill scales with count, omitted props → no bar.
- `useLockCount` logic (poll → count) — light unit test.
- All 5 duration tests updated to 30 and green.

## Validation before PR (self, on branch — touches zero prod data)
- Unit suite green (updated + new tests).
- `next lint` + `next build` clean.
- Drive the **real phone + TV** locally: watch the 30s ring deplete cleanly (no overlap/lap) and the count bar fill as locks come in. Screenshot both.
- `scripts/full-flow-prod.mjs` (state-machine gate) — run when Brandon is off prod (founder-login collision), before marking PR ready.

PR to `main`; Brandon validates + merges.
