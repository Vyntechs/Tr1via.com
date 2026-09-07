# Large-room and poor-network resilience audit

Date: 2026-09-02

Scope: the tr1via live game, its deployed Vercel project, and the connected
`Trivia` Supabase project

Decision question: what actually happens under poor venue networking, and what
must change before treating rooms around 200 players as a supported operating
envelope?

Implementation note: the findings describe `origin/main` at the time of the
audit. The local `codex/resolve-question-once` branch now contains the report's
first P0 recommendation—winner-only legacy resolution broadcasts—but that
patch has not been deployed or applied to the hosted database.

## Executive conclusion

The current system has good recovery building blocks, but it is **not yet safe
to represent as a robust 200-player game**.

The primary constraint is not Vercel's nominal function concurrency and not a
simple Postgres connection count. It is application-level fan-out:

1. each player resolves the same question when their local timer reaches zero;
2. every one of those legacy resolve requests publishes two room-wide
   broadcasts, including on duplicate/no-op resolves;
3. most room broadcasts cause every player to fetch a full room snapshot;
4. successful answers require seven sequential Supabase Data API operations;
5. joins and reconnects can produce correlated full-snapshot bursts; and
6. the otherwise stronger resilient answer engine is only implemented on the
   backend—the current player client cannot submit its required payload.

At 200 players, one explicit code-derived legacy scenario produces about
80,800 delivered Realtime events during resolution, or 1,347 events/second if
they land within the same rolling minute. That exceeds the documented ordinary
Supabase Pro limit of 500 messages/second. This is a calculated upper-bound
scenario from current control flow, not a production measurement. It also does
not include snapshot traffic, joins, answers, host traffic, or retries.

The robust route is therefore architectural, not a larger plan alone:

- make question finalization single-winner and server-authoritative;
- finish the resilient client protocol before enabling it;
- stop broadcasting each answer to every player;
- use compact revisioned deltas for the live path and snapshots for recovery;
- preserve the last confirmed screen during transient outages;
- add jitter and bounded retries to reconnect paths; and
- validate the complete stack in an isolated hosted mirror at 50/100/200/300
  clients under both healthy and impaired networking.

## Confidence labels

- **VERIFIED** — directly observed in code, tests, hosted configuration,
  telemetry, or database data during this audit.
- **DERIVED** — arithmetic or behavior inferred from verified control flow;
  assumptions are stated beside the calculation.
- **UNKNOWN** — not exposed by the available read-only project interfaces or
  not tested at the requested scale.
- **RECOMMENDATION** — a proposed change; it does not describe current
  production behavior.

## What was inspected

### Code and production parity

**VERIFIED:** The local checkout is commit
`506278f53ca4637783e98900f900ccd92d48e3a7`; the latest ready production
deployment is commit `a32a682c3af964e1da22b93981cb67ee0d0a7e45`.
The branches have diverged, so this was checked file by file. The audited
live-game paths—player, host and TV room hooks; answer, resolve, snapshot,
join and heartbeat routes; broadcast code; middleware; and database
migrations—are unchanged between the two commits. The differences are in
player layout/dev preview/theme styling and tests. The runtime findings in
this report therefore apply to the current production live-game paths.

### Vercel project

**VERIFIED:** `tr1via` is a Pro Vercel project linked to
`Vyntechs/Tr1via.com`. Its latest production deployment is ready, uses Node.js
24, is deployed in `iad1`, and contains five Node.js lambdas. There is no
repository `vercel.json`, local `.vercel` directory, or code-level function
region declaration.

**UNKNOWN:** The available project interface did not expose whether Fluid
Compute is enabled. Current Vercel documentation says new projects default to
Fluid Compute, but that is not proof of this project's setting.

### Supabase project

**VERIFIED:** The connected project named `Trivia` is Pro,
ACTIVE_HEALTHY, in `us-east-1`, running Postgres 17.6.1.104. Its hosted
migration history matches the repository's live-game migrations through the
resilient reveal-board guard, and its live schema and activity match this
application. A newer local host-image migration is outside this audit's
live-network paths and was not present in the hosted migration history.

