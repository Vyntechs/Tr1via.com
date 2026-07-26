# SESSION HANDOFF — 2026-07-25

**Read this first on "resume."** This branch (`wip/lane-c-alive-waits`) holds incomplete Lane C
work + this handoff. `main` holds everything that shipped. Do NOT merge this branch as-is.

---

## ✅ SHIPPED TO PROD today (all on `main`, merged + prod-validated via CI + Prod-smoke)

1. **Theme A — frictionless one-tap phone-host flow** — PR #163, commit `2b5409d`.
   Phone host reveals a board cell in ONE tap (= laptop); deleted the private staging/preview
   (`HostPhoneUpcoming`); auto-returns to the board on resolve (phone only). Fixed the 7/24 live bug
   where hosting from a phone never reached players. Review caught + fixed a legacy double-reveal race
   (server guard + optimistic cell-disable).
2. **Lane B — killed the phantom Game 2** (issue #3) — PR #164, commit `32a0d1b`.
   One "Game 2 is real" predicate (started, or a ready category) gates the TV intermission + player
   between-games + join-game route; empty auto-seeded shell → finale.
3. **"Load failed" on topic→generate** (host hit it live on cellular) — PR #165, commit `91206c3`.
   Root cause: bare `fetch` + no retry on create→generate. Fixed: POST-safe `fetchWithRetry` (retries
   only transient network/timeout, never a completed HTTP response); idempotent get-or-create on
   `/api/categories` (fails closed if the lookup errors); friendly error instead of raw "Load failed".

## 🔜 RESUME — do these in order (default next action = #1)

1. **Pick-screen reroll fast-follow (HIGHEST — finishes the incident).** `HostSetupPickClient.tsx`
   (~lines 619, 882) uses the SAME bare-`fetch` generate pattern as the fixed topic screen — a sibling
   "Load failed" gap. Wrap with the same `fetchWithRetry` (from PR #165). TDD → PR → review → merge.
2. **Finish Lane C player-wait** (WIP on THIS branch — see below). LOCKED design: the between-question
   wait defaults to a **momentum standings** beat (reuse `PlayerStandingsNeighborhood`) with an
   **always-available "View board" peek** (`PlayerBoard`, already built). Principle: **the phone is
   self-sufficient — it must NEVER depend on the venue TV** (bad seats / can't-see / accessibility).
   TODO: add the `action` slot usage, rewrite `BetweenView` to toggle standings ⇄ board, wire the
   player page call site (pass `neighborhood` + `categories` + `allQuestions`), TDD, PR.
3. **Lane C issue #4** — the host's generation-wait screen (`HostGenLoading.tsx`) feels dead. Make the
   skeleton grid narrate progress (not started). Shared Lane C principle: *a wait is never dead.*
4. **Unique index** on `categories (game_id, position, topic)` to fully close the create SELECT→INSERT
   race the review flagged. Needs a migration = **founder-gated** (Brandon's call).
5. **Master plan remainder:** Lane D (real-time correctness) + **Phase 4 device-matrix e2e** — the
   phone-viewport regression net; CI runs ZERO Playwright today, which is why the phone bugs slipped.

## 🔒 LOCKED DECISIONS (do not re-litigate)

- Phone host post-resolve: auto-return to board, no button, no `/advance`; the **laptop keeps
  "Next question →"** by necessity (its pick surface IS the patron TV). TV holds the answer up during
  the host's pick.
- Lane C player wait: **momentum default + board peek**; phone never depends on the TV.

## ⚠️ CONSTRAINTS / NOTES

- Merges this session were **founder-delegated** (Brandon: "you're in charge of the PR until merged
  and verified"). Never deploy/merge during a live **Wednesday** show. PR-first.
- Couldn't pull prod runtime logs (Vercel MCP token scope-403 for `team_pIz2bArnD9WKAfzxYWoPtvSd`) —
  the generate diagnosis is from the error signature + code, not telemetry.
- Worktrees kept: `.claude/worktrees/{theme-a-phone-host-parity, lane-b-phantom-game2, lane-c-alive-waits}`.

## 📦 WIP ON THIS BRANCH (incomplete — the Lane C player-wait, item #2 above)

- `components/player/PlayerBoard.tsx` — NEW read-only board (categories × values, played dimmed).
  Built + tested (`tests/component/PlayerBoard.test.tsx`, 3 tests green). NOT yet wired into the app.
- `components/player/PlayerStandingsNeighborhood.tsx` — added an optional `action` slot (for the
  "View board" affordance). No current callers, safe.
- NOT done: `BetweenView` redesign + player-page wiring + its tests. `BetweenView` is still the old
  static "host is picking…" screen on `main`.
