# July Pyrotechnics — Phase 3 Report (2026-06-18)

**Status:** Built + verified on branch `fix/rls-correct-index-leak`. **NOT merged / NOT deployed** (founder's call; never during a live show).

## What shipped (commits on the branch)
Earned, synchronized, per-question fireworks on player phones + a player-requested standings view, riding the existing Phase-2 beat. Transport + client only — **no migration, no new per-client Supabase reads.**

- `feat(july): ±4 standings neighborhood builder` — `lib/player/standings.ts`
- `feat(july): resolve-summary + social-line copy` — `lib/player/celebrationCopy.ts`
- `feat(july): playerWasCorrect + correct-only beat gate` — `lib/game/revealOutcome.ts`
- `perf(july): phone particle/DPR budget for the firework engine (TV unchanged)` — `components/system/Pyrotechnics.tsx`
- `feat(july): ±4 standings-neighborhood screen` — `components/player/PlayerStandingsNeighborhood.tsx`
- `feat(july): 'N of M got this one' awareness line on wrong reveal`
- `feat(july): 'You + N others nailed it' social line on correct reveal`
- `feat(july): dark→bright correct-reveal sequence + barrel exports` — `PlayerRevealCorrectSequence.tsx`
- `feat(july): wire phones — gated beat, dark→bright reveal, ±4 standings beat` — `app/(player)/room/[code]/page.tsx`
- `refactor(july): derive social counts from the resolve broadcast in render; key RevealView by question` (lint/render-safety)
- `fix(july): bind the salvo to its questionId so it fires only for THAT question's correct players` (adversarial-review fix)

## Design (locked with Brandon, in Figma)
- Fireworks are **earned** — correct players only; a burst on your phone *means* you got it right.
- Correct player: **dark fireworks → bright payoff** (cinematic; fireworks read on the dark sky, not the bright lime takeover).
- **Count-only** social lines both directions.
- **±4 standings** as a 3rd reveal beat, after the celebration, never overlapping the fireworks.
- **Finale** at game end is whole-room (not gated).
- Figma: https://www.figma.com/design/lANVldTnzvKmxPv1kmQzZg

## Verification
- **vitest:** 804 passed / 8 skipped (133 files), exit 0. New unit tests: neighborhood edges (mid/top/bottom/absent), correct-only gate + questionId binding (incl. the cross-question race), social-copy phrasing, phone budget (TV-unchanged invariant), dark→bright sequence transition, the social/awareness lines.
- **tsc:** clean except the 2 known pre-existing `HostHomeClient-founder-build.test.tsx` errors.
- **eslint:** `npm run lint` is project-broken (Next 16 removed `next lint`); ran eslint directly — **0 new problems** (player route net 8 errors ≤ baseline 9; all pre-existing `set-state-in-effect`/`refs` in untouched code).
- **Adversarial review (3 parallel agents):** the four headline risks all cleared with evidence — (1) a wrong phone never publishes a salvo (the gated conductor is the only publisher; per-tab module state), (2) once-per-surface de-dup holds across the dark→bright AND the keyed remount, (3) the ±4 standings read live `scores` recomputed at the +3.2s beat, (4) the TV always measures ≥520px so it keeps the full {1600, 2} budget. One **MEDIUM** found — a cross-question salvo race (amCorrect lagged the beat by one question) — **fixed** by binding the salvo to its `questionId` and gating only on a match; re-verified by logic trace + 6 test cases.

## Not done / honest limits
- **Live 3-phones-+-TV burst-sync recording** is not runnable in this env (no live July room; the documented edge-runtime e2e block — see lesson `live-e2e-blocked-by-edge-runtime-fetch-in-this-env`). Same basis Phase 2 used: unit-proven gating/scheduling + the measured 5–12ms cross-device delivery floor + adversarial review. **Confirm the visual burst-on-beat on a real multi-device setup before/at deploy.**
- The **winner/recap** pages (`/won`, `/recap`) intentionally were NOT given the conductor — the synchronized finale lands on the in-room dark screens at game end; the winner card keeps its ambient firework weather. A personal winner-card finale is Phase-4 territory.

## Scope note
Phase 3 grew (Brandon's call) to absorb what was Phase 4's "personal correct-answer sparkle." Re-scope Phase 4 around the remainder: July lock-in ceremony, finale build→erupt crescendo, palette/contrast sweep, full-surface red/white/blue cohesion.
