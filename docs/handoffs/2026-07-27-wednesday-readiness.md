# Wednesday-readiness handoff — 2026-07-27

Goal of this work: make the next Wednesday show (2026-07-29) safe, and stop mid-week
changes from being the first stress-test. Everything below is durable so it survives
context compaction / a new session.

## PROVEN this session (with evidence)

- **The 30-player overload (July 22 disaster) is fixed at the root and guarded.**
  - Root cause: middleware ran Supabase `auth.getUser()` on every `/api/*` request →
    at 30+ players, Auth saturated → clicks froze 30s–2min. Fix (on prod): commits
    `ad26e49` + `7889b8a` (moved auth out of middleware for /api).
  - Guard test `tests/concurrency/legacy-venue-load-contract.test.ts` asserts: 40
    players' live traffic through `middleware` → `auth.getUser` NOT called,
    `createServerClient` NOT called. **Re-run:** `npx vitest run -c tests/concurrency/vitest.venue-scale.config.ts` (34 tests pass).
  - Prod DB measured healthy via Supabase MCP (hot query 1.8ms); monitored live 07-26, calm.
- **Full test suite green:** `npx vitest run` → 263 files, **1752 passed, 8 skipped, 0 failed**.
- **Phone-can't-start-partial-board FIXED + SHIPPED:** PR #166, squash `9de1e05` on main,
  prod-smoke green. Phone now uses `canStartMinimal` (1 ready category = startable),
  matching the laptop. 64 targeted tests pass.
- **Crowd engine built + validated:** `scripts/venue-load.mjs` (restored from
  `origin/wip/lane-c-alive-waits`; extended to capture real player_id → real heartbeat WRITES).
  `--self-test` PASSES. Hard PASS/FAIL: p95<1000ms AND 0 requests ≥5s AND error rate <1%.
