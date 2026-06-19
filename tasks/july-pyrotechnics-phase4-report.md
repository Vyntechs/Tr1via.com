# July Pyrotechnics — Phase 4 Report (2026-06-19)

**Status: Phase 4 DONE + verified on `fix/rls-correct-index-leak` (commit-only — NOT pushed/merged/deployed).** Final phase of the 4-phase effort. Hard gate respected: Phase 4 only, then STOP.

## Scope (re-scoped, as planned)
Phase 3 had already absorbed Phase 4's "personal correct-answer sparkle" (the dark→bright reveal). Brandon's decisions this session: **lock-in ceremony = "mirror May" (marquee + per-lock fireworks)**, and **leave the 3 uncommitted host files untouched (commit only my files)**. Remaining Phase-4 work delivered:

### W1 — July lock-in ceremony (TV/host)
- `lib/theme/lockInCeremony.ts` — extended `CeremonyKind` to `"lightning" | "fireworks" | null`; added `july: { duration: 30, marquee: true, ceremony: "fireworks" }`. This flips on the marquee scoreboard for July (TVQuestion) + the per-player lock-in ceremony for free (registry-driven, theme-agnostic machinery already built for May).
- `components/system/Pyrotechnics.tsx` — new module-level `fireLockInBurst(tint)` + `subscribeLockInBurst` (mirrors `Lightning.fireLightningBeat`). Inside the engine effect, `fireLockInBurstLocal` fires ONE player-tinted firework (lazily-built, hex-cached glow sprite appended to `sprites[]`; white accents; white core philosophy) through the existing particle physics; unsubscribed on cleanup.
- `components/tv/TVLockInCeremony.tsx` — new `ceremony` prop (default `"lightning"` for back-compat). Dispatch: `"fireworks"` → `fireLockInBurst(tint)`, else `fireLightningBeat("close", { tint })`. The queue/mode/spotlight/+SPD machinery is unchanged (theme-agnostic).
- `components/tv/TVStateMachine.tsx` — passes `ceremony={lockInCeremonyFor(themeKey).ceremony}`.

### W2 — Finale build → erupt crescendo
The synchronized "erupt" beat already fires on every surface (conductor confirmed wired on `/tv/[code]:103`, host `HostLiveConsoleClient.tsx:450`, player room route — the grounding subagent's "host missing conductor" claim was FALSE; verified). Added the "build":
- `lib/game/crescendo.ts` — pure `crescendoIntensity(elapsedMs, {from,to,durationMs})` smoothstep ramp.
- `lib/hooks/useCrescendo.ts` — rAF hook; reduced-motion (or no rAF) returns the peak via render (no synchronous effect setState); **throttled to ~12 updates/sec** so it never re-renders the finale subtree 60×/s and jank a weak venue laptop running the canvas.
- `components/tv/TVFinaleWinner.tsx` (1.1→2.4 over 3s) + `components/player/PlayerWinnerCard.tsx` (1.0→2.0 over 3s) — static `intensity` replaced with the ramp. Hook order preserved (above the `if (!winner)` guard; `tv-finale-winner-hooks.test.tsx` still green). The engine reads intensity live and is NOT reset mid-ramp.

### W3 — Red/white/blue cohesion + contrast sweep (live)
Walked every July surface live (`/dev/player`, `/dev/tv`) with screenshots. **Resolution of the grounding readers' contrast disagreement:** the rendered UI is sound because **dark text (`#0E0805`) is used on every saturated (red/gold) background** — TV room code, leaderboard top row, grid, intermission, recap, winner panel, and the standings/between "you" rows. **Cream (`t.ink`) is NEVER placed on red or gold**, so the scary abstract pairs (cream-on-red 3.37:1, cream-on-gold 1.11:1) do not occur. Gold backgrounds are non-text pulse dots / a dark-text pill. The only sub-4.5:1 pair is white-on-red on the two CTA submit buttons (~4.18:1) — large bold text (passes AA-large 3:1), and a **pre-existing cross-theme pattern** (July's red is higher-contrast for white than the amber themes), not a Phase-4 regression. **No token change warranted.** Also confirmed live: the **July marquee renders** (`tv-scoreboard-marquee` visible with chips) and the **reduced-motion fallback works** (static `pyrotechnics-reduced` glows, 0 canvases under `prefers-reduced-motion`).

### W4 — Adversarial review + verification
4 diverse-lens skeptics attacked the diff (scale/correctness, crescendo/perf/hooks, regression/types, fail-soft/a11y). **22 findings confirmed non-bugs** (serialized lock-in queue can't blow the particle ceiling; appended tint sprites can't corrupt `whiteSprite`; no cross-device leakage; engine not reset mid-ramp; reduced-motion no-ops; etc.). **1 real HIGH bug found → FIXED:** enabling `hasCeremony("july")` made the player phone's `PlayerLockInBolt` (a LIGHTNING bolt, gated on generic `hasCeremony`) fire on July phones. Fix: gate the bolt on `ceremony === "lightning"` (`app/(player)/room/[code]/page.tsx:434`) + a registry regression test. Lesson: `opting-into-a-shared-registry-flag-flips-every-consumer-on-every-surface`.

## Verified by
- `npm test` → **820 passed / 8 skipped** (136 files), exit 0. New tests: registry July + gate, `fireLockInBurst` pub/sub, TVLockInCeremony dispatch fork, crescendo ramp math.
- `npx tsc --noEmit` → only the 2 known pre-existing `HostHomeClient-founder-build.test.tsx` errors.
- eslint (run directly; `npm run lint` is project-broken on Next 16) → **0 new problems** in my files; the player route lints byte-identically to committed HEAD (16 problems, all pre-existing baseline).
- Live `/dev` sweep: cohesion good, marquee renders, reduced-motion fallback confirmed, canvas path mounts cleanly (13 canvases, no errors from this code).

## NOT runnable here (carry to a real device — same as Phases 2/3)
Headless Playwright won't paint canvas frames deep in the `/dev` gallery (documented `headless-canvas-screenshot-isolate-frame`), so the literal motion of the lock-in firework tint + the finale ramp is unconfirmed visually here. Substituted by the unit-proven dispatch/pub-sub/ramp math + healthy canvas mount + adversarial review. Confirm the lock-in fireworks + crescendo on a real TV/phone before any deploy.

## Hard constraints honored
Commit-only (no push/merge/deploy — Brandon's call). The 3 uncommitted host files (`app/dev/host/page.tsx`, `app/host/live/[nightId]/HostLiveConsoleClient.tsx`, `components/host/HostLiveConsole.tsx`) + `tasks/todo.md` + untracked reports/jpegs left untouched.

## Optional follow-up (Brandon's call, not done)
For fuller "mirror May" phone parity, July phones could get a firework flourish on lock-in (mirroring May's phone bolt) — e.g. dispatching `fireLockInBurst` on the phone's own engine. Deferred: July phones already erupt with earned reveal fireworks (Phase 3), and the chosen scope was the TV ceremony. Small follow-up if wanted.
