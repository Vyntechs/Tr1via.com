# June · Reactive Water — "the surface that answers the room"

**Date:** 2026-05-31
**Status:** approved direction (Brandon, brainstorm 2026-05-31), pre-implementation
**Builds on:** the merged June "Endless Evening" theme (`JuneSky`, PR #65) + the cohesion fixes (PR #66 — incl. JuneSky's `backgroundImage` fix). This branch is cut off the cohesion branch so the water work builds on the corrected `JuneSky`.

---

## The goal (why this exists)

June already *looks* like a warm summer evening with a thin cool strip of water at the bottom. Brandon's words: **"It feels great, it's just lacking the water"** — and, crucially, **"I said feel, not look."**

The cool element today is a thin shimmer that just **sits** there. It reads faintly like water but doesn't **behave** like water. Water feels like water when it **reacts and reflects**. This upgrade makes June's water a living surface that answers the room — without adding any object, and without a generic "AI blue" wash.

Two words still set the bar (from the original June spec): **Scream** (light no competitor has — warm sky over cool, *responsive* water) and **Home** (the last warm light of a long evening, cool relief below).

---

## The core idea (validated with Brandon)

**The cool below is the warm above — mirrored and rippling.** The blue is never its own decoration; it is the warm light from the sky, bounced back cooler off the water's surface. Because the blue only appears *as a reflection of something warm that just happened*, it is **motivated** — which is exactly why it reads as real water and not as an arbitrary blue that screams AI. This is "one light, two media" made to behave, not just to look.

**And the water is shared.** Every screen — the TV and every player's phone — answers the *same* moments off the *same* source of truth (the database's live feed). When one player locks in, the ripple isn't just on the TV; it crosses every phone's water at once. The phones effectively **interact with each other**, mediated by the database — no phone-to-phone link, each client simply reacts locally to the shared truth. This is the "magic between players."

---

## The four beats

### 1. At rest — a faintly-breathing mirror (the balance Brandon asked for)
The cool band along the bottom is **alive but quiet**: a slow, low breath so it never looks dead-still, kept low enough that any ripple or reflection clearly **rises above** it. It holds a cooler, softer reflection of the warm sky above, with the existing glowing seam where sky meets water. The contrast between this quiet baseline and the moments *is* the feel.

While a question is on screen being read, the surface stays at this quiet baseline — this is the **restraint rule** from the original June spec, satisfied by keeping the resting breath low rather than by freezing it.

### 2. Lock-in — a drop
Each player who locks in sends a **ripple** out across the surface: a soft expanding swell that rises above the baseline and settles back. The room's pulse, felt on the water. Rides the **existing** `fireJuneBeat("lock")` (no new wiring on the TV — already fires per newly-seen lock).

### 3. Reveal — the reflection
When the correct answer blooms **warm** above (the existing reveal bloom), the water below **catches it**: a cool-tinted swell of that same glow rises off the surface, then settles. Same light, two media. **This is the "transient blue"** — it appears *because* the warm bloom happened. Rides the **existing** `fireJuneBeat("reveal")`.

### 4. Reduced motion
A still, tasteful reflection — no breath, no ripple, no reactive swell. Consistent with how `JuneSky` already handles `prefers-reduced-motion` (static gradient).

---

## How it fits the existing system

This is an **upgrade to `JuneSky`'s water layers**, not a new component or system.

