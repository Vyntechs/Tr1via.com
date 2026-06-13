# TASK: Resilient server-route fallback for degraded networks (Phase 2 of network-resilience)

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
