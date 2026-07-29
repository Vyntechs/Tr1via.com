# Wednesday readiness — coverage map & edge-case checklist (2026-07-28)

Ordered highest-leverage → lowest (likelihood × impact). Work top-down.
Status: ✅ proven · 🟡 partial · ⬜ untested (GAP) · 🔴 known bug (open, needs fix)

**Global caveat:** every ✅ = tested against LOCAL dev server + real LOCAL Postgres, NOT a live
30–40 person crowd on venue WiFi + hosted Vercel. Hosted-serverless load and real venue networks
are unproven (see INFRA GAPS). Load proven: 40→120 players, 0 freezes/errors, DB loafing.

## TIER 1 — every show, every game (fix/verify these first)
1. Mass player join (QR/code) at scale — ✅ 40–120 players, 0 errors, 0 freezes.
2. Player: see question → pick → lock in (the answer write path at scale via real UI) — 🟡 component-tested only; the scramble/live-answer-engine WRITE path was NOT load-tested through the real UI at 40+. **GAP.**
3. Host reveal a question (single device) — ✅ (drove 21 reveals).
4. Host resolve / advance a question — ✅.
5. Player sees their reveal + points, **Game 1** — ✅.
6. TV shows question / reveal / standings, Game 1 — 🟡 works, but 🔴 **Bug #3** (stumper reveal prints a canned "700 / 70-pt bonus" point line regardless of real points; falls back to a canned "honey" fun-fact when the question has none. Question & category ARE correct.)
7. Scoring correctness per game — ✅ unit/integration.
8. Snapshot poll load between questions — ✅ (load test).
9. Bad-WiFi fallback: host+player surface the "hotspot" message and self-heal — ⬜ **GAP** (my local outage sim was broken — the block glob didn't match the local DB — so this was NOT actually verified; code is wired correctly per source).
10. Mass reconnect after a WiFi blip — 🔴 **Bug** (players' first fetch has no jitter → stampede) + fallback UI unverified (#9).

## TIER 2 — most shows
11. Two-game night (Game1 → intermission → Game2 → finale) — 🔴 **Bug #1** (Game-2 players go blind; only Game 1 + Game 2 Q1 ever completed end-to-end). **Everything past Game 2 Q1 is UNTESTED.**
12. Player opt-IN to Game 2 — 🔴 **Bug #1**.  Opt-OUT of Game 2 — ✅.
13. Host runs a FULL game from PHONE only — ⬜ **GAP** (this session did mixed, not phone-only).
14. Host MIXED phone + laptop — 🟡 tested → found 🔴 **Bug #2** (cross-device undo resurrects a stale/wrong reveal on the TV-fed laptop) + 🔴 **Bug #4** (double auto-reveal → spurious host error toast).
15. Finale / "Present winners" ceremony button — ⬜ **GAP** (bypassed in the test; winner-by-value ✅).
16. Question generation (host builds the game) — ⬜ mocked all session; 🔴 silent-hang on vague/hard topics (diagnosed, UNFIXED). "Load failed" on cellular — ✅ fixed (#165).

## TIER 3 — common-ish
17. All-locked auto-reveal — ✅ + 🔴 **Bug #4** (two host surfaces double-fire).
18. Late joiner mid-game — 🟡 (a latecomer case passes; not exhaustively).
19. End game early — ✅.
20. Undo, single device within 2s — 🟡.  Cross-device undo — 🔴 **Bug #2**.
21. Host reveal flicker / stuck-on-old-question — ✅ (the #111 trigger fixed) but 🔴 a NEW trigger = Bug #2.

## TIER 4 — less common
22. Standings TIE — 🔴 **Bug** (TVGrid duplicate React key → rows can duplicate/mis-render).
23. Player disconnect/reconnect mid-question — ⬜ **GAP** (not UI-verified locally).
24. Reset-night-to-setup / re-open a night — ⬜ **GAP**.
25. Recap / "Won" screens after close-night — ⬜ **GAP**.
26. Room Magic reactions on TV — 🟡 (tests exist; the tie-key bug surfaced here).
27. Mobile host small-screen usability — 🔴 (Start Game 1 below the fold on 320px; Room Magic toggle < 44px tap).

## TIER 5 — rare / least likely
28. Seasonal ceremonies (May lightning / July fireworks) — 🔴 TV "who buzzed in" marquee starved of realtime (only 4s poll).
29. Long / emoji / special-char player names — ⬜ **GAP**.
30. Auto photo attach (Pexels) — ⬜ mocked, untested.
31. Mixed real networks (hotspot + cellular + WiFi) at 30–40 devices — ⬜ **GAP** (can't simulate; architecture audited sound 2026-07-01).

## INFRA / ENVIRONMENT GAPS (structural, not per-feature)
- **Hosted Vercel serverless under load** — ⬜ the isolated prod-mirror attempt FAILED (prod schema isn't in tracked migrations, so a Supabase branch comes up empty). Only local-dev load is proven.
- **Real Anthropic generation quality** — ⬜ mocked all session.
- **DB rebuild from `supabase/migrations/`** — 🔴 broken (migrations don't grant table privileges; a clean rebuild comes up unusable). DR/reproducibility risk. This is ALSO why local E2E needs a hand-applied grant reconstruction (see 2026-07-27 handoff).

## OPEN BUGS consolidated (fix order = leverage)
- ~~**HIGH #1**~~ — ✅ **FIXED 2026-07-28** on branch `fix/game2-player-blind` (commit-only, NOT pushed/merged/deployed — founder's call). `isWaitingForGame2FirstQuestion` now takes a durable `game2FirstQuestionPlayed` latch (any Game-2 question with `played_at` set) that shuts the gate permanently; the player page derives it from `allQuestions` + `questionGameMap`. Proof: the regression test went RED at its assertion → GREEN after the fix; 4 new unit cases in `tests/unit/betweenGames.test.ts`; full suite 1755 passed / 8 skipped / 0 failed; `npx tsc --noEmit` clean. Original diagnosis, for the record:
- ~~**HIGH #1**~~ (original entry) — Game-2 players lose all reveal feedback. `app/(player)/room/[code]/page.tsx` (~498-533) + `lib/player/betweenGames.ts` `isWaitingForGame2FirstQuestion`: gate uses "is a Game-2 question live *now*" (goes null on resolve) → re-shows the waiting screen. Fix: gate on "has Game 2's first question ever *finished*" (durable flag / lastResolvedQuestion game), not live-now. Regression test exists: `tests/e2e/mixed-device-host.spec.ts` (-g "REGRESSION: a player who opted").
- **HIGH #2** — cross-device undo leaves the TV-fed laptop on stale state. ⚠️ **Diagnosis disputed by the 2026-07-28 proof run** — the reproduced symptom is the laptop keeping the undone question **LIVE** (timer still counting), not a resurrected *reveal* screen. The original analysis (`lib/host/roomToTVSnapshot.ts:196-235` + `lib/host/deriveHostMode.ts` `durableAdvance` gating on the single latest `currentReveal` broadcast tag) may be the wrong path. **Re-diagnose before fixing.** Regression test: `-g "must not resurrect"` (fails correctly at its assertion, line 680).
- **MED #3** — stumper canned point line / fallback fact. `components/tv/TVStateMachine.tsx:740-750` never passes `pointBlurb` to `<TVRevealStumper>`; defaults in `components/tv/TVRevealStumper.tsx:75-79` render. Fix: pass real point blurb (+ ensure fact default is neutral). Deterministic on ≤4-correct reveals.
- **MED** — player reconnect stampede (no jitter), `lib/hooks/useRoom.ts` ~384-561/851.
- **MED** — TV realtime marquee starved, `lib/hooks/useTVRoom.ts` (no `answer_progress` handler).
- **MED** — standings tie duplicate key, `components/tv/TVGrid.tsx:290`.
- **MED** — generation silent-hang on vague topics (diagnosed only).
- **LOW #4** — double auto-reveal toast, `lib/hooks/useAllLockedAutoReveal.ts` on both host surfaces.
- **LOW** — mobile Start below fold (`components/host/HostGameReady.tsx`) + Room Magic toggle tap size (`app/host/setup/[nightId]/HostSetupOverviewClient.tsx:474`).

## NEXT ACTIONS (highest leverage first)
1. Confirm from Brandon: **does Heather run 2 games or 1? phone-only, laptop-only, or mixed?** (decides if #1/#2/#4 are mandatory pre-Wednesday).
2. Fix **Bug #1** (Game-2 blind) — highest impact; regression test already written.
3. Fix **Bug #2** (cross-device stale reveal) — audience-visible.
4. Verify the two GAPS that hide behind other bugs: full 2-game finale (after #1), bad-WiFi fallback UI (fix the local outage-sim glob first).
5. Then #3, tie-key, reconnect jitter, marquee, then LOWs. Each PR-first, deploy only when no show is live.

## TEST AUDIT (2026-07-28, end of session) — read before trusting the regression tests
Audited `tests/e2e/mixed-device-host.spec.ts` line-by-line. Verdict:
- **2 `REGRESSION:` tests are REAL, not theater** — one bug each, one product assertion each:
  - line 703 (Game-2 blind, HIGH): asserts opted-in player sees reveal, not the waiting screen (754-759).
  - line 619 (cross-device undo stale reveal, HIGH): asserts old reveal does NOT resurrect on laptop (680-681).
- ~~**BUT they are UNPROVEN**~~ → **PROVEN 2026-07-28 (later session).** Both were run against the
  local stack and watched go red **at their product assertion line**, not in setup. Details below.
- **The 190-line journey test (line 407) SWALLOWS confirmed bugs** — the auto-reveal error-toast
  race (and originally the undo desync) are captured into a non-failing `ctx.findings` array that
  only `console.log`s. So a GREEN journey run OVERSTATES safety; it can pass with known bugs live.
  **Fix: make it a pure happy-path journey; let the dedicated regression tests own the bugs.** The
  two regression tests are the right size; only the journey test is over-scoped.

## PROOF RUN (2026-07-28, later session) — both regression tests verified RED for the right reason

Local stack: Docker + `npx supabase start` (schema and the anon/authenticated grants survived from
the prior session — **no `db reset` was run**, so no grant reconstruction was needed); dev server
`TEST_AUTH_ENABLED=1 TEST_SECRET=local-test-secret MOCK_EXTERNAL=1 npm run dev`.

**⚠️ Run these ONE invocation at a time.** The suite is `test.describe.configure({ mode: "serial" })`
with `workers: 1` and shares one dev server + one mutable local DB. I accidentally launched three
concurrent `npx playwright test` invocations; they raced each other's login/seed state and produced
three *different* failure points (one of them in setup at line 666, which would have read as a
cried-wolf false alarm). Only single-invocation runs below are trustworthy.

Also note: serial mode means a failure in the first test **skips** the second ("1 did not run").
Each test must be run alone via `-g` to get its own verdict.

### ✅ Test at line 703 — Game-2 blind (HIGH #1) — PROVEN REAL, diagnosis CONFIRMED
`-g "a player who opted into Game 2"` → fails at **line 758**, the product assertion (`toPass`
waiting for a reveal screen). The accessibility snapshot of Alex's phone at failure is the exact
symptom the comment predicts:
> `HALFTIME · GAME 2 NEXT` / "Game 2 starts when your host is ready." / "You're in Game 2." /
> "Waiting for your host to choose the first question."

Player regressed to the pre-game waiting screen after Game 2's Q1 resolved. **Test and root-cause
analysis both hold. Fix as written** (gate on "has Game 2's first question ever finished", not
"is a Game-2 question live now").

### ⚠️ Test at line 619 — cross-device undo (HIGH #2) — FAILS REAL, but the DIAGNOSIS DOES NOT MATCH
`-g "must not resurrect"` → fails at **line 680**, the product assertion (question B's cell never
comes back on the laptop). Reproduced identically on two separate single-invocation runs.

**But the on-screen symptom is NOT the one the comment describes.** The laptop is not showing
question A's stale *reveal* screen. The accessibility snapshot shows the laptop still rendering
**question B as LIVE** — category "Pixar movies", "Sample question 2 (easyish)", a running
`30 seconds remaining` timer, "0 / 1 locked", and a live "Show answer now" button — a full 8s after
the test's own `waitForSnapshot` confirmed the server had durably reverted the undo
(`liveQuestionId === null`, `playedAt === null`). Assertion 681 (`tvReveal` count 0) would very
likely have PASSED; there is no reveal screen on that page at all.

So the real bug here is: **the host laptop does not follow a phone-initiated undo — it keeps showing
the pulled-back question as live while the server says it is gone.** Still audience-visible (that
laptop is HDMI'd to the venue TV), still HIGH, still the same "laptop stuck on stale state" class —
but the written root cause (`roomToTVSnapshot.ts:196-235` synthesizing a stale `currentReveal`,
`deriveHostMode`'s `durableAdvance`) is pointing at the *reveal-resurrection* path, which is not what
this run reproduces. **Do NOT start the fix from that analysis — re-diagnose against the live-question
path first**, then either correct the comment or split it into the right assertion. The test itself is
sound and can stay red as the guard; only its explanation is suspect.

## ENV STATE
Branch `main` @ `9de1e05`. Local Docker may be down (it died once this session) — restart:
`open -a Docker` → `npx supabase start` → **re-apply grant reconstruction** (see 2026-07-27 handoff for exact SQL; a `db reset` wipes it). Dev server: `npm run dev` (nohup), reuseExistingServer for Playwright. New test file this session: `tests/e2e/mixed-device-host.spec.ts` (2 regression tests intentionally RED = the 2 HIGH bugs).
