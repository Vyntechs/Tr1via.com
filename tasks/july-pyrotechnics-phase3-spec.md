# July Pyrotechnics — Phase 3 Design Spec

> **Status:** Design locked with Brandon (brainstorm 2026-06-18). Awaiting spec review → implementation plan. NOT started in code.
> **Supersedes** the original Phase 3 brief in `tasks/july-pyrotechnics-plan.md` (which scoped "phones erupt together"). Brandon expanded it during design into a fuller per-question celebration + a player-requested standings view. This spec is the source of truth for Phase 3.
> **Figma mockups:** https://www.figma.com/design/lANVldTnzvKmxPv1kmQzZg ("TR1VIA — July celebration"): Frame 1 dark-sky fireworks, Frame 2 bright payoff + social line, Frame 3 calm wrong screen + awareness line, Frame 4 ±4 standings neighborhood.

## Goal

On July nights, make every player's phone part of one synchronized, **earned** celebration — and give players the "where do I stand" view they've been asking for, without ever letting the standings step on the fireworks.

Two synchronized moments ride the existing Phase-2 beat (no new sync system, no migration, no new per-client reads):
1. **Per-question salvo** (on resolve) — celebrates the players who got it right.
2. **Game-end finale** (on game end) — the whole room erupts together with the TV.

## Locked design decisions (from the brainstorm)

1. **Fireworks are earned — correct players only.** A firework burst on your phone *means* you got it right. Wrong / no-answer phones stay calm.
2. **The correct player's celebration is cinematic: dark → bright.** Real fireworks ignite on a dark navy sky (synced to the TV), *then* the screen resolves into the bright "Correct! +points" payoff. (Glowing fireworks wash out on the bright lime takeover, so they play during a dark beat first.)
3. **Social awareness, both directions, count-only.**
   - Correct payoff: **"You + N others nailed it."**
   - Wrong / no-answer: **"N of M got this one."**
   - Counts only — no names, no color dots (kept clean for a small phone).
4. **Standings on a 3rd beat, after the celebration.** Players asked to see the board. Show a **±4 neighborhood** (up to 4 ranks above them, themselves highlighted, up to 4 below) — not the full board. It appears *after* the fireworks/payoff, during the wait for the next question, so it never overlaps the fireworks.
5. **Game-end finale stays whole-room.** Not gated to correct — at game end every phone still in the room erupts with the TV.

## The reveal as a 3-beat sequence (per question, per player)

When a question's timer ends → `/resolve` → the server already knows who's right, and broadcasts the answer + one synchronized salvo beat (`fireAt = serverNow + 450ms`).

**Correct player:**
- **Beat 1 — Dark celebration (~1s):** full-bleed navy sky; real fireworks ignite at the synchronized instant (same moment as the TV). Wordless (recommended — the word lands on the payoff; Brandon may tweak in Figma).
- **Beat 2 — Bright payoff (~2.5s):** the existing `PlayerRevealCorrect` lime takeover (`+220`, speed chip, streak, rank rail) + the new **"You + N others nailed it"** line.
- **Beat 3 — Standings (rest of the wait):** settles into the ±4 neighborhood until the host starts the next question.

**Wrong / no-answer player:**
- **Beat 1+2 — Calm reveal (~2.5s):** the existing `PlayerRevealWrong` navy screen (your pick + the right answer) + the new **"N of M got this one"** line. **No firework burst.**
- **Beat 3 — Standings (rest of the wait):** same ±4 neighborhood.