**UNKNOWN:** Vercel's connector does not reveal secret environment-variable
values, so this audit could not cryptographically compare the deployed
`NEXT_PUBLIC_SUPABASE_URL` to the inspected project. The matching live-game
migration history, project identity, schema and current traffic make it the
probable production database, but the distinction matters and is retained
throughout this report.

### Read-only posture

No production data, configuration, migrations, deployments or live games were
changed. No production load test was run.

## Current live-game behavior under poor networking

### Player state and recovery

**VERIFIED:** A player's durable view comes from
`GET /api/room/:code/snapshot`. Room Broadcast is primarily a wake-up signal:
on reveal, undo, resolve, advance, end, roster and other transitions the client
normally fetches the full snapshot again. The relevant implementation is in
[`useRoom.ts`](../../lib/hooks/useRoom.ts) and
[`fetchRoomSnapshot.ts`](../../lib/room/fetchRoomSnapshot.ts).

The player also refreshes every 15 seconds. One client coalesces overlapping
refresh requests and permits at most one trailing refresh, which is valuable
against repeated events on that device. Snapshot fetches use up to three
attempts, a five-second timeout per attempt, and jittered delays of roughly
300 and 800 milliseconds between attempts. In a persistent failure, the whole
sequence can take roughly 16 seconds.

**VERIFIED:** There is no random delay before the player's first snapshot or
before the immediate snapshot caused by a channel failure/reconnect. A room of
phones reconnecting together can therefore hit the route together.

**VERIFIED:** The player hook retains its previous snapshot when a refresh
fails, but the page checks reachability first and replaces the game with a
full-screen `UnreachableScreen`. The last confirmed question, lock state, or
score is hidden even though it remains in memory. See
[`page.tsx`](<../../app/(player)/room/[code]/page.tsx>).

**VERIFIED:** There is no venue-local authority or offline answer queue capable
of completing a game without Internet reachability. If the venue uplink is
down, the app can retain memory state, but it cannot authoritatively accept a
host transition or an answer. A request that never reaches the server before
the server deadline cannot later be considered timely.

What this means operationally:

- intermittent loss can recover through retry plus a fresh snapshot;
- a missed fire-and-forget Broadcast is normally repaired by the 15-second
  player refresh or the next event;
- during a correlated outage the UI currently looks more broken than the
  underlying retained state requires; and
- a complete venue Internet outage pauses authoritative play rather than
  producing a trustworthy offline game.

### Host behavior

**VERIFIED:** The host browser uses direct Supabase reads, room Broadcast, and
six Postgres Changes subscriptions covering players, nights, games,
categories, questions and reveals. Initial direct reads are bounded at five
seconds, followed by a randomized delay of up to 2.5 seconds before a
same-origin route fallback. The host has a backup route poll around every five
seconds with jitter, plus a 90-second freshness watchdog that reconnects a
stale socket or a browser returning from sleep.

This is more mature than the player's reconnect behavior, but it still depends
on public Internet access to Supabase/Vercel. It is not a LAN-hosted game.

### TV behavior

**VERIFIED:** The TV uses `GET /api/tv/:code/snapshot`, room Broadcast, and a
four-second safety interval. It aborts an active snapshot request whenever a
new poll or Broadcast starts. Under a network where successful responses take
longer than four seconds, the next interval can cancel the previous request
before its own five-second timeout. The hook retains the last snapshot, but
the page renders an error state when status changes to `error`, again hiding
the last confirmed game view. See
[`useTVRoom.ts`](../../lib/hooks/useTVRoom.ts) and
[`TV page`](../../app/tv/[code]/page.tsx).

### Answer submission

**VERIFIED:** The current player UI always sends the legacy answer payload:
`questionId`, `slotChosen`, and `scramble`. It does not send `runId`, `playId`,
or `submissionId`.

**VERIFIED:** The API rejects that legacy payload with HTTP 400 when the night
uses the resilient answer engine: `resilient answer payload required`. The
client treats a 400 as terminal and clears the pending answer. Therefore,
turning on the resilient engine now would break player answers rather than
make them more reliable. See [`useAnswerSubmit.ts`](../../lib/hooks/useAnswerSubmit.ts)
and [`answers/route.ts`](../../app/api/answers/route.ts).