- **HEAVY LOAD TEST RUN 2026-07-28 — 40 concurrent players, real local Postgres, PASS.**
  Seeded room YRQKZ9 on local stack. Two runs, 40 players × 30s:
  - Reads-only (snapshot poll, the July-22 storm path): 746 req, p50 45ms / p95 245ms / max 493ms,
    **0 errors, 0 frozen** (frozen = ≥5s, the July-22 symptom).
  - Full read+WRITE (773 snapshot reads + 243 REAL heartbeat DB writes): 1016 req, reads p95 74ms,
    writes p95 38ms, overall max 190ms, **0 errors, 0 frozen**.
  - DB-side sampler (`pg_stat_activity`, 1/sec) during the write run: **connections flat ~20, never
    >1 active query (no pile-up/queueing), 0 lock waits.** The one 300s+ "active" backend was a
    persistent Supabase service connection (gone after load), NOT a player query — all 1016 player
    requests finished ≤190ms. No congestion signature.
  - CAVEAT: real Postgres but LOCAL (my machine), not hosted Vercel+Supabase. Local DB is if
    anything weaker than prod, so holding here is a strong signal; prod DB separately measured
    healthy (1.8ms). Not replicated: the hosted serverless layer (the branch-mirror attempt failed —
    prod schema isn't in tracked migrations, so a branch comes up empty; see grant-drift).

## STILL OPEN — real bugs found by the E2E break-test (15/24 passed, 9 failed; triaged)

Not fixed. All have file:line + a proposed minimal fix. Verified present by reproducing.
1. **Player reconnect stampede (MEDIUM, venue-WiFi relevant).** Players' one-shot bootstrap
   fetch has NO jitter (`lib/hooks/useRoom.ts` ~384-561); only the host's backup path is
   jittered (`useRoom.ts:851`). Mass phone reconnect bursts `/api/room/`. Fix: add a small
   `Math.random()*N` delay before the player's initial snapshot fetch.
2. **TV standings tie → duplicate React keys (MEDIUM, TV-visible).** `components/tv/TVGrid.tsx:290`
   keys standings by bare `r.rank`; a tie renders two `key={1}` rows → React may duplicate/drop.
   Fix: `key={`${r.rank}-${r.name}`}` (every other ranked list already does this).
3. **TV "who just buzzed in" marquee starved (MEDIUM, cosmetic).** `lib/hooks/useTVRoom.ts`
   has no handler for the `live-room-event`/`answer_progress` broadcast (emitted by
   `app/api/answers/route.ts:260`); TV learns of locks only via a 4s safety poll, losing the
   race to the 1.2s auto-reveal. Fix: add `.on("broadcast",{event:"live-room-event"})` handler.
4. **"Start Game 1" below the fold on 320×568 (LOW-MED).** `components/host/HostGameReady.tsx`
   (TV illustration + 5 checklist rows) pushes CTA past the fold with no sticky bar. Fix:
   sticky bottom CTA row (~`HostGameReady.tsx:213`).
5. **Room Magic On/Off toggle under 44px tap target (LOW).** `app/host/setup/[nightId]/HostSetupOverviewClient.tsx:474`
   `minHeight:36` → change to `44`.
- **Generation silently hangs on hard/vague topics (still open, diagnosed only).** "20 of 20
  written / 0 of 20", host waits ~6.5min with no message. Vercel 300s kill; client watchdog
  only trips on a dead heartbeat. Proposed: internal ~3-min deadline that fails gracefully
  with "try a more specific topic." NOT built.
- **Grant-drift / DR risk (real).** Migrations don't grant table privileges (rely on Supabase
  defaults a clean `supabase db reset` doesn't reproduce). A DB rebuilt purely from
  `supabase/migrations/` comes up broken (players/hosts can't read their own rows). Prod works
  only via out-of-band grants. Fix: add explicit GRANTs into migrations; prove via clean reset
  + full game. (This is why local E2E needed a runtime grant reconstruction — see below.)

## Non-bugs (triaged, no action)
- `connection-degraded` / `connection-unreachable` E2E "failures" = MY test-env artifact: the
  outage sim `route("**/*.supabase.co/**")` never matches the local `127.0.0.1:54321` stack, so
  the block is a no-op. Fallback code is correctly wired. (Test hygiene: broaden the glob.)
- `full-game` "Show standings & board" = STALE TEST (that per-question host-phone screen was
  removed; phone auto-lands on finale). Fix: delete spec lines ~249-251.
- `prod-ui-smoke` = prod-only (needs `playwright-prod.config.ts` against tr1via.com).
- `may-lightning-ceremony` failure #7 is actually REAL (bug #3 above), not seasonal — it
  force-seeds themeKey "may".

## THE PLAN to walk into Wednesday confident (Brandon approved)
1. **FREEZE** today's verified prod (`9de1e05`). Change nothing before 07-29. No mid-week changes.
2. **Dress rehearsal on an ISOLATED PROD-MIRROR (Brandon's pick).** Needs ~2 account actions:
   (a) a fresh free Supabase project (isolated; load schema), (b) deploy today's code to real
   Vercel serverless pointed at it. Then drive 30-40 players via `scripts/venue-load.mjs` through
   a full game and watch that DB live until clean twice. This is the real-infra proof; it needs
   Brandon present for the Vercel + Supabase authorizations (can't be done solo).
3. **Fix only what the rehearsal exposes**, re-run.
4. **5-min pre-show checklist Wednesday:** right commit live, DB healthy (pg_stat_activity),
   join→start→reveal works → green = go.
5. **Live DB monitoring during the show + a one-command rollback staged** (revert to `9de1e05`).

## Fix sequencing (after Wednesday, PR-first, deploy only when no show live)
Batch 1 (before Wed if time, both venue-visible): bug #2 (TV tie key) + bug #1 (player jitter).
Batch 2: bugs #4 + #5 (mobile host polish). Batch 3: bug #3 (TV realtime marquee).
Separate/deliberate: grant-drift migration (founder-gated). Free/no-deploy: fix the stale test
+ the outage-sim glob so the suite is honest.

## Current machine/env state (for whoever resumes)
- Branch/worktree: `main` @ `9de1e05` in `.claude/worktrees/lane-c-alive-waits`.
- **Local Docker daemon went DOWN** mid-session → local Supabase stack is stopped; a nohup
  `npm run dev` is still running on :3000 but its DB calls fail ("fetch failed"). To restore
  local E2E: `open -a Docker` → wait → `npx supabase start` → the runtime grant reconstruction
  must be RE-APPLIED (it lives only in the DB, and a fresh `db reset` wipes it):
  `GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;`
  `GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;`
  then re-apply the anti-cheat revokes (questions column-grant to anon excluding correct_index;
  revoke reports/jobs/room_magic_reactions from anon,authenticated). See this session for exact SQL.
- `.env.local` in the worktree points at LOCAL (127.0.0.1:54321) with test flags — safe, gitignored.
- `scripts/venue-load.mjs` is restored on `main` (untracked; not committed).