Fireworks live only in beats 1–2; standings only in beat 3. They are **never on screen together** → zero interference (Brandon's explicit constraint).

## Game-end finale

`/end` already broadcasts a `finale` beat. On phones it publishes **unconditionally** (all players, correct or not). At game-1 end players are on `PlayerBetweenGames` (navy, engine already mounted); at game-2 end they're on the reveal/standings beat (navy, engine mounted — see below) before the night closes and they redirect to `/won` `/recap`. Either way the finale erupts on a dark screen for everyone, with the TV.

## Architecture

Rides the existing dual-publish beat (`broadcastFireworks` → `room:{code}` `fireworks` event → `useRoom.lastFireworksBeat`). All of that already exists from Phase 2 and reaches every phone today — Phase 3 wires the player side that consumes it.

### 1. Mount + gate the beat conductor on the player route
- Mount **one** `PyrotechnicsBeatConductor`-style consumer in `app/(player)/room/[code]/page.tsx` (in `RoomStateMachine`, where `snapshot.lastFireworksBeat`, `myAnswers`, and the resolved question are all in hand).
- **Gating** (the new bit vs. the TV/host conductor, which publish every beat):
  - `finale` beat → publish always.
  - `salvo` beat → publish **only if this player got the just-resolved question right.** Derive correctness the same way `RevealView` does (the player's answer row `is_correct === true` OR `chosen_index === correct_index` for the resolved question; the resolve broadcast's `awards`/`correctIndex` carry it without a refetch). De-dup by beat identity so it ignites once.
- A wrong player's conductor simply never publishes the salvo → their ambient engine never bursts. The game is never affected (cosmetic, best-effort).

### 2. Correct-player dark→bright sequence component
- New `PlayerRevealCorrectSequence` (name TBD) wrapping the celebration:
  - **Phase A (dark):** navy full-bleed + the Phase-1 `Pyrotechnics` engine, mounted immediately on entering a correct reveal so it's on-screen before `fireAt`. The salvo beat (published by the gated conductor) ignites the burst at the synchronized instant.
  - **Phase B (bright):** after a hold (~1–1.2s past ignition), transition (gentle fade) to the existing `PlayerRevealCorrect` payoff, now passed the social count.
- Reduced motion: Phase A shows the engine's static-glow fallback (no flashing), then the same gentle transition.

### 3. Social count (both screens)
- Compute `correctCount` / `answeredCount` from the resolve broadcast's `awards` (already on `lastBroadcast`) — no new read. Pass into `PlayerRevealCorrect` ("You + {correctCount-1} others nailed it") and `PlayerRevealWrong` ("{correctCount} of {answeredCount} got this one"). Guard the singular/zero/edge phrasing.

### 4. ±4 standings neighborhood (beat 3)
- New pure builder `buildNeighborhood(scores, meId, radius = 4)` (in `lib/player/`, unit-tested): returns up to `radius` rows above, the player's row (flagged), up to `radius` below, from the already-loaded `game_scores`. Handles top/bottom edges (fewer on the short side) and "player not in view yet" (null → render a calm placeholder, never "#0").
- New `PlayerStandingsNeighborhood` component (navy via `PhoneScreen`, so it also carries ambient July weather + can host the finale burst): "You're #N of M", the ±4 list (your row highlighted in accent), a "Next question coming up…" footer.
- Entered as beat 3 after the per-player celebration/calm delay; holds until the next question goes live (the existing state machine already clears the reveal when `currentQuestion` flips).
- Reuses the row styling from `PlayerBetweenGames`. Data is the `scores` already loaded + subscribed in `RoomStateMachine` — **no new fetch or subscription.**

### 5. Phone performance budget on the engine
- `Pyrotechnics` self-degrades by canvas size (and optionally `navigator.hardwareConcurrency`): on a phone-sized canvas, cap the live-particle ceiling well below the TV's 1600 and cap DPR (~1.5). The **TV path (large canvas) stays byte-identical** — gate the phone profile on a width threshold so the venue TV is untouched.
- Correct phones run the burst only ~1s per question; the finale is one eruption. Ambient July weather stays subtle (≤ the existing 0.5 intensity).

## Surfaces touched
- `app/(player)/room/[code]/page.tsx` — mount + gate the beat conductor; insert the 3-beat reveal sequence + standings beat into the state machine.
- `components/player/PlayerRevealCorrect.tsx` — add the social-count line; (likely) wrap in the dark→bright sequence.
- `components/player/PlayerRevealWrong.tsx` — add the awareness-count line.
- NEW `components/player/PlayerRevealCorrectSequence.tsx` (dark→bright) and `components/player/PlayerStandingsNeighborhood.tsx`.
- NEW `lib/player/standings.ts` (or extend `lib/player/betweenGames.ts`) — `buildNeighborhood`.
- `components/system/Pyrotechnics.tsx` — phone particle/DPR budget (TV unchanged).
- Tests: unit for `buildNeighborhood` + the salvo correct-only gating + the social-count phrasing; component render tests for the new components (reduced-motion fallback).

## Out of scope (Phase 3)
- Any DB migration / schema change (transport + client only).
- Scoring/auth/answer mechanics; generation routes.
- The full leaderboard board; names/avatars in standings.
- Host-screen changes (TV + host console already handled in Phase 2).
- The `lockInCeremony` registry entry, finale build→erupt crescendo, palette/contrast sweep → **Phase 4.**
- No deploy/merge during a live Wednesday show.

## Constraints
- **No new per-client Supabase reads.** Counts come from the resolve broadcast; standings come from the `game_scores` already loaded + subscribed. The beat is one broadcast Supabase already fans out.
- **Reduced motion** respected on every new surface (static glow, gentle fades, static standings).
- **Fail soft:** a dropped beat = one missed burst; a phone that drops WiFi misses that burst and recovers with no read stampede (rely on the existing resilience layers; add no new fan-out).
- **Phone budget:** capped particles + DPR; fireworks must never jank the answer/reveal UI or visibly drain battery.

## Verification plan
- **Unit (vitest):** `buildNeighborhood` (mid-pack, top edge, bottom edge, player-absent); salvo correct-only gate (correct → publish, wrong → no publish, finale → always); social-count phrasing (0/1/N, answered vs total).
- **Component:** the dark→bright sequence renders + transitions; reduced-motion shows the calm fallback; standings highlights the right row.
- **Live (dev harness):** 2–3 browser contexts as phones + the TV in a dev July room; trigger a resolve → confirm correct phones erupt in sync with the TV, wrong phones stay calm with the count line, then all settle into the ±4 standings; trigger a game end → confirm the whole-room finale. Confirm the answer/reveal UI stays responsive and reduced-motion phones show the calm fallback. (Per Phase-2 lessons, true cross-device sync is proven by the unit-tested scheduling + the measured 5–12ms delivery floor; live e2e against prod Supabase is blocked by the edge-runtime fetch issue in this env — visual burst best confirmed on a real multi-screen setup.)

## Open / deferred items
- Dark celebration moment: wordless (recommended) vs. repeating "Correct." — Brandon to tweak in Figma; default wordless.
- Exact beat durations (dark ~1s, payoff ~2.5s) — tunable constants, finalize live.
- "Nobody got it right" edge: TV salvo behavior when correctCount = 0 (skip vs. small burst) — decide during build; phones already no-op (nobody's correct).