**VERIFIED:** Legacy answer intent is retained in `localStorage`, and network,
5xx and 429 failures receive up to four attempts with 500/1,000/2,000 ms
backoff. However, the individual `fetch` has no abort timeout. A hung HTTP
request can hang indefinitely and never reach the retry path.

**VERIFIED:** The client treats every HTTP 409 as success. The API uses 409 for
both a duplicate answer—which is safe to consider confirmed—and a question
that is not live or has closed—which was not saved. Poor-network timing can
therefore display a closed/late answer as sent when it was rejected.

**VERIFIED:** A successful legacy answer performs six sequential Data API
reads (question, category, game, night, player and participation) followed by
one insert: seven Data API operations. A unique `(question_id, player_id)`
constraint makes duplicate insertion idempotent. The server, not the player's
clock, determines whether the answer arrived before `finished_at`.

### Heartbeats and roster

**VERIFIED:** Each player sends a heartbeat immediately, every ten seconds,
and after returning to a visible tab. At 200 players that is a base 20 POSTs/s,
excluding visibility bursts.

**VERIFIED:** A first join broadcasts `roster-changed`. Every current player
handling that event fetches a full snapshot; the TV refetches too.

**DERIVED:** If 200 players join sequentially after each prior player is fully
subscribed, the player-side upper bound is
`1 + 2 + ... + 200 = 20,100` snapshots: each player's own initial snapshot plus
all prior subscribers refreshing for later joins. Real simultaneous arrival
can be lower because not every earlier client will already be subscribed, but
the quadratic control flow exists.

## The dominant current defect: every player resolves the question

**VERIFIED:** Both the unanswered-question and locked-answer player views call
`POST /api/questions/:id/resolve` when their local countdown reaches zero.
There is no elected player, host-only authority, or central scheduler on the
legacy path.

**VERIFIED:** The legacy resolve route performs four lookup reads, calls the
resolution RPC, reads answer IDs, and then publishes both a `resolve` broadcast
and a `fireworks` broadcast. The database scoring function is idempotent, but
the route's broadcast side effects are not: duplicate/no-op callers still emit
both messages. See
[`resolve/route.ts`](../../app/api/questions/[id]/resolve/route.ts) and
[`broadcast.ts`](../../lib/api/broadcast.ts).

Most clients ignore the July fireworks visual outside its season, but the
Realtime message is still sent and delivered.

### Scale calculation

The table below uses one explicit scenario so the arithmetic is auditable:

- `N` player browsers;
- one host browser and one TV browser subscribed to the room;
- every player reaches zero and completes one legacy resolve call within the
  same rolling minute;
- each call emits the two verified room-wide broadcasts;
- Supabase counts one broadcast delivered to 100 subscribers as 100 events,
  per its current settings documentation.

| Players | Approx. room clients (`N+2`) | Base HTTP req/s¹ | Answer Data API ops/question² | Legacy resolve Data API ops | Delivered resolve events | Events/s over one minute | Sequential-join player snapshots³ |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 60 | 62 | 10.25 | 420 | 360 | 7,440 | 124.0 | 1,830 |
| 100 | 102 | 16.92 | 700 | 600 | 20,400 | 340.0 | 5,050 |
| 200 | 202 | 33.58 | 1,400 | 1,200 | 80,800 | 1,346.7 | 20,100 |

1. Players' 15-second safety snapshots + ten-second heartbeats + one TV
   four-second poll. It excludes initial loads, event-driven snapshots, joins,
   answers, host traffic and retries.
2. Assumes every player successfully answers once on the legacy path.
3. Code-derived worst ordering, not a measured arrival trace.

**DERIVED:** At 200 players, even the `resolve` broadcast alone would deliver
40,400 events, averaging 673 events/s across that minute. With both verified
broadcasts, only 75 of the 200 duplicate callers need to complete for
`75 × 2 × 202 / 60 = 505` events/s.

