# TR1VIA — Handoff

**Read order:** this → `MEMORY.md` (auto-memory) → `tr1via-plan.md` (rules) → `docs/superpowers/plans/2026-05-23-tr1via.md` (build plan) → `supabase/README.md` (DB) → `README.md` (run).

---

## Critical context

**Wednesday 2026-05-27 is the real go-live.** This is NOT a demo — Heather (the customer, `heatherhmoore@yahoo.com`) opens it that night to host actual trivia at her venue. ~3 days from this handoff (Sun 2026-05-24 ~12:45pm).

**Neither Brandon nor I have driven a full end-to-end game on prod yet.** Every session has hit a bug somewhere in the loop. The Wednesday product has to survive Heather actually running it for paying patrons.

---

## State as of 2026-05-24 (end of session 5, ~12:45pm)

**Main commit tip:** `b3625e9` — TV panel honors 16:9 + reveal stays until host advances.
**Test count:** 192/192 unit + component passing. TypeScript clean.

### Accounts in prod

| Email | Role | Notes |
|---|---|---|
| `brandon@vyntechs.com` | **founder** | Founder bypass at `/login`. `is_paywall_bypassed=true`. |
| `brandon.james.nichols@gmail.com` | host | Older account, still active. |
| `heatherhmoore@yahoo.com` | **host** | Provisioned this session. `display_name="Heather"`, `default_venue="Heather"`, `is_paywall_bypassed=true`. She signs in at `tr1via.com/login` → magic link via Supabase SMTP (yahoo delivers reliably). Backup magic-link generator: `node --env-file=.env.local scripts/generate-magic-link.mjs heatherhmoore@yahoo.com`. |

### What was shipped in session 5 (today)

18 commits, all behind the smoke gate. Each ships an issue Brandon hit in real-time. **Read git log -25 for the full chain.**

Key fixes by category:

**Setup flow / "Open the room":**
- `bbd6d4c` Drop "≥1 per game" gate to "≥1 anywhere" so a single category opens the room.
- `7867614` Modal scroll fix (edit/swap/upload modals were clipped — Save button unreachable).
- `a517258` Wired the SHORTCUTS sidebar (was dead `div`s) + shipped 5 Coming Soon placeholder pages.

**Realtime gameplay flow:**
- `5d9b25f` Added `useRoom.lastResolvedQuestion` so phones see PlayerRevealCorrect/Wrong after a question resolves. The previous `pickRecentReveal` was a stub returning null.
- `0724e15` Kicked players bounce out via heartbeat 410 (postgres_changes drops for device-cookie sessions).
- `a3b9505` Fixed every player getting 403 on answer submit. Root: prod creates games in `'draft'`, `_test/seed-night` creates `'ready'`, `/api/players` only auto-added participation for `'ready'/'live'`. Backfilled 6 rows for active nights. **This single bug class is the test-fixture-vs-prod divergence; see "What still needs to ship" → P0.27.**
- `48b6bb7` Resolve fires from `LockedView` too. Previously `handleZero` was only in `QuestionView`, so when all players locked in early the timer expired with no one mounted to call `/resolve`.
- `a43461b` `useMyAnswers` refetches from REST on every broadcast. Previously all players saw "wrong" because `is_correct` was set by the resolve route but never reached the phone (postgres_changes UPDATE silently drops).

**Visual surfaces:**
- `44df15e` + `f702eca` Join QR + code panel on host live console (was: no QR for host; was: panel disappeared once 1 player joined).
- `44df15e` Pexels photo now renders on TV question (was missing entirely during play).
- `d47d85b` Embedded the TV view as a 16:9 iframe in the top half of `/host/live/[nightId]` — host laptop HDMI'd to a TV no longer needs two browser windows. **This is the iframe MVP; proper extraction is P0.26.**
- `b3625e9` Removed the auto-leaderboard transition. Reveal stays until host clicks next cell.

