# TASK (IMMEDIATE NEXT SESSION): Pre-merge validation of PR #106 (RLS answer-leak fix) → drive merge risk to ~none

Re-plans: 0/3
**Phase:** QUEUED — #106 OPEN + mergeable; DB fix proven on real Postgres (pglite), full suite 745 pass. The realtime leg + PostgREST web-API behavior + the on-phone reveal flow are NOT yet proven on a real instance — that's THIS task. Brandon merges only after it's GREEN.

## Context
PR #106 (`fix/rls-correct-index-leak`, commit `3bbfaf5`) closes the anti-cheat leak: `questions_player_read` gated player SELECT on `played_at` not `finished_at`, so any joined player's anon connection could read the live question's `correct_index` (the answer). Fix = migration `0014` column-grant (revoke `correct_index` from `anon`; host=`authenticated` + `service_role` keep it) + a client reroute so players get the answer post-resolve from the resolve/end-early broadcast hint + the `resolve` reveal metadata + a `RevealView` holding frame so a correct player is never flashed "WRONG". Proven RED→GREEN on real Postgres (pglite). The gap pglite CANNOT cover: Supabase **Realtime**, the **PostgREST** web-API layer, and the real **browser reveal** flow.

## Goal
A written validation report proving — on a THROWAWAY Supabase copy (preview branch, NOT prod, NOT Heather's data) with `0014` applied — that every risk the local tests couldn't reach is closed, so merging #106 is near-zero risk.

## Scope
**IN:** PR #106 only (`0014`, `useRoom.ts` reroute, `RevealView` holding frame); a throwaway Supabase preview branch + a matching preview deploy; the three things pglite couldn't check — (a) the realtime push feed, (b) the PostgREST web API, (c) the on-phone reveal in a browser.
**OUT (do not touch):** do NOT merge #106 (Brandon merges); do NOT apply `0013`/`0014` to PROD or validate against the live DB; do NOT touch Heather's data; do NOT change the fix unless validation finds a real defect (then STOP + get Brandon's OK before changing the approach).

## Steps
1. Read PR #106, memory `anti-cheat-sweep-2026-06-13-open-siblings`, lessons (`rls-is-column-blind-revoke-the-column`, `revoke-migration-deploy-client-before-migrate`, `verdict-ui-must-hold-when-both-signals-absent`).
2. Stand up a Supabase **preview branch** (confirm the small cost with Brandon FIRST); apply `0014`. **Never prod.**
3. Prove the lock as BOTH real roles, via raw SQL AND the **PostgREST web API**: player (`anon`) DENIED `correct_index` (live + resolved) but reads the safe columns; host (`authenticated`) still reads it.
4. Prove the **realtime** feed never delivers `correct_index` to a player.
5. Prove the **browser reveal** flow on a preview deploy: correct player sees CORRECT (never WRONG/blank), fresh-join-mid-reveal sees the highlighted answer, and a hand-written anon answer query during the live window is DENIED. (Moves risk low→none.)
6. Confirm + document the **deploy-before-migrate** rollout sequence (batched with `0013`). Tear down the throwaway copy.
7. Write the validation report: each area PROVEN (with evidence) or "DO NOT MERGE" + the defect.

## Verify by
A report where all five areas — (1) lock via SQL, (2) lock via PostgREST API, (3) realtime feed, (4) browser reveal flow + hand-written-query denial, (5) rollout order — are each marked PROVEN with concrete evidence; if any fails it says "do not merge" and names the defect.

## Risk flag
⚠️ Touches the live Supabase project's domain + a migration bound for prod. Force ALL validation onto a throwaway copy, never prod, never near the Wed 6/17 show.

**Effort:** `xhigh` · **Model:** `claude-opus-4-8`

---

# TASK (SHIPPED — PR #105 MERGED 2026-06-14, `9de0f51`): Per-game scoring isolation — fix `game_scores` cross-game double-count (migration 0013)

Re-plans: 0/3
**Phase:** MERGED to `main` (`9de0f51`). ⚠️ migration `0013` NOT yet applied to prod — run the NARROW validation task below (batch with `0014`) to apply + prove. Not near the Wed 6/17 show.

## Context
`game_scores` (`supabase/migrations/0001_init.sql:207-227`) sums each player's answers across **both** games into **every** per-game row. Verified twice this session (primary + skeptic agents) and reproduced in SQL: a player with a 100-pt Game-1 answer and a 700-pt Game-2 answer shows `score=800, answered=2` in *both* rows instead of 100/1 and 700/1. It is the only open **wrong-winner** bug. The adjustments subquery is already correctly game-scoped — that asymmetry is the proof this is an oversight. **DECIDED (Brandon): scoring is independent per game** — no cumulative night-total.

## Goal
Each game's `game_scores` row reports `score`, `correct_count`, `answered_count`, and `fastest_correct_ms` from **only that game's answers** — a two-game player's Game-2 row excludes Game-1 points, AND a player who joined a game but never answered still shows at **0** — proven by a real-Postgres test that fails on the old view and passes on the fix, shipped as migration `0013` applied after merge.

## Scope
**IN**
- New `supabase/migrations/0013_game_scores_per_game_isolation.sql` — `create or replace view game_scores` with each answers-aggregate game-scoped via a `FILTER` clause.
- One real-Postgres DB-level test (NOT the mocked vitest client) seeding a two-game player + a zero-answer joiner.
- Extend `tests/e2e/full-game.spec.ts` to assert the finale winner's **name + score** (add `data-testid`s if missing).

**OUT (do not touch)**
- Billing, auth, RLS, the resilience layer, the state machine.
- The adjustments subquery (already game-scoped — leave verbatim).
- Any consumer query — every reader already does `.eq('game_id', …)`; this fix aligns the data with that existing assumption, so no app code changes.
- **Do NOT apply the migration during or near the live show (Wed 2026-06-17).**

## The exact rewrite (from the real SQL — only the 4 answers-aggregates change)
```sql
create or replace view game_scores as
  select
    gp.game_id,
    p.id as player_id,
    p.display_name,
    coalesce(sum(a.awarded_points) filter (where c.game_id = gp.game_id), 0)
      + coalesce(
          (select sum(adj.delta)
             from adjustments adj
            where adj.player_id = p.id
              and adj.game_id = gp.game_id), 0)
      as score,
    count(a.*) filter (where a.is_correct and c.game_id = gp.game_id) as correct_count,
    count(a.*) filter (where c.game_id = gp.game_id)                  as answered_count,
    min(a.ms_to_lock) filter (where a.is_correct and c.game_id = gp.game_id) as fastest_correct_ms
  from game_participations gp
  join players p on p.id = gp.player_id
  left join answers a on a.player_id = p.id
  left join questions q on q.id = a.question_id
  left join categories c on c.id = q.category_id and c.game_id = gp.game_id
  group by gp.game_id, p.id, p.display_name;
```
**Why FILTER, not WHERE:** a `WHERE c.game_id = gp.game_id` (or inner join) would DROP players who joined a game but never answered — they'd vanish from the board instead of showing 0. Aggregate `FILTER` keeps every `game_participations` row and only constrains the sums. ⚠️ This is the nuance the `view-leftjoin-filter-trap` lesson's "move to WHERE" remedy gets wrong **for this view** — do not follow it blindly here.

## Steps
1. **PLAN-FIRST:** confirm the FILTER rewrite above + pick the test infra (Open Question below). Wait for Brandon's "go".
2. Branch off `origin/main` (local tree is scratch — `source-of-truth-git-remote`).
3. **RED:** real-Postgres test seeding ONE player with resolved answers in BOTH Game 1 and Game 2 + a second player who joined Game 2 but never answered. Assert against the **current (buggy)** view → it FAILS (double-count + the joiner question).
4. **GREEN:** add migration `0013` with the rewrite; rerun → passes.
5. Extend `full-game.spec.ts` to assert the finale winner's **name + score** via `data-testid` (add testids if missing — `e2e-target-testid-not-visible-copy`).
6. Open PR (Brandon merges).
7. **POST-MERGE:** APPLY `0013` (Supabase MCP `apply_migration` / `db push` — deploy does NOT apply it, per `merge-is-not-migrated`), then query prod `game_scores` for a known two-game player to confirm per-game numbers. **Not during/near the show.**

## Verify by
- The new DB test **FAILS on the old view and PASSES on 0013** (proves it actually catches the bug, not a tautology).
- `full-game.spec.ts` asserts the correct winner **name + score**, not just card visibility (`e2e-assert-values-not-just-visibility-for-correctness`).
- Post-apply: a real two-game player's Game-2 row excludes Game-1 points, and a zero-answer joiner shows at 0.

## Open question (the one real decision for plan-first)
**How do we run a REAL-Postgres test?** The vitest suite is mocked (msw) and cannot exercise a SQL view; pointing local dev at prod won't have the fix.
- **A. Local Supabase stack** (`supabase start`, needs Docker) — apply all migrations, seed, assert via SQL. Most faithful; depends on Docker being available here.
- **B. Supabase dev branch via MCP** *(recommended if no Docker)* — create a branch, apply `0001→0013`, seed + assert with `execute_sql`, delete the branch. Real Postgres, no local Docker.
- **C. pg-mem / in-process Postgres** — fast but may not faithfully support `FILTER` + correlated subqueries → false confidence. Not recommended for a correctness proof.

Recommendation: **B if no Docker, else A.** Either way, gate the test as a tagged integration test that **skips unless a DB URL/branch is provided**, so the mocked CI suite stays green.

## Risk flag
⚠️ Production database migration on **live-user (Heather's) leaderboard** data. Plan-first; applied only post-merge, away from the Wed 6/17 show. The change is a `create or replace view` — instant, no lock, no backfill, and reversible by re-applying the prior definition.

**Effort:** `xhigh` · **Model:** `claude-opus-4-8`

---

# TASK (QUEUED — immediate next session): Narrow prod validation of the scoring fix (#105 / migration 0013)

Re-plans: 0/3
**Phase:** QUEUED — run AFTER Brandon merges #105. Apply-then-validate. xhigh; prod migration on live data.

## Goal
Migration `0013` is APPLIED in production and the per-game scoring fix is proven live: a real two-game player's `game_scores` rows are game-isolated (Game-1 row excludes Game-2 points; a zero-answer joiner shows at 0), and the live host→TV→phones→finale flow still works end-to-end — all done away from the Wed 2026-06-17 show.

## Scope
**IN:** apply `supabase/migrations/0013_game_scores_per_game_isolation.sql` to prod; a READ-ONLY prod verification query against `game_scores`; run `tests/e2e/full-game.spec.ts` against prod; a sanity glance at Heather's most recent real night's leaderboard.
**OUT:** do NOT write new code or fix newly-found bugs here (log them instead); do NOT touch RLS / #2 / #3 / billing / auth; do NOT apply or run anything during or near the Wed 6/17 show.

## Steps
1. Confirm #105 is merged to `origin/main` (`gh pr view 105`); pull.
2. Get Brandon's explicit go, then APPLY migration 0013 to prod (Supabase `apply_migration` / `db push`). Confirm prod's `game_scores` DDL now has the `filter (where c.game_id = gp.game_id)` clauses (deploy ≠ migrate — lesson `merge-is-not-migrated`).
3. Prod proof (read-only): pick a real player who played both games of a past night (or seed a throwaway `@tr1via.test` one), query `game_scores` for both their game rows, confirm per-game isolation + a zero-answer joiner at 0.
4. Run the full-game e2e against prod; confirm the finale asserts a real winner **name + score** (the new assertions) and the flow is green.
5. Log any anomaly found — do NOT fix it in this session.

## Verify by
Prod `game_scores` returns game-isolated numbers for a two-game player (Game-2 row excludes Game-1 points; zero-answer joiner at 0); the prod view DDL shows the FILTER clauses; full-game e2e passes against prod.

## Risk flag
⚠️ Applies a migration to PRODUCTION (Heather's live leaderboard data). `create or replace view` is instant / no-lock / reversible, but it's a prod write — needs Brandon's go at apply-time and must be far from the Wed 6/17 show.

**Effort:** `xhigh` · **Model:** `claude-opus-4-8`

---

# TASK (QUEUED — GATED, later): Broad pre-customer readiness validation (BWW customer-phones gate)

Re-plans: 0/3
**Phase:** QUEUED — do NOT start until prerequisites ship. Fan-out / Workflow-class. xhigh.

## Prerequisite (honest gate — without these this pass just re-finds known bugs)
MERGED + APPLIED first: (1) scoring fix #105/0013 [in-flight], (2) RLS `correct_index` leak fix, (3) #2 player phone total, (4) #3 host board staleness. Decide #4 (stranded player) + the two unauth routes before/during this pass.

## Goal
A documented **GO / NO-GO**: the app is safe to run for untrusted CUSTOMER phones (the Buffalo Wild Wings direction) — every verified correctness, anti-cheat, and staleness issue is closed and proven end-to-end in production, with zero open CRITICAL/HIGH.

## Scope
**IN:** a fresh foundation audit (the 5-agent host/player/TV/scoring/security sweep) against current `main`; end-to-end prod validation of the full flow asserting VALUES; anti-cheat probes (a joined anon/customer phone must NOT read the live correct answer or others' picks); the two unauth-route checks; a many-untrusted-devices scenario (resilience + anti-cheat hold at N, not one show's count — lesson `reason-scale-free-not-observed-count`).
**OUT:** no new feature work mid-validation; nothing run during or near a live show.

## Steps
1. Confirm all prerequisites merged + applied in prod.
2. Re-run the foundation audit against `origin/main`; confirm no open CRITICAL/HIGH (fan out via internal subagents/Workflow).
3. End-to-end prod validation: full host→TV→phones→game1→game2→finale, asserting winner name/score + per-game numbers, not just visibility.
4. Anti-cheat probe: as a joined device on the anon client, attempt to read `correct_index` / other players' live picks — MUST fail; hit `/api/games/[id]/locks` + `/api/questions/[id]/resolve` unauthenticated — confirm gated.
5. Customer-phone scale scenario: simulate many untrusted phones joining/answering; confirm resilience (#103) + anti-cheat hold at N.
6. Produce a written GO / NO-GO readiness report.

## Verify by
A fresh audit shows zero open CRITICAL/HIGH; the anti-cheat probe cannot leak the live answer or another player's pick; full-game e2e green in prod with value assertions; a GO/NO-GO report exists.

**Effort:** `xhigh` · **Model:** `claude-opus-4-8` (fan out via Workflow)

---

# (SHIPPED — PR #103, merged + live 2026-06-13) TASK: Resilient server-route fallback for degraded networks (Phase 2 of network-resilience)

Re-plans: 0/3
**Phase:** DONE + VERIFIED 2026-06-13 (not committed — PR-first, awaiting Brandon's go).

## WHAT SHIPPED (Phase 2)
- **Route** `app/api/room/[code]/snapshot/route.ts` — host+player modes (host-owns-night OR
  device cookie), admin reads, returns the RoomSnapshot shape + player extras + host board/answers.
  Withholds correct_index for non-resolved questions (`serializeRoomQuestion`).
- **Resilient fetch** `lib/realtime/fetchWithRetry.ts` (retry + jittered backoff + per-attempt
  timeout + abort). Backoff curve generalized in `lib/realtime/recoveryBackoff.ts` (`jitteredDelayMs`).
- **Mapper/store** `lib/room/roomSnapshotPayload.ts` (payload↔RoomSnapshot, `pickCurrentGame`
  extracted to `lib/room/pickCurrentGame.ts`), `lib/room/roomFallbackStore.ts` (one payload fans
  out to all consumers), `lib/room/fetchRoomSnapshot.ts`.
- **useRoom**: direct-read failure → `tryRouteFallback()` (JITTERED initial fetch, ≤2.5s, to avoid
  the room-wide entry stampede) → backup mode; `useRoomRoutePoll` polls ~5s±jitter; healthy direct
  reads exit backup mode. "unreachable" (hotspot) now means EVEN the route failed.
- **Aux consumers** wired to the store in backup mode: player `useMyAnswers`/`useMyParticipations`/
  scores; host `allQuestions`/`scores`/`liveAnswers`.
- **UX**: calm "backup" tier on the player ribbon + host banner (`useConnectionStatus` +
  `useRoomFallback`). No black screen, no hotspot takeover on a plain block.

## VERIFIED BY
- `npx vitest run` → 121 files, 734 passed / 8 skipped. New suites: fetchWithRetry, recoveryBackoff,
  pickCurrentGame, roomSnapshotPayload, api-room-snapshot-route (auth modes + correct_index gating),
  roomFallbackStore, useRoomRoutePoll, connection-status (backup tier), poll-stampede (N≤75 de-sync).
- `npx tsc --noEmit` clean except pre-existing `HostHomeClient-founder-build.test.tsx`.
- e2e `connection-degraded.spec.ts` → 2 passed: with `*.supabase.co` blocked (06-10 venue exactly),
  host console + player keep rendering the game via the route + show the calm backup tier, recover
  on unblock. `connection-unreachable.spec.ts` updated to total-outage (route also blocked) → 2 passed.
- **Load test** `connection-load.spec.ts` (N=8): mass simultaneous reconnect → polls spread,
  maxBin(500ms)=3 ≤ threshold, peak ≈6 req/s. Surfaced + fixed the initial-fetch stampede
  (see lesson [[jitter-the-initial-fallback-not-just-the-poll]]). LOAD_N env parameterizes the
  {1,5,10,25,50,75} range for staging/CI; jitter property proven scale-free in poll-stampede.test.ts.
- Did NOT gate on `npm run lint` (known broken; react-compiler flags the same patterns the existing
  channelHealth/watchdog hooks use).

## ─── (original plan below, kept for reference) ───

## DECISIONS LOCKED (Brandon approved the EXPERIENCE; engineering calls are mine)
- **Experience:** on bad/blocked WiFi the live game QUIETLY KEEPS WORKING through the server route
  (a few seconds slower) — no black screen, no "switch to a hotspot" takeover during play. A small
  calm "backup mode" indicator is OK. The Phase-1 full-screen "switch to a hotspot" surfaces ONLY
  when even the server route is unreachable (true total outage — what did NOT happen on 06-10).
- **Compose with Phase 1:** route fallback runs BEFORE declaring "unreachable". `reachability=
  "unreachable"` now means "even the Vercel route failed", not "direct reads failed".
- **One unified route** `/api/room/[code]/snapshot` (host + player modes). Include host board reads.
- **Prove-it-first:** an e2e blocks ONLY the browser→Supabase line (Playwright `context.route`
  abort on `*.supabase.co`) — the dev server's admin calls are a Node process, unaffected — so it
  reproduces the 06-10 venue exactly (browser-direct blocked, Vercel→Supabase fine) and asserts the
  game RENDERS via the route instead of the unreachable screen.

## Goal
On a merely-degraded (slow/lossy, not fully blocked) network, the host console and player keep
showing live state — roster, live question, answers, scores — by reading through a resilient
**server route** (the way the TV already does via `app/api/tv/[code]/snapshot/route.ts`), with
retry + backoff + jitter, instead of only telling the user to switch networks.

## Why a server route is strictly more resilient (the key insight)
- The player/host today read state with ~7 **direct** `browser→Supabase` calls in `useRoom`'s
  bootstrap, plus realtime over a WebSocket to `*.supabase.co`. On a lossy last-mile every one of
  those round-trips can stall/drop.
- A server route is **one** same-origin request: `browser→Vercel→Supabase`. The `Vercel→Supabase`
  leg runs on Vercel's reliable backbone with a pooled service-role connection (no RLS round-trips).
- Consequence: the route survives BOTH (a) degraded WiFi AND (b) the Phase-1 full-block case
  (venue WiFi blocking `*.supabase.co` only — Vercel itself is reachable, exactly like
  `/api/nights/by-code` already is). So this fallback can keep the game *working* (≈poll latency)
  where Phase 1 could only say "switch to a hotspot." See **Open question 1**.

## Scope fence (from brief)
IN:
- New server route(s) mirroring the TV snapshot for the host + player critical reads.
- A client fetch helper with retry + exponential backoff + **jitter**.
- Wire `useRoom` (+ the player page's player-scoped reads) to PREFER realtime when healthy and
  FALL BACK to the route when degraded; resume realtime when it recovers.
OUT (unchanged from Phase 1): no auth/billing/migrations/state-machine/scoring changes; don't
touch the working freshness watchdog / 15s heartbeat / reconnect throttle. Keep any risky path
host-safe and per-client load roughly **O(1)**. No deploy during a live show.

---

## DESIGN

### 1. The route — `GET /api/room/[code]/snapshot`
Mirrors `app/api/tv/[code]/snapshot/route.ts` (admin client, room-code keyed, `no-store`,
null-fields-not-404 so polling keeps a stable shape) but returns the **`RoomSnapshot` shape
`useRoom` already produces** (raw row shapes), so the fallback is a drop-in for the 7-read
`Promise.all`. Two auth modes (mirrors how RLS treats host JWT vs device cookie):

- **Host mode** — a signed-in host who owns this night (`getAuthedHost` + night.host_id match).
- **Player mode** — a valid device cookie (`getDeviceId`) matching a non-removed `players` row in
  this night.
- Neither → `403`.

Payload (superset; player-only fields null in host mode and vice-versa):
```
{
  night, hostDefaultThemeKey,
  games[], categories[], players[],          // roster
  questions[],                               // all is_picked — board (host) + derive live/resolved
  reveals[],                                 // newest-first, this night
  scores[],                                  // game_scores for current game
  // player mode only:
  me: { id, ... } | null,
  myAnswers[],                               // this player's answers across the night
  myParticipations[],                        // which games they joined (drives Join-Game-2)
}
```
**SECURITY (non-negotiable, mirrors `serializeBoardQuestion`):** withhold `correct_index` for any
question whose `finished_at` is null (live OR not-yet-played). Emit it only for resolved questions
(reveal). This matches the existing PLAYER_QUESTION_COLUMNS trim + the 2026-06-06 pentest fix.
`useRoom`'s client maps `questions[]` → `currentQuestion` (live, correct_index null) +
`lastResolvedQuestion` (finished, correct_index present), exactly as the direct reads do.

### 2. Client fetch helper — retry + backoff + JITTER
New `lib/realtime/fetchWithRetry.ts`: `fetchJsonWithRetry(url, { attempts, signal })` — exponential
backoff (reuse `recoveryBackoff.ts`'s curve/jitter, or a sibling) with **±jitter per attempt** so a
whole room's polls/retries never align. Bounded attempts per cycle; `AbortController` so a slow
attempt can't outlive its interval (mirrors Phase-1 `withTimeout`).

### 3. Client fallback state machine (in `useRoom`)
Add a `transport` mode alongside the existing realtime path — **realtime stays the primary**:
- **healthy** → current behavior (realtime + direct reads). Fallback inactive (zero extra load).
- **degraded** → entered when the connection is flaky-but-not-dead: channelHealth unhealthy past a
  short debounce, OR a direct-read bootstrap `withTimeout` fires while the route still answers.
  In degraded mode: **poll `/api/room/[code]/snapshot` every P≈5s ±jitter**, `setSnapshot` from each
  payload (player mode also refreshes myAnswers/participations/scores). Keep the broadcast channel
  subscribed in the background as the recovery probe.
- **recover** → when the channel returns SUBSCRIBED AND a fresh realtime message lands inside the
  freshness window, STOP polling and return to healthy (realtime-only). De-bounced + jittered so a
  room doesn't all flip back in the same instant.
- The poll is **O(1) per client** and jittered — same envelope as the TV's existing 4s poll for
  every TV (proven safe). It only runs during a degraded window, so steady-state load is unchanged.

### 4. Composition with Phase 1 (re: Open question 1)
Proposed: `reachability="unreachable"` (the "switch to a hotspot" surface) should trigger only when
**even the server route fails** (Vercel/site unreachable — a true outage), because direct-read
failure now has a working fallback. Net UX: blocked-supabase venues keep playing via the route
(≈5s latency) instead of being told to switch networks; "switch to hotspot" becomes the genuine
last resort. (If you'd rather keep Phase-1 behavior unchanged, we gate the route fallback to the
degraded case only and leave full-block → hotspot as-is.)

---

## STAMPEDE / LOAD MATH (the part the brief flags)
- **Steady state (healthy):** 0 added load. Fallback is dormant.
- **Degraded window, N clients:** ≈ N/P requests/sec to Vercel, spread across the jitter window so
  there's no synchronized spike. Each Vercel request fans out to ~7–9 pooled admin reads.
  e.g. P=5s, jitter ±40%, N=50 → ~10 req/s to Vercel, peak smoothed by jitter.
- **Reconnect moment (WiFi returns):** WITHOUT this, all N re-subscribe + each fires the 7-read
  direct bootstrap at once → an N×7 direct-read spike. WITH jittered backoff on both the poll and
  the recover→re-bootstrap, the N reconnects spread over the jitter window — no thundering herd
  (the `reason-scale-free-not-observed-count` lesson: guarantee holds at ANY N, validated by a
  range load-test, not one show's count).
- **Tunables to fix during load-test:** P (poll interval), jitter %, per-cycle retry attempts.

## TEST PLAN
- **Unit:** `fetchWithRetry` (success / retry-then-succeed / exhaust → throw; jitter bounds);
  route payload mapper `payload → RoomSnapshot` (live question withholds correct_index, resolved
  includes it; player extras populate); transport state machine (healthy→degraded→recover) as a
  pure reducer so it's testable without timers.
- **Route:** host-mode vs player-mode auth (403 for neither); correct_index withheld for
  live/unplayed, present for resolved; roster/scores/answers shape.
- **e2e** (`tests/e2e/connection-degraded.spec.ts`): Slow-3G / lossy throttling (NOT full block);
  assert a player + host still get live-question / roster / score updates via the route within a
  few seconds; target data-testids only (`e2e-target-testid-not-visible-copy`).

## LOAD TEST PLAN (Step 3, after approval + build)
- A driver that opens K headless player contexts against local dev → prod Supabase, forces degraded
  mode, and records Vercel + Supabase request rate. Run across **N ∈ {1, 5, 10, 25, 50, 75}**.
- Assert: jittered (non-aligned) request timestamps in the network panel; peak req/s and
  Supabase pooled-connection usage stay within headroom; no error spikes at the reconnect moment.
- Report the curve (req/s vs N) so the cadence is justified scale-free, not by one show's number.

## VERIFY BY (brief's bar)
Under Slow-3G (not blocked), a player and the host still see live question / roster / score updates
via the fallback within a few seconds; a simulated N-phone reconnect shows jittered, non-stampeding
requests in the network panel. Full unit + e2e suite green.

---

## OPEN QUESTIONS FOR BRANDON (need answers before coding)
1. **Compose with Phase 1?** Should a fully-blocked-Supabase venue now KEEP PLAYING via the server
   route (≈5s latency), with "switch to a hotspot" demoted to "even the site is unreachable"?
   (Recommended — it's a strictly better outcome.) Or leave Phase-1 full-block → hotspot untouched
   and use the route only for the degraded-but-not-blocked case?
2. **One route or two?** One `/api/room/[code]/snapshot` with host+player modes (recommended, DRY,
   mirrors RLS) vs two separate routes. (Technical — I'll default to one unless you object.)
3. **Host auxiliary reads** (`HostLiveConsoleClient`'s separate `allQuestions`/per-question
   `answers` reads for the full board + lock counts): fold into this route now, or keep direct and
   address in a follow-up? (Recommend: include `questions[]` + `liveAnswers[]` in the route so the
   host board + lock count also survive degradation; defer nothing material.)