**VERIFIED:** Current Supabase documentation lists ordinary Pro limits of 500
concurrent connections, 500 messages/second, and 500 channel joins/second. Pro
with spend cap disabled lists 10,000 connections and 2,500 messages/second.
Supabase measures Realtime events as a rolling average over the previous minute;
exceeding project limits can close channels, and REST broadcasts can be
rejected with 429. See [Realtime limits](https://supabase.com/docs/guides/realtime/limits)
and [Realtime settings](https://supabase.com/docs/guides/realtime/settings).

**UNKNOWN:** The project's actual spend-cap choice and any custom Realtime
limits were not exposed. A plan setting could raise the numerical ceiling, but
it does not remove the quadratic architecture or protect multiple simultaneous
rooms and reconnect overlap.

**VERIFIED:** Supabase documents one WebSocket per browser client even when
that client joins multiple channels. In the explicit one-room scenario above,
200 player browsers plus one host and one TV are therefore approximately 202
Realtime connections. That is under ordinary Pro's nominal 500-connection
limit, but duplicate tabs, other live rooms, reconnect overlap and other app
clients consume the remaining headroom. Connection count is not the first
calculated failure in this scenario; delivered message rate is.

**VERIFIED:** Broadcast failures after the database commit are swallowed by
the route helper. This preserves the committed transition, but clients may miss
the signal and fall back to snapshots. A rate-limit/channel-close event can
therefore turn into a correlated reconnect/snapshot burst.

## Snapshot cost and scaling shape

**VERIFIED:** The player snapshot route maintains a process-global in-flight
map keyed by room. Concurrent requests handled by the same warm Vercel process
share one set of room-wide queries. There is no TTL cache, cross-instance
cache, or durable shared projection.

For a legacy room, a shared snapshot build performs seven Data API operations:
night, then games/categories/players/questions/reveals in parallel, then scores.
Every player request still performs three identity-specific operations: player,
answers, and participations. A resilient snapshot adds one shared and two
personal operations.

A 40-concurrent-request unit test confirms the intended same-process behavior:
the common tables are queried once, but player identity is queried 41 times and
answers and participations 40 times each. Vercel can route one burst across
multiple instances, so this test does not prove one shared query set for a real
hosted burst.

**VERIFIED:** The player response contains the full game/category/question
board, all players, all scores, personal history, and question scramble data.
As player count rises, the shared roster/score portion grows per response. A
room-wide refresh therefore transfers an approximately `O(N)` roster to `N`
clients—`O(N²)` bytes for that portion of the burst.

## Resilient engine: strong backend, incomplete product

**VERIFIED:** The database migrations implement substantially better answer
semantics: authoritative question plays, frozen eligibility, server deadlines,
a two-second final window, claim/apply receipts, submission idempotency,
run/revision fencing, and winner-only transition events. These are sound
foundations. See the resilient migrations beginning with
[`0022_live_answer_engine_schema.sql`](../../supabase/migrations/0022_live_answer_engine_schema.sql),
[`0023_live_answer_engine_functions.sql`](../../supabase/migrations/0023_live_answer_engine_functions.sql),
and their later guards.

**VERIFIED:** No hosted night has used the resilient engine, the host settings
table is empty, and the current player client cannot send its required payload.
It is dormant backend capability, not a functioning production safety net.

**VERIFIED:** Every fresh confirmed resilient answer inserts an
`answer_progress` event and the answer route broadcasts it to the entire room
channel. Player clients intentionally ignore that event to avoid a full
snapshot, but they are still subscribers and the delivery still counts.

**DERIVED:** At 200 answers and 202 room subscribers, answer progress alone is
`200 × 202 = 40,400` delivered events. If those arrive within one rolling
minute, that is 673 events/s—again above ordinary Pro's documented 500. Merely
turning on the resilient engine would therefore retain a separate quadratic
fan-out problem even after fixing the client payload.

## Hosted evidence: what has and has not been proven

### Historical data

**VERIFIED:** The probable production database contains 97 nights, all on the
legacy engine. The maximum `players` count for one night is 65, but that night
contains only 16 answers across eight played questions, so it cannot be cited
as a successful 65-player show.

The largest complete-looking histories observed were:

| Players | Answers | Played questions |
|---:|---:|---:|
| 41 | 2,507 | 84 |
| 38 | 1,667 | 84 |
| 36 | 2,256 | 84 |
| 34 | 1,923 | 84 |

The largest number of answers recorded for one question is 36. Among questions
with at least one answer, p95 is 29 answers. Production data therefore supports
real multi-dozen use, not 200-player capacity.

### Current traffic and errors

**VERIFIED:** In the sampled 24-hour Vercel window, snapshots and lookup traffic
dominated: 969 room snapshots, 863 night-by-code reads, 128 heartbeats, 15
reveals, 14 advances, 12 answers, 12 resolves and seven joins. Status grouping
showed no 5xx, 429 or 503 in that window. Seven-day runtime errors contained no
live-game capacity cluster; observed issues were an invalid refresh token for
one user, content-generation deprecation warnings, and one 300-second
generation timeout.

**VERIFIED, LIMITED:** Sampled Supabase Realtime logs showed successful REST
broadcast 202s and ordinary channel lifecycle messages, without sampled
event-limit or 429 errors. Present traffic is far below the proposed scale;
absence of errors is not a capacity result.

### Database posture

**VERIFIED:** Postgres reports `max_connections=60`, but this does not imply
only 60 players: the application uses Supabase's HTTPS Data API and pooled
server-side connections rather than giving each phone a direct Postgres
connection. Raising `max_connections` without evidence would consume memory
and is not the correct first response.

The database is small (about 32 MiB) and the sampled activity was light. The
advisor reported unindexed foreign keys including `answers.player_id`,
`game_participations.player_id`, and `reveals.question_id`, plus RLS and policy
findings. Because the service-role snapshot path bypasses RLS and index utility
depends on the actual query plan, these are investigation candidates, not proof
of the current bottleneck. Use `EXPLAIN (ANALYZE, BUFFERS)` on a populated test
mirror before adding indexes. Relevant advisor documentation:
[unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys),
[RLS init plans](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan),
and [multiple permissive policies](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).

### Platform ceilings

**VERIFIED:** Current Vercel documentation gives Pro a maximum function
concurrency of 30,000 and a scaling rate of up to 1,000 concurrent executions
per ten seconds per region; scaling may take minutes and excess can return
`503 FUNCTION_THROTTLED`. Vercel Functions also have a 4.5 MiB request/response
body limit and 1,024 file descriptors per instance. See
[concurrency scaling](https://vercel.com/docs/functions/concurrency-scaling),
[Fluid Compute](https://vercel.com/docs/fluid-compute), and
[function limits](https://vercel.com/docs/functions/limitations).

Two hundred phones do not inherently exceed those function limits. The code's
database work, repeated snapshots and Realtime delivery multiplication are the
nearer risks.

**VERIFIED:** Vercel is in `iad1` and Supabase is in `us-east-1`, so the two
server-side tiers are geographically aligned. That avoids an obvious
cross-continent penalty; it does not address venue Wi-Fi quality.

## Test evidence

The following tests were run during this audit:

```text
npx vitest run -c tests/concurrency/vitest.venue-scale.config.ts
4 files, 34 tests passed

npx vitest run [seven targeted resilience files]
7 files, 56 tests passed
```

The passing coverage includes 40-request same-process snapshot coalescing,
middleware bypass for high-traffic API paths, retry/backoff logic, room
snapshot behavior, resolve-route behavior, answer confirmation behavior, and
TV lifecycle behavior.

**LIMITATION:** These are logic/component tests with mocked boundaries, not 200
real WebSockets plus hosted route and database pressure. The 40-client
real-Postgres answer-race test was not rerun because the required local
Postgres/Supabase stack was unavailable. The repository's local load script can
create configurable player traffic, but it was not run against production;
doing so would create live data without authorization. An older handoff notes
a historical 40-player local pass, but the underlying log is unavailable and
the script has since changed, so it is historical context rather than current
independent verification.

## Recommended resolution

### P0 — correctness and fan-out fixes before a larger event

1. **Make resolution winner-only and server-authoritative.** Have the database
   operation return whether this caller freshly finalized the play. Only that
   winner may publish `resolve` and any visual effect. Stop all phones from
   acting as equivalent finalizers. Until a durable scheduler exists, use a
   bounded initiator set with the database transaction as the final arbiter.
   This removes the largest verified `N publishers × N subscribers` burst.

2. **Do not enable the resilient flag yet.** Integrate the player protocol
   first: `runId`, `playId`, stable `submissionId`, claim/apply response states,
   receipt reconciliation, and the two-second final-window UI. Add a guarded
   host canary only after end-to-end tests pass.

3. **Correct answer response semantics.** Return a typed 2xx success for an
   already-stored duplicate. Keep closed/not-live/deadline rejection distinct,
   and do not display it as saved. Add an `AbortController` timeout per attempt
   so a hung request advances to retry. Preserve a stable submission ID in a
   durable outbox until server reconciliation confirms its terminal state.

4. **Keep the last confirmed UI visible.** On player and TV, overlay a
   reconnecting/stale banner and disable unsafe input, but do not replace the
   game with a blank failure screen while confirmed state remains available.

5. **Make TV refresh sequential.** If a snapshot is already in flight, skip or
   coalesce the next four-second tick. Schedule the next poll after completion
   instead of aborting viable slow requests on every interval.

6. **Jitter correlated client recovery.** Add room-aware randomized delay
   before initial/reconnect snapshots, exponential backoff with a cap, and a
   single trailing refresh. Keep explicit user actions responsive; apply jitter
   to background recovery and fan-out paths.

### P1 — turn the resilient backend into a scalable live path

1. **Use compact revisioned Broadcast messages as the normal projection.** A
   client should apply a small `{runId, revision, kind, payload}` delta when the
   next revision arrives. Fetch a snapshot only on first load, focus/reconnect,
   detected revision gap, or periodic low-frequency verification. Broadcast is
   then the fast path; the database snapshot remains durable recovery.

2. **Split bootstrap from dynamic state.** Board/categories/questions change
   rarely. Cache/version that payload separately. Live deltas should contain
   the current play, the current player's receipt, and score/roster revisions—not
   the entire question board, all players and all scores on every transition.

3. **Remove room-wide per-answer progress.** Players do not consume it. Send
   answer progress only to a host/TV topic, or aggregate counts at a fixed
   cadence such as once per second or threshold. The essential rule is one
   aggregate update, not `N` answer messages delivered to `N` phones.

4. **Replace roster refetch with roster deltas.** Host and TV can receive
   join/leave/count changes and reconcile periodically. Player clients normally
   need a count or compact roster revision, not a full-room snapshot for every
   entrant.

5. **Add one durable due-play finalizer.** A strong Supabase-native candidate is
   one permanent Cron job that runs once per second, selects due question plays,
   and invokes an idempotent database finalizer. It should not create one Cron
   job per question. Only the transaction winner records/publishes the next
   revision. Supabase Cron supports second-level jobs and direct database
   functions: [Cron documentation](https://supabase.com/docs/guides/cron).
   `pg_cron` is available but not installed in this project, so this is a
   proposal requiring an isolated prototype, not a description of current
   behavior. A queue/worker is another option; Supabase Queues supports delayed
   visibility: [Queues API](https://supabase.com/docs/guides/queues/api).

This arrangement survives a host laptop losing Wi-Fi after the question starts:
the server deadline and finalizer remain authoritative, while any client can
recover by revision and snapshot. Client timers become presentation, not the
source of truth.

### P2 — define and prove an operating envelope

1. **Record the actual platform settings.** Confirm Supabase spend cap/custom
   Realtime limits and Vercel Fluid Compute in the dashboards. Do not infer
   these from plan names.

2. **Budget delivered events, not publishes.** For every event type record:
   publisher count × subscribers × frequency. Keep normal operation below 70%
   of the configured Realtime ceilings to leave room for other games,
   duplicate tabs and reconnect overlap. The exact margin is a product/SRE
   decision, but it must be explicit.

3. **Instrument the live protocol.** Track by run/play/revision: answer tap to
   first request, claim, confirmation, retry count, duplicate count, deadline
   rejection, broadcast revision gaps, snapshot duration/size, stale-screen
   time and recovery convergence. On Supabase watch connected clients,
   Broadcast/Postgres Changes events, join rate, 429/limit errors and
   replication lag through [Realtime Reports](https://supabase.com/docs/guides/realtime/reports).
   On Vercel track p50/p95/p99 duration, 5xx/429/503, cold starts, response size
   and Supabase dependency time per live route.

4. **Build an isolated hosted mirror.** Match the production plan classes,
   regions, migrations and function configuration; use synthetic data and no
   provider calls. Test 50, 100, 200 and 300 players with real WebSockets and
   route traffic. Include:

   - all clients joining in a short window;
   - reveal, answer, deadline finalization, resolve, advance and score updates;
   - duplicate sends and one dropped first response;
   - 400 ms added round-trip delay, 10% loss, and constrained bandwidth;
   - full disconnect/reconnect and 25% first-recovery response loss;
   - host disconnect while a question is live; and
   - two or more rooms concurrently, not only one ideal room.

5. **Use hard acceptance criteria.** Preserve the existing product targets and
   extend them to the declared player limit:

   - healthy answer acknowledgement p95 ≤ 1 second;
   - host transition propagation p95 ≤ 250 ms;
   - under weak Wi-Fi, zero lost or duplicate answers when at least one attempt
     reaches the server before the deadline, with confirmation p95 ≤ 4 seconds;
   - reconnect storm: exactly one accepted answer per player, p95 confirmation
     ≤ 2 seconds after connectivity returns, and room convergence ≤ 6.5 seconds;
   - zero Realtime-limit, function-throttle, database-timeout and snapshot-body
     limit errors at the supported load plus the agreed headroom.

6. **Canary and rollback.** Gate the completed resilient engine per host/night,
   run a supervised non-live canary, preserve the legacy rollback path, and do
   not migrate or deploy during a live Wednesday show.

## Venue-network operating guidance

Application capacity and venue Wi-Fi are different failure domains. Two
hundred phones on one access point may be limited by RF airtime, association
capacity, captive portals, client isolation, uplink bufferbloat, or venue
firewall policy before either cloud platform is saturated. This repository
cannot verify a venue's network.

Until the architecture and load program above are complete:

- use wired Ethernet or a dedicated network for the host laptop and TV where
  available;
- keep an independent cellular/hotspot fallback for the host, not merely the
  same venue uplink under another SSID;
- preflight WebSocket connectivity, DNS, captive portal behavior, latency and
  packet loss from the actual room;
- stagger player admission if a roster join storm appears;
- define a host-facing pause/reconnect procedure, because continuing the timer
  while the Internet path is absent cannot produce fair server-timed answers;
  and
- never promise that an answer that did not reach the server before the
  deadline will be accepted afterward.

Mixed cellular and venue-Wi-Fi clients are acceptable in principle: each talks
to the cloud independently. A venue-Wi-Fi outage will disproportionately affect
the clients sharing it, while cellular clients may continue. That diversity is
useful but is not a substitute for idempotent server semantics and controlled
fan-out.

## Decision gate for “support 200”

Do not treat 200 as supported until all of the following are true:

- the P0 resolve and answer-correctness defects are fixed;
- the resilient player protocol is fully integrated and canaried;
- per-answer and per-join room-wide `N × N` fan-out is removed;
- compact revision deltas and snapshot gap recovery converge in impairment
  tests;
- actual project Realtime/function settings are recorded;
- the hosted mirror passes the acceptance suite at the declared limit plus
  headroom and with concurrent rooms; and
- a real venue preflight validates the RF/uplink side independently.

The present evidence supports “working multi-dozen production usage with useful
recovery mechanisms.” It does not support “verified 200-player resilience.”
The recommended work above provides a concrete path to make that claim based on
measured behavior rather than assumption.
