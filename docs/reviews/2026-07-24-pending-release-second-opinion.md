# TR1VIA — Independent Second-Opinion Review of the Pending Release

**Date:** 2026-07-24
**Reviewer:** Claude Code (independent audit)
**Subject:** PR #162 `codex/prevent-trivia-night-recurrence` → `main` — "Prevent live-game sync and standings failures" (adds migrations `0031`, `0032`)
**Method:** Read-only audit of the actual diff (`git diff main..pr162`) plus the already-merged fixes on `main`. No paid AI/image calls. No production changes. Stated statuses were not trusted; every verdict is grounded in code.

---

## Bottom line

**Do not approve the release *as-is* — but do not shelve it either.**

The pending release contains genuinely good, well-tested engineering that fixes several of the real failures from Heather's night. However, **this same release introduces a regression to Heather's core host interaction** (question select → show), and it ships alongside **two still-open live-show failures** (live multi-answer disputes; identically-named players) and **no venue-scale proof** of the freeze fix. The right move is to **amend the PR** (remove the one-tap regression, add a venue-scale check), not to sit on it.

One reframe the brief understates: **the emergency fixes already in production (#160, #161) do *not* fix the dominant cause of the 30–45s freeze.** Only *this* pending release does. So "keeping the merge blocked" currently leaves production carrying the worst live bug. The goal should be to get this mergeable quickly, not indefinitely.

I agree with the reviewer's overall "do not approve yet," with two corrections: I am **more** certain than they were about Issue 3 (the one-tap change is not a risk — it is implemented, and it is a regression), and **less** alarmed on Issue 7 (a dependable complete leaderboard *does* exist — for the host).

---

## Verdict table (all 29 issues)

Legend: ✅ Fully solved · 🟡 Partially solved · ❌ Not solved · 🔬 Cannot prove from code (needs live/venue test) · ⛔ Regressed by this release

### Live-show failures
| # | Issue | Verdict | One-line basis |
|---|-------|---------|----------------|
| 1 | 30–45s freeze between questions | 🟡 + 🔬 | Dominant N² answer-storm fixed **only in pr162** (`useRoom.ts` skips refetch on `answer_progress`); #160/#161 fix two lesser causes. Residual synchronized N-request burst per transition; coalescing is per-serverless-instance; **no venue-scale healthy-path load test in CI** → survives-another-game = Cannot prove. |
| 2 | Host phone / TV / player phones showed different moments | 🟡 | New durable `advance` event (`0032` + `/api/games/[id]/advance`) makes "return to standings" shared state, not component-local UI. Solid mechanism; full multi-device proof missing. |
| 3 | Select-a-question vs. show-it-publicly confusing | ⛔ **❌** | **Regressed.** pr162 makes the phone board **one-tap-to-reveal** (`HostPhoneClient` `onSelect` now calls `void reveal()`; the private preview + explicit **"Show question"** step is deleted — see test renames). Opposite of what Heather needs; a surprise change to the protected host flow. |
| 4 | Some players never got the correct/incorrect screen | 🟡 + 🔬 | Each phone now refreshes its signed snapshot after resolve settles (`onResolveSettled` in `page.tsx`), recovering even if it missed the broadcast. Real mechanism; visible player-phone proof at scale still missing. |
| 5 | Players didn't reliably get points / total / position | 🟡 + 🔬 | Same `onResolveSettled` reconcile + tie-aware `rankScores` everywhere. Mechanism solid; cross-device proof missing. |
| 6 | Inconsistent/missing standings across surfaces | 🟡 | Durable `advance` + single canonical `rankScores` ordering on every surface. Exact-screen-per-device proof incomplete. |
| 7 | No dependable complete leaderboard at finale | 🟡 | **The host has one:** `HostScores` lists *all* players, searchable, tie-ranked. Every *audience-facing* surface is capped (TV finale = winner + 2; TV leaderboard = top 10; host between-games screen = top 5). "Only presents a limited number" is true of the **TV**; "no dependable complete leaderboard" is overstated. |
| 8 | Dead end after Game 1, couldn't start Game 2 | 🟡 + 🔬 | Intermission screen wires **Start Game 2** (`runStartGame(game2.id)`); PR claims controlled test passed. Venue proof pending. |
| 9 | Game 1's final answer stuck into Game 2 | 🟡 | Reveal/resolution is now `gameId`-scoped (`belongsToCurrentGame`, resolution-anchor by current game). Lifecycle test touched. |
| 10 | Manual questions didn't consistently appear | ✅* + 🔬 | Core defect fixed by `0031` (board slot sets `is_picked` **and** `point_value` atomically). Full create→edit→save→play E2E not proven. *Fix lands only when pr162 merges. |
| 11 | Unexpected questions (China/Snipe/Earl Grey/Sabine) | 🟡 | Two causes: (a) off-topic generation — solved in `main`; (b) "saved selection ≠ played question" — a **real bug in `main`**, fixed only by pr162's `0031`. |
| 12 | Category-inappropriate (king cobra in "non-venomous") | ✅ | `fitsRequestedTopic` is part of certification, fails closed, with the exact snake example + tests (`verify-answers.ts`, `collect-verified-questions.ts`). Merged. |
| 13 | Joker — multiple defensible interpretations | ✅ | Ambiguity is **actively rejected** (not just flagged), fails closed, requires all passes to agree. Caveat: depends on the Opus verifier's judgment; the deterministic regex is advisory only. |
| 14 | Award points to multiple defensible answers, live | ❌ | No "accept alternate answer" path exists. Only per-player manual adjustment = **N separate modal submissions**. Worse: the answer-result screen never lists *who* chose a given wrong-but-defensible option, so the host can't even see whom to compensate. pr162 doesn't touch this. |
| 15 | Identically-named players indistinguishable | ❌ | `display_name` has no uniqueness/disambiguation; `rankScores` explicitly "never break[s] a tie by name." Per-player color exists but is absent from every scoring/standings/host surface. |
| 16 | Mixed Wi-Fi + cellular not stress-tested | 🔬 | Resilience mechanisms exist and are individually tested, but there is **no realistic mixed 20–40-client healthy-path load test** (the closest is N=8, degraded-path-only, not in CI). Reviewer confirmed accurate. |
| 17 | Rare timing conflicts change state after lock | ✅ | Well-fenced: row locks, `control_revision` CAS, idempotent command receipts, advisory locks. `0031`/`0032` both covered by integration tests. (One cosmetic-only redundant-broadcast note on the *legacy* reveal path.) |
| 18 | Full device matrix unproven | 🟡 + 🔬 | Host surfaces have real emulated multi-viewport harnesses; **player phone, the real `/tv` route, and all non-Chromium/real hardware (iPhone/Safari, Android) are unproven.** |

### Game-building & presentation
| # | Issue | Verdict | One-line basis |
|---|-------|---------|----------------|
| 19 | Reported failure while still completing | ✅ | Stale-vs-terminal heartbeat logic + coalesced `drain()` before terminal write (`generation-heartbeat.ts`, `generation-job.ts`). Merged. |
| 20 | Partial generation stranded / repeated Continue | ✅ + 🔬 | `MIN_PLAYABLE_QUESTIONS = 7` resumable; bounded auto-resume; incremental refill. Confirm on next real build. |
| 21 | Resume reused the same image | ✅ | Per-URL de-dup (`seedCategoryImageUrls`/`excludeImageUrls`) + persisted `photo_query` (`0030`). |
| 22 | Original mode needed an image players never saw | ✅ | Prompt rule "must work without an image" **plus** `image_required` is one of only two *blocking* deterministic risk flags. |
| 23 | Long waits without progress/reassurance | ✅ | Per-phase human status lines (`generationProgressFromRow`) + heartbeat. |
| 24 | iPhone host got a broken cropped desktop page | ✅ | Dedicated `HostPhoneClient`, routed at ≤860px; old route redirects; tested. |
| 25 | Venue-TV preview cropped/letterboxed | ✅ + 🔬 | True contain-fit (`fitTVCanvas`, `ScaledTVCanvas`) — letterboxes, never crops. Full real-TV resolution matrix unproven. |
| 26 | Links/QR codes not clearly distinguished | ✅ | One clearly-labeled player QR ("Players — scan to join this game"); account-first host entry; tested. |
| 27 | Venue-TV text hard to read at distance | 🟡 + 🔬 | `useAutoFitText` sizes the prompt; but marquee names are ~16px logical (~19px @1080p), the contrast test covers only buttons, and there is no venue-distance test. pr162 does not improve readability. |

### Cost & validation
| # | Issue | Verdict | One-line basis |
|---|-------|---------|----------------|
| 28 | Automated testing spent real money | ✅ | Every automatic CI path is zero-cost (no keys passed; SDKs throw before any call); paid generation is behind a manual, default-`false` gate, locked by `prod-smoke-budget.test.ts`. |
| 29 | Normal game creation may cost too much | 🟡 | Bounded and instrumented (~$0.10–0.15/category; ~$1.20–1.80/auto-built game; cost persisted per accepted question). Dominant cost = **2× full Opus verification**, intact by design (accuracy). Reroll has no rate limit. |

---

## The findings that matter most

### 1. Issue 3 is a regression, and it's the single strongest reason to hold the release
The brief said the proposed one-tap behavior "may make this worse." The code confirms it **does**:

- Before pr162, tapping a board cell on the host phone **staged** the question into a private preview (`HostPhoneUpcoming` — "Host private · Not on TV," showing the correct answer + fact), and the host then tapped an explicit **"Show question"** button to publish it. A two-step: *private select → show*.
- pr162's `HostPhoneClient` board handler now calls `void reveal(questionId)` on the tap itself, and `reveal()` dropped its "only reveal the staged question" guard. The test suite was rewritten to enshrine this: `"…without privately previewing a question until selection"` → `"…with one tap"`, and `"returns from private preview to the board without revealing"` → `"does not require a private confirmation screen before revealing"`, with every `click "Show question"` step deleted.

Net effect: **one tap now starts the game (on the first cell) and/or publishes the question to the TV and every player phone, with no private preview and no confirmation.** A mis-tap is instantly public; the only recovery is the 2-second Undo. This is the opposite of Heather's stated need (an *unmistakable private selection followed by an explicit Show Question*), and it is a by-surprise change to the protected "Heather's Classic" host flow, which the product doctrine explicitly forbids (`docs/product/…-vision-and-scope.md` §2: "Not allowed by surprise: changed host-led flow").

*Fair counter-view:* one-tap is faster and matches the laptop console (which has always revealed on grid-cell click). But making it the **default for Heather, by surprise, removing an existing private-preview capability** is exactly the kind of change the doctrine says must be opt-in, not silent.

### 2. Issue 1 (the freeze) — pr162 is *necessary*, and it's unproven at scale
The 30–45s freeze had three root causes. The two emergency fixes already in production only address the smaller two:
- **#160** removed a host-auth middleware storm on `/api/*` (fully fixed).
- **#161** coalesced room-wide snapshot reads (partial — per-serverless-instance only).
- The **dominant** cause — every confirmed answer waking every phone to refetch a full signed snapshot, i.e. **N answers × N phones ≈ N² heavy reads per question** (~1,600 at 40 players) — is fixed **only in pr162** (`useRoom` now ignores `answer_progress` wake-ups; the per-player `useLockCount` poll was also removed).

So production *today* still carries the worst offender. That is a strong argument to ship pr162 — but with eyes open: a synchronized **N-request burst per transition** remains on the healthy path (no jitter), coalescing doesn't span Vercel instances, and **nothing in CI drives 20–40 concurrent clients through a healthy answer→reveal cycle**. "Will survive another comparable venue game" cannot be proven from the code.

### 3. Issue 7 (complete leaderboard) — better than the brief implies, but not audience-facing
A dependable complete leaderboard **does** exist: the host's **Scores** tab (`HostScores`) ranks *all* players with proper competition ties (1, 2, 2, 4) and is searchable, reachable at any time including the finale. What's capped is every *audience* surface — the TV finale shows the winner + two runners-up, the TV leaderboard shows top 10, and the host's finale *screen* shows top 5. If the promise is "the TV shows the full final standings," that's unmet by design; if it's "the host can dependably read the complete standings to announce winners," that is now met and improved.

### 4. Issues 14 & 15 are genuinely unsolved live-show failures
- **14 (live disputes):** there is no way to award a second defensible answer in one action; the host must open the adjust-points modal once per player, and the post-reveal screen doesn't even show *which* players picked a given wrong option.
- **15 (identical names):** two different devices can both be "Jordan" and stay indistinguishable on every scoring surface; the release's new ranking code explicitly does not address names.

Both were failures on the night. Neither is touched by this release.

---

## Additional player/host-visible failures discovered (beyond the 29)

- **A. Accidental public reveal (new, from Issue 3):** a single mis-tap on the host phone board now instantly starts the game and/or publishes a question to the whole room — no confirm, only 2s Undo.
- **B. Complete standings are host-only:** players ranked 11–40 never see a full board on any surface; they see only their own rank + a ±4 neighborhood.
- **C. Host is blind to whom to compensate (Issue 14):** `HostAnswerResult` shows only aggregate per-option counts and the correct fastest-five — never the list of players who chose a specific wrong-but-defensible option.
- **D. Manual-authored questions bypass ALL certification** (`categories/[id]/manual`): host-typed questions reach live with no fit/ambiguity/correctness check (by design, but a real quality gap given Issues 11–13).
- **E. Deterministic multi-answer/superlative/time/geography risk flags are advisory only:** ambiguity blocking rests entirely on the probabilistic Opus verifier; the deterministic regex never blocks.
- **F. Snapshot-storm coalescing is per-serverless-instance** — it does not coalesce a burst spread across concurrently-spun Vercel instances.
- **G. No venue-scale healthy-path load test in CI** — the 40-player race test (data-correctness only) and the N=8 connection-load test are manual-only and excluded from `npm test`, the release gate.
- **H. Reroll ("Another 20") has no rate limit** — each reroll pays a full generate + 2× Opus verify.

---

## On the reviewer's "not software defects" list
Reasonable. One code-backed confirmation: ending a question early after all eligible players answer **does** confirm eligibility rather than guess — eligibility is frozen and reconciled in the resilient answer engine (`deriveAllLockedAutoRevealDecision` + `0018` atomic all-locked resolution), so this is a sound pacing choice, not a guess.

---

## Recommendation

**Do not approve the release in its current form.** To flip to approve, the smallest responsible change set is:

1. **Revert the one-tap reveal (Issue 3).** Restore an explicit *private select → "Show question"* step on the host phone (and consider the same private-preview affordance on the laptop). This is the blocker most in tension with Heather's protected flow. *(Blocking.)*
2. **Add a venue-scale, mixed-connection, healthy-path check for the freeze fix (Issue 1/16)** — even a scripted 30–40-client snapshot-load run — and ideally wire the existing 40-player race + connection-load specs into CI. *(Blocking for confidence, given this release exists specifically to prevent a freeze recurrence.)*
3. **Decide explicitly on Issues 14 and 15.** They are real and unsolved; if they're accepted as follow-ups rather than blockers, say so on the record rather than letting the release imply they're handled.

Everything else in the PR — the durable standings transition (`0032`), the atomic board-slot fix (`0031`, which fixes the real "saved ≠ played" bug), the N² freeze fix, tie-aware ranking, and Game-2 continuity — is solid, tested, and worth shipping. Ship it *after* the one-tap regression is removed and the freeze fix has at least one venue-scale proof.

*Migration/ordering note:* `0031` replaces `swap_point_value` and `0032` adds an `advance` reveal event + RPC — both are additive and service-role-only, but must be applied **before** the app deploy, per the PR's own release gate.