**Theme system (was player-side; now host-controlled per-night):**
- `27fc3f0` Removed player-side theme picker (was auto-opening 2s after lobby).
- `0b2f8f8` + `6f36017` Built host-side theme picker on `/host/setup`. Floating "Theme · <key>" button → bottom-sheet picker → PATCH `/api/nights/[id]/theme`. Single host-chosen palette per night.
- `0c3d53b` ThemeProvider now syncs from prop on every render (was: `useState(initial)` froze at first render, host had to hard-refresh to see a new pick).
- `aa2dcf4` Threaded `night.theme_key` through every host route (`/host/setup/...`, `/host/live/[nightId]`). Previously the theme reset to "house" when navigating between setup sub-pages.

### What is still broken or unverified

**The full game loop has never been driven end-to-end without a bug appearing.** Every session has caught something new. Possible remaining issues that have NOT been tested with all the new fixes stacked:

- Full game-1 (7 reveals across one category) on prod, multi-phone, with all session-5 fixes live.
- Game 1 → intermission → game 2 → finale leaderboard.
- 3+ phones playing simultaneously on prod (we've only tested 1-2).
- Theme change MID-GAME: if Brandon swaps theme after opening the room, already-joined player phones don't repaint (need a broadcast on `room:{code}` for `theme-change`).
- Tie / no-leader / all-zeros leaderboard handling — current sort is `score DESC` only; no tiebreaker logic.

---

## What still needs to ship by Wednesday

Prioritized punch list (created as TodoWrite tasks 26-31 in session 5):

### P0 (must ship)

**P0.26 — Replace iframe TV-merge with proper extraction.**
Tonight's `d47d85b` embedded `/tv/[code]` as an iframe in the host page. Works but:
- Iframe makes its own `/api/tv/[code]/snapshot` fetch (double network + double WebSocket subscription on `room:{code}`).
- TV components designed for 100vw/100vh viewport, partially letterboxed in iframe even with `aspect-ratio: 16/9 + maxHeight: 62vh`.
- Iframe boundary prevents shared state, can't trigger TV-state animations from host actions.

Architect agent already designed the proper fix (~245 LOC):
1. Extract `TVStateMachine` from `app/tv/[code]/page.tsx` into `components/tv/TVStateMachine.tsx`.
2. Write `lib/host/roomToTVSnapshot.ts` — pure adapter from `RoomSnapshot` to `TVSnapshot`.
3. `HostLiveConsole` renders `TVStateMachine` inline using the host's existing `useRoom` data — no iframe, no duplicate subscription.

**P0.27 — Close the test fixture / prod divergence.**
The single highest-leverage thing in this entire list. The participation bug, the kicked-player bug, the reveal bug, the all-locked-no-resolve bug — all four lived in code paths that the Playwright e2e fixtures bypassed because `_test/seed-night` creates games in `'ready'` state while prod creates `'draft'`.

Two ways to fix:
- (a) Change `_test/seed-night` to call the real `POST /api/nights` (no shortcut).
- (b) Change prod default to `'ready'` (game.state is just a label).

Then add a single mega-spec: `tests/e2e/full-flow-prod.spec.ts`. Creates a real night via the UI, generates one category, joins 2 phones via the real `/join` flow, taps answers, asserts reveal correct/wrong, asserts leaderboard. Runs in CI on every push to `main`. **Brandon explicitly asked for this and is right to be frustrated that we don't have it.**

### P1 (should ship)

**P1.28 — Audit the 10 deferred items I flagged earlier.** See VERIFY-2026-05-24.md + my "any obvious bugs you neglected" reply in session 5:
- Pick-tier tie-break disagrees client ↔ server (lock query has no ORDER BY).
- `HostGenEdit` / `HostGenImageSwap` / `HostGenImageUpload` / `HostGenFlavor` still show placeholder StockImage (carried over from session 3).
- `TVReveal` doesn't show the image (only `TVQuestion` got it).
- 1 of 20 generated cards doesn't render on pick screen.
- `default_venue` null falls back to literal `"Soul Fire Pizza"` in `app/host/page.tsx:121` (leaks Brandon's venue name to other hosts).
- My new `tests/e2e/auto-start-on-reveal.spec.ts` regression test isn't in the CI smoke pipeline.
- Theme broadcast for live repaint (`room:{code}` event + listener in `useRoom`).
- "Open audience vote" + "Suggested by the room" tiles may be dead UI on setup overview.

**P1.29 — Venue-condition hardening.** Real-device dry run at 10-30 phones on real wifi. iOS Safari quirks (visibilitychange, touch event coverage, viewport). Latency under load. Multi-room concurrency.

**P1.30 — Ties, no-leader, all-zeros leaderboard.** Define + ship a real tiebreaker (proposal: fastest cumulative `ms_to_lock`, then alphabetical). Handle the all-zeros case gracefully ("nobody scored — running it back?" UX or just sort by join time).

### P2 (would be nice)

**P2.31 — Polish wave.**
- Phone-side fold/send animation Brandon designed (the "mind trick" of seeing the answer fold off the phone screen and arrive on the host's screen).
- Image on `TVReveal` (skipped in `44df15e` since Brandon's complaint targeted the question phase).
- Lock-in pile-up animation polish.

---

## How to resume (next session) — IMPORTANT

**Token efficiency is now a constraint.** Session 5 ended at 65% context (652k/1m tokens) after ~4 hours of manual MCP browser driving. The next session needs to be 10x more efficient.

### Step 1: Build an efficient prod E2E driver script

Before you do anything else, write `scripts/full-flow-prod.mjs` — an extension of the existing `scripts/prod-smoke.mjs` that drives a FULL game flow against tr1via.com via HTTP APIs only. No browser. No MCP.

The script:
1. Logs in as founder (already in `prod-smoke.mjs`).
2. Creates a night via `POST /api/nights`.
3. Adds a topic + generates a category (already in `prod-smoke.mjs`).
4. **NEW:** Picks 7 questions (PATCH each).
5. **NEW:** Locks the category (`POST /api/categories/[id]/lock`).
6. **NEW:** Opens the room (`POST /api/nights/[id]/open`).
7. **NEW:** Joins 2-3 simulated phones (each with its own `tr1via_device` cookie via `POST /api/session/init`, then `POST /api/players` with the room's nightId).
8. **NEW:** Clicks first cell (`POST /api/games/[id]/start` + `POST /api/games/[id]/reveal`).
9. **NEW:** Simulates phones tapping (`POST /api/answers` for each phone's session).
10. **NEW:** Calls `POST /api/questions/[id]/resolve` (the host's End Early).
11. **NEW:** Asserts via Supabase MCP: question.finished_at set, is_correct set per answer, awarded_points populated, game_scores reflects updates.
12. **NEW:** Repeats for the remaining 6 cells.
13. **NEW:** Game ends. Asserts game.state='done' and the leaderboard ordering.
14. Cleanup (delete the night).

The script should log ONE-LINE per step (✓ name) and only dump full state on failure. Token-efficient.

Estimated cost: ~5k tokens for a green run, ~15k for a failure (it dumps DB state). Compared to ~100k for an MCP-driven walkthrough of the same path.

### Step 2: Get the full flow green

Run the script. Whatever fails, fix. Don't manually drive the browser — let the script find the bug, then read the relevant file with grep+offset/limit. Stay below 200k tokens of session usage until the full flow is end-to-end green at least once.

### Step 3: Move into P0/P1

Once the flow's green, dispatch parallel agents on P0.26 (proper TV extraction) and P0.27 (full-flow e2e in CI). Both have complete design from session 5 agents — just need execution.

### Resumption prompt to paste into the next session

```
Read HANDOFF.md and /Users/bnipps/.claude/projects/-Volumes-Creativity-dev-projects-tr1via/memory/MEMORY.md.

Heather (heatherhmoore@yahoo.com) goes live on tr1via.com Wednesday 2026-05-27. This is not a demo — she'll be running real trivia for paying patrons. ~3 days.

Today (Sunday) shipped 18 commits of bug fixes but the FULL GAME LOOP has never been driven end-to-end without a bug appearing. Top priority for this session: get a complete game (open room → 7 questions revealed → answers tapped → resolves → reveal frames stay → leaderboard) working end-to-end on prod.

Token efficiency is a hard constraint. Don't drive Playwright MCP for end-to-end verification — write scripts/full-flow-prod.mjs (per HANDOFF.md "How to resume"). It's a node fetch-based script that exercises the full flow via HTTP APIs and asserts DB state via Supabase MCP. ~5k tokens per green run.

Workflow: write the script → run it → fix what breaks → re-run → iterate until full flow green. Only fall back to MCP browser if you have a real UX bug to verify.

Once green, move to P0.26 (proper TV-extraction, agent already designed it) and P0.27 (full-flow e2e in CI). Don't touch P2 polish until P0+P1 are done.

Operating principles:
- "Build without asking" (memory): commit to engineering choices yourself; only ask about product intent.
- "Validate, don't just claim" (memory): every fix verified by running the actual flow.
- "Heather's product, not a demo": defects ship to a real customer.
- Dispatch agents in parallel for sweeps (audit, refactor, test build) when you'd otherwise be blocked on CI.

Start by reading the HANDOFF "How to resume" section in detail, then begin writing scripts/full-flow-prod.mjs.
```

---

## Architectural lessons worth carrying forward (session 5 additions)

These add to the lessons in `docs/superpowers/plans/2026-05-23-tr1via.md` and prior HANDOFFs:

20. **Test fixtures that shortcut prod setup hide entire bug classes.** `_test/seed-night` skipped the `'draft'` state every real host hits. Four critical bugs all lived in that gap. Rule: tests must enter the same doors users do. Shortcuts in fixtures are debt that hides reality.

21. **postgres_changes silently drops for device-cookie sessions; broadcasts don't.** The architectural rule going forward: any state a player needs must be reachable via a broadcast or an explicit REST refetch. Never assume postgres_changes UPDATE events arrive. We've hit this 4 times in the past 24 hours (kick → heartbeat 410; reveal → lastResolvedQuestion via broadcast; is_correct → refresh trigger on broadcast; etc.).

22. **`useState(initial)` is a one-shot, not a binding.** If a provider takes a prop that might change, `useEffect` must sync the prop into state. ThemeProvider had been a "frozen on first render" trap that wasn't visible until a caller (the host picker) tried to actually change it.

23. **Optimistic UI without a confirmation handshake hides server-side rejection.** PlayerLocked flipped on tap regardless of whether `/api/answers` returned 200, 403, or 500. Players saw "locked in" while the server silently dropped the answer. Two fixes possible: (a) require server confirmation before locking the UI, OR (b) display the submit status (`useAnswerSubmit` already has `failed` state but it's just a small retry button — easy to miss).

24. **HDMI'd hosts make the "separate TV URL" design wrong.** When a host laptop IS the audience display via HDMI, two URLs become awkward. The merge into a single host surface is the architecturally correct fix. Iframe MVP shipped tonight; proper extraction is P0.26.

25. **One-fix-at-a-time reactive mode wastes time.** Session 5 spent 4h of context burning through Brandon-finds-bug → I-fix → Brandon-finds-next. Better workflow: dispatch agents in parallel for sweeps (audit, refactor, test infra) WHILE staying reactive on the main thread. Done correctly, parallel work uses CI wait time productively instead of idle.

---

## Files / artifacts from session 5 worth keeping

- `VERIFY-2026-05-24.md` — initial prod verification report from earlier in the day.
- `verify-1-pick-sidebar-filled.png`, `verify-2-tv-lobby-2-players.png`, `verify-3-tv-final.png` — screenshots from MCP prod drive.
- `scripts/prod-smoke.mjs` — the existing 30s API smoke. **Extend this into `full-flow-prod.mjs` per "Resume" step 1.**

---

## Memories worth carrying forward (auto-memory)

- `user_brandon.md` — non-technical solo dev, terse, "build without asking" style.
- `feedback_build_without_asking.md` — commit to engineering decisions, only ask about product intent.
- `feedback_validate_dont_just_claim.md` — drive the actual user-visible flow before claiming "fixed."
- `project_test_isolation.md` — smoke against PROD Supabase with `@tr1via.test` allowlist; no local Docker.
- `project_realtime_anon_key.md` — trailing whitespace in JWT env vars breaks Realtime WebSocket auth silently.

**Probably worth adding after this session:**
- A `feedback_token_efficiency.md` memory: scripts over MCP for repeat E2E; MCP only for genuinely UX-driven verification.
- A `feedback_heather_real_customer.md` memory: this is a product, not a demo; Wednesday is real go-live.