- **Home:** `components/system/JuneSky.tsx`. Today it has Layer 2 (the thin cool shimmer sliver), Layer 3 (the glowing horizon seam), and Layer 4 (the reveal bloom, warm). This upgrade enriches the water (Layer 2 / the bottom band) with: a low resting breath, a lock-in ripple, and a cool reflection of the reveal bloom.
- **Beats:** reuse the existing module beat (`fireJuneBeat` / the subscribed `beat` state). The lock ripple and reveal reflection are driven by the `beat` already plumbed in `JuneSky`. **No new TV-state wiring** — `TVStateMachine` already fires both beats.
- **Surface scope — TV *and* phones, both reactive.** `JuneSky` renders via `Weather` on the **TV** (`TVStage`) and on **player phones** (`PhoneScreen`). Both carry the reactive water. Every client fires its *own* water from the *same* shared live feed, so the room's moments ripple across all of them at once:
  - **Reveal reflection — TV + every phone, reliable.** The reveal arrives as a push every client already receives (it's how the phone flips to the reveal screen). Each fires `fireJuneBeat("reveal")` at that moment. On the TV this is already wired (`TVRevealView` mount); on the phone, fire it where the room enters its reveal state.
  - **Lock-in ripple — TV + every phone.** The TV already fires per newly-seen lock. On the phone: the player's *own* lock is known locally (reliable); *other* players' locks ride the **existing `useLockInSync`** poll (the proven mechanism that already backstops the TV), because raw realtime lock updates are the known weak spot for phone sessions. So every lock-in ripples every phone, reliably — not via a naive realtime listener.
  - **Plan-time check:** confirm what the phone's room feed already exposes for *others'* locks (snapshot live-answers vs. RLS-limited); use the snapshot if it carries them, else the lock-sync poll endpoint. Don't assume — verify.
  - **Nuance:** some phone reveal states are a full color takeover (the big "Correct +110") that intentionally hides the atmosphere — so the reflection shows on the calmer phone states and shines most on the TV; exact screens sorted in the plan.
  - **Burst handling (failure mode):** in a full room many locks fire at once — coalesce/cap concurrent ripples on the phone so it reads as a living surface, not noise.
- **Engineering (decided, not Brandon's call):** pure light/CSS like the rest of June — gradients, keyframes, and a **subtle wavering** on the reflection band so it reads as *liquid* rather than a flat gradient (a light SVG turbulence/displacement OR an offset dual-gradient shimmer — chosen at plan time for performance). **No new dependencies.** Must stay performant on a real venue TV (the original spec already flagged `mixBlendMode` + blur GPU cost — keep the water band small and the effects cheap). Reduced-motion falls back to static.

---

## Also in this pass (separate, not a design choice)

**Host live console — bottom action bar text contrast (bug).** On the host live console (`GAME · LIVE`), the bottom black action bar renders its controls — the players list and the +/- point adjustments — in dark text on black, so they're invisible/unclickable-looking. This is a straight **contrast bug**, not part of the water design. Fix the text/control colors on that bar so they're readable on the dark background. Tracked here so it ships in the same pass; detailed as its own task in the plan.

---

## Out of scope (explicit)

- Direct phone-to-phone connections — the interaction is mediated through the shared database feed (each client reacts locally); no peer links.
- The other 11 monthly themes; any app-wide moment rework.
- Any game-logic, scoring, timing, or state-machine change. Experience only.
- New dependencies; a full canvas water simulation (perf + "screensaver" risk — rejected in favor of cheap CSS/SVG light).
- Sound.

---

## Success criteria

1. On a June night's **TV**, the resting water is a faintly-breathing cool mirror of the warm sky — alive but quiet, recognizably water, no objects.
2. A **lock-in** sends a visible ripple across the water that rises above the baseline and settles.
3. The **reveal** casts a cool-tinted reflection of the warm bloom onto the water, then settles — felt as "transient blue," motivated by the warm moment.
4. While a question is being read, the water stays at its quiet baseline (restraint honored).
5. `prefers-reduced-motion` users get a still, tasteful reflection.
6. **Every phone's water reacts to the room** off the shared feed: it reflects on reveal and ripples on lock-ins — your own *and* other players' (the latter via the existing lock-sync) — so the room's moments are felt across all phones at once. No regression to the calm join/lobby look Brandon already liked.
7. Nothing about game behavior changes; existing theme + JuneSky tests stay green; `full-flow-prod.mjs` (june) stays green.
8. The host live console's bottom action-bar controls (players, point +/-) are readable/visible.
9. It holds up — and *feels* like water — on the real `/tv/[code]` route and a player phone, not just a dev frame. **The real acceptance test is feeling it live on the preview deploy**, since this is feel, not look.

---

## Validation plan (per project rules)

- `tsc` + `vitest` green (incl. `juneSky.test.tsx`; add beat/behavior tests for the new water responses where they can be tested without a renderer — the module beat already is).
- `scripts/full-flow-prod.mjs` (june) green — reveal/lock-in surfaces are exercised.
- Real-route browser pass: the June TV (resting breath, lock ripple, reveal reflection); **two player phones in the same room** — locking in on one ripples the *other's* water (the shared-moment proof); a phone reveal reflection on a calm state; and the host live console (readable action bar).
- Built on `june-reactive-water` → PR into `staging` → Brandon feels it on the preview → Brandon merges. Never `main`.

## Execution mode (Brandon's instruction)

Brandon will **clear context before implementing**, then implement **TDD + subagent-driven** (`superpowers:subagent-driven-development`), one fresh subagent per task with two-stage review (spec compliance, then code quality) between each — same mode as the June theme build.
