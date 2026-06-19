# July Pyrotechnics — 4-Phase Plan & Status

> **ALL 4 PHASES DONE + verified (commit-only — NOT pushed/merged/deployed).** Phase 4 completed 2026-06-19 — see `tasks/july-pyrotechnics-phase4-report.md`. Nothing left to execute; the open items are Brandon's calls (push/PR/hold the branch; live multi-device visual confirmation before any deploy; the optional July phone lock-in firework parity noted in the Phase 4 report).
> History: Phase 3 grew into a fuller per-question celebration + standings view (`phase3-{spec,plan,report}.md`); Phase 4's "personal correct-answer sparkle" was pulled into Phase 3, so Phase 4 delivered the lock-in ceremony + finale crescendo + contrast sweep instead.

## ⛔ How to run this (hard gates)
Execute **ONE phase per session**. Do NOT start the next phase — not setup, not "reading ahead" — until explicitly told. When a phase is built AND verified, STOP and report `Phase N verified — ready for /done → /clear before Phase N+1`. Each phase is a hard gate.

## Ground truth (confirmed in the codebase)
- A July theme exists: navy `#0E1A36` / red `#E63946` / gold `#FFD93D` in `lib/theme/tokens.ts`.
- The **"database as conductor" already exists**: dual-publish broadcast architecture = host/device action → writes DB → server broadcasts → all screens fan out and react (`lib/hooks/useRoom.ts`, `lib/hooks/useTVRoom.ts`, `lib/api/broadcast.ts`). **Do NOT build a parallel sync system — ride this one.**
- The real gaps (not a rebuild): (1) fireworks were bland 4-loop SVGs [FIXED in Phase 1]; (2) they render on TV — and, it turns out, anywhere `<Weather>` mounts; (3) nothing schedules them to a shared instant, so screens fire on-receipt and drift 50–250ms apart — "all together" isn't actually true yet.
- **The magic primitive = a scheduled beat**: broadcast a `fireAt` timestamp a few hundred ms in the future; every device ignites at that same wall-clock moment using the server-time offset the app already corrects for (game timers do this). Firing "on receipt" is the drift bug — never do that.
- Closest existing template to copy: May's `fireLightningBeat()` in `components/system/Lightning.tsx` + `components/tv/TVFinaleWinner.tsx`.
- **HARD CONSTRAINTS (all phases):** No DB migration expected (broadcast is transport, not schema — a new BroadcastTag needs no schema change). Never merge/deploy during a live Wednesday show (Phases 2–3 touch the realtime path Heather's real shows run on). Respect `prefers-reduced-motion` + a phone perf budget everywhere.

---

## ✅ Phase 1 of 4 — Pyrotechnics engine (pure visual, TV) — DONE 2026-06-18 (NOT merged)
Replaced the bland 4-loop SVG fireworks with a real canvas engine.
- **NEW `components/system/Pyrotechnics.tsx`** — `"use client"` canvas RAF engine mirroring `Lightning.tsx`: launched shells rise + arc under gravity, explode at apex into gravity-driven burst particles with trails (additive `lighter` + `destination-out` fade); peony/willow/ring/crackle; red/white/blue/gold (`JULY_FIREWORK_COLORS`, `#4DA6FF` blue added); `intensity` scales cadence + multi-shell salvos (0 = off, 1 = ambient, 2.2 = finale); particle ceiling, DPR clamp, ResizeObserver, hidden-tab guard; calm static reduced-motion fallback (`pyrotechnics-reduced`).
- `Weather.tsx` july case → `<Pyrotechnics intensity={intensity}/>`; deleted dead `FireworkBursts` + `Firework` import. `index.ts` exports. Removed dead `tr1via-burst` keyframe from `app/globals.css`. NEW `tests/unit/pyrotechnics-component.test.tsx`.
- `TVFinaleWinner.tsx` needed no edit (already mounts `<Weather intensity={2.2}/>`).
- **Verified:** vitest 750/0 (+8 skip), tsc only the 2 known `HostHomeClient` errors, eslint clean; live `/dev/tv` July before/after captured; reduced-motion fallback confirmed (0 canvases). Review agents fixed a build-blocker (ref-write-during-render → effect) + an off→on intensity gap (`active` dep).
- **DECISION (Brandon):** do NOT gate to TV-only. The engine flows to every `<Weather>` july mount — TV, phones (`PlayerWinnerCard`, `PhoneScreen`), `LaptopShell`, `OnboardingFirstNightDone`, marketing `CardWeather` — consistent with may/june canvas weather. Whole-room synchronized magic is the north star; gating would undercut it.
- **Open polish (optional, when on a real TV):** finale density/brightness bump if it reads modest.

---

## ✅ Phase 2 of 4 — Synchronized "beat" conductor (TV + host) — DONE 2026-06-18 (NOT merged)
A single game beat now ignites the SAME burst on the TV + host preview at the SAME wall-clock instant, riding the existing broadcast conductor — **no migration, transport only**.
- **NEW `room:{code}` event `"fireworks"`** (`lib/api/broadcast.ts`) + `broadcastFireworks(roomCode, kind)` stamping `fireAt = serverNow + lead` (salvo 450ms / finale 700ms). Best-effort; July-no-op by construction (only July mounts an engine to react).
- **Engine beat** (`Pyrotechnics.tsx`): module-level `publishPyrotechnicsBeat(kind, delayMs)` carries a `{id, kind, targetAtMs}`; every mounted engine **schedules against the shared target** (`planEngineBeat`) and de-dups by id (`lastFiredPyroBeatId`) so the burst lands **exactly once per surface** even across the per-view TVStage remount. `fireBeat` injects an immediate air-burst cluster (salvo=3 / finale=7) via the existing `explode()` (self-limits vs `MAX_PARTICLES`). Reduced-motion = genuine no-op (engine effect doesn't run).
- **NEW `PyrotechnicsBeatConductor`** (`computeBeatDelayMs`): trusts the wall clock for true cross-device sync when device+server clocks agree, falls back to receipt+lead on skew, skips stale (skew-immune via locally-stamped `receivedAtMs`) + malformed beats. Mounted on `/tv/[code]` + the host live console (NOT phones — Phase 3).
- **Hooks** (`useRoom`/`useTVRoom`): surface the beat on a SEPARATE `lastFireworksBeat` field (NOT `lastBroadcast` → no phone `myAnswers` refetch); no refetch triggered.
- **Emit**: resolve route → salvo; end route → finale. (Game-end is the single synchronized eruption; the full build→erupt crescendo stays Phase 4. Cadence per Brandon: salvo every resolve + bigger finale at game-end.)
- **Verified:** vitest 768/0 (+18 new beat tests: clock math, schedule rule, once-per-surface de-dup, conductor wiring); tsc only the 2 known `HostHomeClient` errors; eslint introduced 0 new problems. **Live broadcast-jitter probe** (real Supabase, two subscribers, 8/8): inter-subscriber gap **median 5ms / max 12ms** (< one frame) — the empirical sync floor. **Adversarial review** (14 agents): 9 refuted, 1 confirmed → FIXED (the catch-up double-fire across remount; see lesson `sync-beat-schedule-against-target-not-fire-on-mount`) + a focused re-skeptic confirmed the fix + one fail-soft hardening (only claim a beat if the engine can actually draw). Report: `tasks/july-pyrotechnics-phase2-report.md`.
- **NOT runnable in this env:** the literal "two live screens + a real July resolve, recorded" — no live July room here + edge-runtime Supabase-auth block (logged lesson). Substituted by the unit-proven scheduling/de-dup + measured 5–12ms delivery floor + adversarial review. Visual burst-on-beat (canvas) best confirmed on a real two-screen setup (carry into Phase 3's multi-device run).

### Phase 2 — original brief (for reference)
**Goal:** A single game beat makes the TV and the host's live preview ignite the SAME burst at the SAME wall-clock instant (not "whenever each receives it"). Proven by two screens firing in unison.

**Scope:** `lib/hooks/useRoom.ts` + `lib/hooks/useTVRoom.ts` (the BroadcastTag union + handlers); `lib/api/broadcast.ts`; the existing `serverNow`/clock-offset plumbing; the routes that already broadcast at climactic moments (`app/api/games/[id]/reveal/route.ts`, `app/api/questions/[id]/resolve/route.ts`, `app/api/games/[id]/end/route.ts`); May's `fireLightningBeat()` as the pattern.

**Out of scope:** player phones (Phase 3), any migration/schema change (reuse the broadcast channel), scoring/auth, generation routes. Do NOT change what the existing reveal/resolve/end events mean — only ride them. No merge/deploy during a live show.

**Steps:**
1. GROUND FIRST: read the broadcast handlers, trace one existing event (reveal) route → broadcast → both clients, confirm how `serverNow`/clock-offset is computed. RUN two browsers (TV + host preview) and watch a real reveal propagate to see today's drift.
2. Add a "firework beat" on top of the EXISTING conductor: a scheduled ignition carrying `fireAt = serverNow + ~400ms`, as a new BroadcastTag (transport only — no schema). Server emits it at climactic moments (correct-answer reveal, resolve, finale).
3. On each client, schedule the burst for `fireAt` using the SAME server-clock offset the timers use. Do NOT fire on receipt (name this drift bug in the PR).
4. Render the Phase-1 engine's burst when the scheduled beat fires, on TV + host live preview.
5. Fail soft: a missed beat must never freeze or desync the game (fireworks are cosmetic). Respect reduced-motion + existing reliability layers without adding new read fan-out.

**Verify by:** TV + a second screen side by side; trigger a real reveal/resolve; confirm BOTH ignite the same burst within a frame or two (record one video of both firing together); confirm briefly dropping one screen's network does not freeze the game.

**Quality bar:** Expertise-first, THEN orchestrate. Become a genuine expert in the real realtime + clock-offset code by reading it AND running two live screens before changing anything. Then decompose (server emit / client schedule / render) and adversarially verify — actively try to prove the two screens are NOT in sync (record, measure the gap). Run the repo's review agents (silent-failure-hunter, code-reviewer) before merge. `/effort xhigh`.

---

## ✅ Phase 3 of 4 — Every phone erupts together (player surfaces, at scale) — DONE 2026-06-18 (NOT merged)
Brandon expanded the brief during design into an **earned, per-question celebration + a player-requested standings view**. Built test-first via subagent-driven development; design locked in Figma ("TR1VIA — July celebration").
- **Earned, correct-only fireworks.** A new per-player-gated `PyrotechnicsBeatConductor` on the room route (`gateBeatForPlayer`, `lib/game/revealOutcome.ts`): the game-end **finale** fires for everyone; a per-question **salvo** fires only on a phone that got THAT question right. The salvo broadcast now carries its `questionId` so the gate binds correctness to the same question (closes a cross-question race caught by adversarial review).
- **Cinematic dark→bright** (`PlayerRevealCorrectSequence`): correct players get a dark navy sky where real fireworks ignite in sync with the TV (~1s), then the bright "Correct! +pts" payoff. Glowing fireworks wash out on the bright takeover, so they play during the dark beat.
- **Count-only social lines** (`lib/player/celebrationCopy.ts`): "You + N others nailed it" (correct) / "N of M got this one" (wrong) — derived from the resolve broadcast's `awards` (no new read).
- **±4 standings neighborhood** (`PlayerStandingsNeighborhood` + `buildNeighborhood`): a 3rd reveal beat (after the celebration/payoff, never overlapping fireworks) showing 4 above + you + 4 below; reuses the already-subscribed `game_scores` (no new read).
- **Phone perf budget** (`pyroBudget` in `Pyrotechnics.tsx`): caps particles (~350-550) + DPR (1.5) on phone-sized canvases; the venue TV (cssW ≥ 520) stays byte-identical {1600, 2}.
- **Verified:** vitest 804/0 (+8 skip) incl. new tests for the gate (correct-only + questionId binding), neighborhood edges, social copy, phone budget, dark→bright sequence; tsc only the 2 known `HostHomeClient` errors; eslint 0 new problems (net 8 ≤ baseline 9). **Adversarial review (3 agents)**: 4 headline risks all cleared (gate isolation, once-per-surface de-dup across remount, fresh standings, TV unchanged); 1 MEDIUM found (cross-question salvo race) → FIXED via questionId binding + re-verified.
- **NOT runnable here:** the literal 3-phones-+-TV live burst-sync recording — no live July room + the documented edge-runtime e2e block in this env. Substituted by unit-proven gating/scheduling + the Phase-2 measured 5–12ms delivery floor + adversarial review. Visual burst-on-beat best confirmed on a real multi-device setup (carry forward).

### Phase 3 — original brief (for reference)
**Goal:** At a climactic beat, 20+ player phones AND the TV ignite the same fireworks at the same instant — look up from your phone and the whole room is one synchronized celebration.

**Scope:** player celebration surfaces (`PlayerRevealCorrect.tsx`, `PlayerBetweenGames.tsx`, `PlayerWinnerCard.tsx`), the `PhoneScreen.tsx` weather wrapper, the Phase-2 beat subscription in `useRoom.ts`, the Phase-1 engine tuned for small/low-end devices.

**Out of scope:** any migration, scoring/auth, question-answering mechanics, host screens. Do NOT increase per-client Supabase READ load — the beat is one broadcast Supabase already fans out; add no new per-phone fetches. No deploy during a live show.

**Steps:**
1. GROUND FIRST: read `PhoneScreen.tsx`, the player celebration components, and how `useRoom.ts` receives the Phase-2 beat. RUN 2–3 real phones/browsers in a dev room to see today's reveal behavior + measure render perf. Re-read the stampede/jitter/reachability lessons in `tasks/lessons.md`.
2. Mount the Phase-1 firework layer on the player celebration surfaces, subscribed to the SAME beat at the SAME `fireAt` as the TV.
3. Strict phone perf budget: cap particle count, GPU-cheap transforms, auto-degrade on low-end devices, respect reduced-motion. Fireworks must never jank the answer/reveal UI or visibly drain battery.
4. Fail soft + no new fan-out: a phone that drops WiFi simply misses that burst and recovers, no read stampede on reconnect.

**Verify by:** 3+ real devices + a TV in one dev room; trigger a climactic beat; record all screens igniting together; confirm the answer/reveal UI stays responsive on the slowest device and reduced-motion phones show the calm fallback.

**Quality bar:** Expertise-first, THEN orchestrate. Read the real player surfaces + scale lessons and RUN multiple real devices before changing anything. Decompose per-surface and adversarially verify at scale — try to make it desync, jank, or fan out reads under load; prove it doesn't. Run review agents before merge. `/effort xhigh`.

---

## ✅ Phase 4 of 4 — Per-interaction polish ("each intent feels intentional") — DONE 2026-06-19 (NOT merged)
Delivered (see `tasks/july-pyrotechnics-phase4-report.md`): July lock-in ceremony (marquee + per-player tinted firework on the TV/host via `fireLockInBurst`, mirroring May's lightning); finale build→erupt crescendo (`useCrescendo` intensity ramp on TVFinaleWinner + PlayerWinnerCard, the existing synchronized beat is the erupt); live red/white/blue cohesion + contrast sweep (sound — dark text on all saturated bgs, no token change needed). Verified: vitest 820/0 (+8 skip), tsc 2 known, eslint 0 new. Adversarial review (4 agents): 22 non-bugs + 1 real HIGH (July phones fired May's lightning bolt via generic `hasCeremony`) → FIXED (gate on `ceremony === "lightning"`) + regression test + lesson. **NOT runnable here:** live canvas motion (lock-in tint + ramp) — carry to a real TV/phone before deploy.

### Phase 4 — original brief (for reference)
**Goal:** Every July surface reads as one cohesive, world-class red/white/blue experience, and key intents get a tasteful synchronized flourish — the finale builds and erupts, a correct answer earns a small personal sparkle, the room feels designed.

**Scope:** July surface coverage (join, lobby, question, reveal, between-games, recap, winner, host live console under July); a July lock-in/celebration ceremony mirroring May's `lockInCeremony` registry; a finale crescendo (build → erupt) on TV + phones using the Phase-2 beat; palette/contrast tuning of derived tokens in `lib/theme/tokens.ts` if needed for readability.

**Out of scope:** any migration, scoring/auth/answer mechanics, other months' themes, the core sync primitive (locked in Phase 2). Do not regress contrast/accessibility. No deploy during a live show.

**Steps:**
1. GROUND FIRST: read the `lockInCeremony` registry + May's entry; walk every July surface live (set a dev night to July) capturing a baseline screenshot of each.
2. Add a July lock-in/celebration ceremony entry mirroring May's pattern.
3. Add a finale crescendo (build → erupt) driven by the Phase-2 scheduled beat, on TV + phones.
4. Add a small, tasteful personal sparkle on a correct-answer reveal (phone), optionally acknowledged on TV — synchronized via the beat, reduced-motion-safe.
5. Sweep every July surface for red/white/blue cohesion + contrast; fix any muddy token. Verify reduced-motion fallbacks on every surface.

**Verify by:** Screenshot-checklist every July surface (join → lobby → question → reveal → between → finale → winner → recap → host); confirm cohesive red/white/blue + working flourishes; confirm reduced-motion shows calm fallbacks; confirm contrast is not regressed.

**Quality bar:** Ground, then fan out. Read the ceremony registry + walk every July surface live FIRST. Fan out per-surface polish + a verification pass with a screenshot checklist; spot-check the diff. Run review agents on the final diff before merge. `/effort high`.

---

### Verification gotcha (from Phase 1)
Headless Playwright won't paint canvas frames deep in the `/dev/tv` stacked gallery — they screenshot blank navy despite rendering fine. Isolate the target frame (`document.querySelectorAll('main section').forEach(s => { if (!s.querySelector('[data-testid="..."]')) s.style.display='none' }); scrollTo(0,0)`). Editing `Weather.tsx` live can throw a transient stale-HMR `FireworkBursts is not defined` — gone after recompile, not a real crash. See memory `headless-canvas-screenshot-isolate-frame`.
