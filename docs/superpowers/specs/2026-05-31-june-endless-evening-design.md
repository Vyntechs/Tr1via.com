# June · "Endless Evening" — design

**Date:** 2026-05-31
**Status:** approved direction, pre-implementation
**Scope:** the **June monthly theme only** — its atmosphere + 3 reactive light beats. Not the other 11 months. Not the 4 app-wide moments from the experience audit (`wf_7ca9111a-283`). Those stay out of scope.

---

## The goal (why this exists)

Raise *perceived production quality* — make June feel like a large, well-funded team crafted it — by changing how it **feels**, not what it does. No new game features. This is experience polish, concentrated on one theme.

Two words are the bar:
- **Scream** — light that behaves like real light: a living sky that never quite repeats, real depth, and a warm-sky-over-cool-water palette no competitor has.
- **Home** — a memory everyone owns: the last warm light of a long summer evening, cool relief reflected below. The nostalgia *is* the feeling of home.

Decided via visual brainstorm: concept = "one light, two media" (sky + its reflection on water), weighted **sky-led** (warm sky dominant; water a thin cool shimmer at the bottom edge).

---

## The world (resting state)

A living summer-evening sky filling the TV stage:
- **Warm drifting color-field** — coral, gold, soft periwinkle slowly moving through each other, never quite repeating. Calm, premium, hypnotic.
- **A thin cool shimmer along the very bottom** — the same light reflected on water. Subtle; a sliver, not a scene. Warm above, cool relief below.
- **A faint glowing seam** where they meet near the bottom.
- **No objects, ever.** No string lights, fireflies, sun, props. Pure light + motion. (This honors the earlier "atmosphere only" rule.)

Discipline carried over from the existing weather system: ambient motion stays subtle, `pointer-events: none`, and honors `prefers-reduced-motion` (falls back to a static gradient, no animation).

---

## The magic (3 reactive beats)

The light *reacts* to the game — nothing is ever added to the scene.

1. **Idle / lobby** — the sky drifts and the bottom shimmer breathes. Even the waiting screen feels alive. (This is just the resting state, always on.)
2. **Lock-in** — as players commit answers, the light **gathers and warms** — the evening brightens a touch as the room locks in. This is a **TV-stage** beat (the atmosphere lives on the TV), consistent with the storyboard. A matching warm pulse on the player's phone is a **stretch goal**, only if it reuses the existing lock-in code path cleanly; not required for done.
3. **Reveal** — at the answer reveal, the **horizon seam swells** and a **soft bloom of light rises behind the correct answer**. The payoff, done as light, not confetti.

**The restraint rule (applies throughout):** while a question is on screen and being read, ambient motion **quiets down** so the words are easy to read and think about. The magic leans in at the big moments (lock-in, reveal) and steps back during the reading work. Motion must mean something, never decorate.

---

## How it fits the existing system

The theme engine is already in place; June already exists as a palette + a weather effect. This is an **upgrade to June within the existing contract**, not a new system.

- **Palette:** `lib/theme/tokens.ts` → the `june` `ThemeDef` (currently `paper #FCDEC8, ink #26120A, accent #E04A6B, pop #F2A02D, correct #3F8030, wrong #A92E22`, `mode: light`). Sky-led means the dominant background reads as the warm evening sky; values may be tuned so the atmosphere and the answer colors sit well against it. Token **names** do not change (contract is stable; ~65 components read `var(--…)`). Any new tokens are additive only.
- **Atmosphere render:** `components/system/Weather.tsx` → the `case "june"` (today a static `SunShimmer` gradient). This becomes the drifting sky + bottom water shimmer. Built with the techniques already proven in the repo: CSS gradient animation / keyframes (à la existing `tr1via-*` keyframes in `app/globals.css`), optionally a Canvas/SVG layer for the caustic shimmer if CSS alone is too flat. **No new dependency** unless a caustics layer genuinely needs one — decided at plan time, flagged if so.
- **Surface:** TV-only, like all weather (rendered by `TVStage`). Lock-in/reveal reactions hook the moments the TV already knows about (the lock-in pile and the reveal broadcast in the TV state machine). The player-phone lock-in warmth, if included, reuses the existing lock-in code path.
- **Reduced motion:** static fallback, consistent with `ParticleField`/`Lightning` behavior today.

---

## Out of scope (explicit)

- The other 11 monthly themes. (Brandon: "we won't need most of those for a while.")
- The 4 app-wide moments from the audit (global reveal/lock-in/join/lobby polish). June's reveal/lock-in reactions here are **June-local atmosphere**, not the app-wide moment rework.
- Any game-logic, scoring, timing, or state-machine behavior change. Experience only.
- Sound. (Not raised; can be a later add. Not in this spec.)

---

## Success criteria

1. On a June night, the TV resting state is a living, drifting warm sky with a thin cool water shimmer at the bottom — recognizably a summer evening, recognizably crafted, **no objects**.
2. The three reactive beats read clearly: idle breathing, lock-in warmth, reveal bloom behind the correct answer.
3. While a question is being read, motion is quiet enough not to distract.
4. `prefers-reduced-motion` users get a tasteful static version.
5. Nothing about game behavior changes; existing theme tests stay green; the full-flow prod driver stays green (reveal/lock-in are touched visually).
6. It holds up on a real venue TV (the actual `/tv/[code]` route + the host console), not just a dev gallery frame.

---

## Validation plan (per project rules)

- `tsc` + `vitest` green (ESLint pre-existing broken — known).
- `scripts/full-flow-prod.mjs` green — reveal/lock-in surfaces are exercised.
- Real-route browser pass on the June theme: `/tv/[code]` resting + reveal, and a player phone lock-in.
- Built on a feature branch → PR into `staging` → Brandon merges. Never push to `main`.
