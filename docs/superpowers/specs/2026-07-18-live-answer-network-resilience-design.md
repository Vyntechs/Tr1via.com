# Live Answer Network Resilience Design

**Status:** Approved by Brandon for implementation planning on 2026-07-18

**Date:** 2026-07-18

**Mode:** Original trivia mode (Heather's Classic) only

**Promise:** If any answer attempt reaches TR1VIA before the displayed final deadline, a brief Wi-Fi problem, cellular handoff, duplicate send, or lost confirmation must not lose it.

## The one decision changed by review

The first verbal version froze ordinary answer buttons at timer zero but let the server accept delayed packets for two more seconds. A modified client could exploit that hidden window. This written design fixes the unfairness: the final two seconds are visible and answer controls remain available to everyone until the exact server deadline.

## The founder version

There is no Wi-Fi mode and no cellular mode. Each phone uses whichever path can reach TR1VIA. The game reacts only to what the server has safely received.

### What happens during every question

1. A player taps an answer.
2. Their phone says **Sending your answer...** until the server confirms it.
3. Once confirmed, it says **Locked in ✓**.
4. If every player who was eligible when the question opened is confirmed early, the room sees **EVERYBODY'S IN** for about 1.2 seconds, then the answer reveals automatically.
5. Otherwise, the normal timer continues.
6. At zero, every phone visibly enters the same two-second **Final answers...** window. Answer buttons remain available during those final two seconds so an ordinary player receives the same opportunity as a delayed packet or custom client.
7. Taps stop and the answer reveals when that visible window ends.

If the last answer arrives during the two-second final window, that window simply finishes. The game does not add another 1.2-second wait.

### What Heather does

Heather keeps the same Original-mode controls, order, and laptop workflow she uses now.

- She does not choose a network mode.
- She does not judge whether an answer was late.
- She does not manage retries.
- Her existing **Show answer now** action starts the same visible two-second final-answer window, then reveals.
- Her phone is not required. The venue TV remains display-only.
- During that window, the button shows **Final answers...** and cannot be pressed twice.

No routine network recovery adds a new host control or a new hosting step.

One timing behavior is visibly different: **Show answer now** begins a clearly labeled two-second final-answer window instead of revealing instantly. That change cannot honestly be hidden from Heather. Her account remains on current timing until she accepts the host-only preview and rehearses the new timing once.

### What counts as a genuinely lost answer

An answer is only genuinely lost when that phone had no path to TR1VIA for the entire remaining question and final-answer window, and the server never received it.

These are not lost answers and must recover automatically:

- the server saved the answer but its confirmation never reached the phone;
- the phone changed between venue Wi-Fi and cellular;
- the phone sent the same answer more than once;
- a request timed out while the server was still saving it;
- the live screen refreshed or rebuilt while a send was pending.

After the reveal, a phone may reconcile a previously saved answer, but it may not create a new scored answer. Phone clocks and after-the-fact claims are never trusted for points.

### What happens in a room-wide interruption

The server cannot tell whether silence means a venue outage, a sleeping browser, or players choosing not to answer. Therefore missing answers never trigger an automatic void and confirmed scores are never erased by a guess.

If no surface could finish the play on time, the first surface that reconnects asks the server to finish it once. The server first reconciles answers it had already accepted, rejects any newly created answer after the visible final-answer window, and scores the confirmed answers normally. Every surface then shows **Back in sync** and the canonical result.

This is the honest limit: an answer that never reached TR1VIA before the visible final-answer window ended cannot be proven or scored later. A TR1VIA service outage may be flagged from authoritative backend health records for incident review, but this release does not automatically alter scores from that signal. A separate venue-outage recovery policy would require an explicit host decision or trusted local infrastructure; neither is smuggled into routine play here.

## Product decisions locked by this design

| Situation | One required result |
| --- | --- |
| Everyone is confirmed before zero | Show **EVERYBODY'S IN** for 1.2 seconds, then reveal |
| One or more answers are unconfirmed | Keep the normal timer running |
| Timer reaches zero | Run one visible two-second final-answer window with controls still available |
| Last answer confirms during the final window | Finish the existing window; add no extra wait |
| Heather selects **Show answer now** | Start the same visible two-second window, then reveal |
| A player joins during a question | They watch that question and may answer starting with the next one |
| Heather removes a player during a question | The removal applies next question; the current finish line does not move |
| A player's connection changes mid-send | The same pending answer retries safely |
| The server saved an answer but the reply was lost | Reconciliation finds it and shows **Locked in ✓** |
| A send reaches the server after the final window | Do not score it; sync the player for the next question |
| No surface could finish the play on time | First reconnect reconciles and resolves confirmed answers; never auto-void |
| Heather loses connection while pressing a control | Keep showing the last confirmed state and **Sending...**; never advance optimistically |

## Boundaries

### Included

- answer submission, acknowledgement, retry, and reconciliation;
- early all-confirmed reveal;
- timer expiry and Heather's manual reveal;
- late joins and answer eligibility;
- undo, re-reveal, and delayed old requests;
- stale or out-of-order room updates;
- mixed venue Wi-Fi and cellular connections;
- deterministic reconciliation and finalization after a stalled play;
- polished player states from 320-pixel-wide small phones through current large phones, including safe areas and mobile browser chrome;
- host laptop, mirrored venue TV, and player phone consistency.

### Not included

- detecting or displaying a player's carrier or Wi-Fi network;
- trusting a phone's local clock for scoring;
- accepting a newly created answer after the reveal;
- a venue-local server;
- a per-player network dashboard for Heather;
- a new game mode;
- automatic outage guesses based only on missing answers;
- automatic score repair or question voiding for an unprovable venue outage;
- broadly rewriting the established Supabase broadcast-and-snapshot architecture beyond the required audience-safe projections and ordering fields.

## Why the current behavior can lose confidence

The product already has strong live-state recovery: fast broadcasts, durable database snapshots, backup polling, focus/online recovery, and stale reveal guards. The gap is specifically in answer submission.

Today, the player screen can look locked before the answer is server-confirmed. That screen change can unmount the component that owns retries, so the retry process and its retry button disappear together. A generic conflict response can also be mistaken for success, and an answer can race with question resolution.

The timer is currently influenced by whichever client reaches the close action first. That makes weak connections, delayed broadcasts, undo, late joins, and duplicated reveal requests harder to reconcile cleanly.

The repair is one authoritative server-side question play plus one persistent player-side outbox. Adding more loading copy to the current race would not fix it.

## Chosen architecture

### 1. Give every reveal an immutable play identity

Every time a question opens, the server creates a new `playId`. Undoing and replaying the same question creates a different `playId`.

This prevents a delayed answer from the first showing of a question from leaking into its replay. Every answer, award, and retry carries the play identity.

At most one unfinished play may exist in a night run, enforced by the database. A Game 2 command cannot open while a Game 1 play is unfinished.

### 2. Order the whole night, not just one play

Each opened night run receives a server-generated `runId`, one monotonic `roomRevision` for display ordering, and one monotonic `controlRevision` for lifecycle preconditions. Every accepted live mutation increments the room revision in the same transaction. Pure answer confirmations do not increment the control revision; opening, undoing, entering all-in/final-window state, resolving, ending, or resetting does. Every snapshot and broadcast carries `(runId, roomRevision, controlRevision, playId)`.

- A client ignores an event from a noncurrent run.
- Within the current run, a client ignores any revision lower than the highest canonical revision it has applied.
- Game 1, intermission, Game 2, undo, and replay all share this ordering, so an old Game 1 event cannot overwrite Game 2.
- Reset-to-setup creates a new run identity; delayed commands from the prior run fail their precondition.

Every host mutation—open question, undo, **Show answer now**, end game, and reset—also carries a stable random command ID plus the expected run, control revision, game, play, and semantic play state when applicable. Answer-only room-revision drift never rejects a valid host action. A real lifecycle change does. A command record is unique within the night. A retry returns its original canonical result; a stale command with different semantic preconditions cannot create a new action.

A player bootstrap asks whether that signed device already has a canonical answer for the current play. That lets a refresh recover **Locked in ✓** even if local browser storage disappeared. Public room and TV snapshots expose confirmed counts only, never player choices before reveal.

### 3. Freeze who may answer when the play opens

The server snapshots the answer-capable players when the question opens.

- A player with a real signed device identity and active game participation is eligible, even if their connection is currently weak.
- A host-added score-only name without a paired player device is not eligible.
- A player joining after the play opens watches and becomes eligible on the next question.
- A reconnect does not add or remove eligibility.
- An explicit host removal takes effect after the current play. Until that play finishes, its frozen eligibility and any already-traveling answer remain valid. The removal does not shrink the current denominator or trigger a surprise early reveal.
- Zero eligible players never triggers an automatic reveal.

This makes **everyone** a fixed, fair denominator instead of a moving count based on heartbeats.

### 4. Persist a bounded answer outbox above the question screen

When a player taps, the room page records the submission in browser storage before sending it. The outbox belongs to the room session, not to the temporary question component, so a screen transition, component rebuild, or refresh cannot cancel it.

The outbox is a bounded per-play queue rather than one mutable slot. A record contains the run, night, game, play, selected visible slot, created-at cleanup time, and a stable random submission ID. It contains no host secret and grants no authority by itself. One record is allowed per play, capped at 64 records—enough for two full Original-mode games while preventing unbounded storage.

Submission behavior:

- the first selected choice is final;
- the UI changes to **Sending your answer...**, not **Locked in**, while confirmation is pending;
- only one request per record may be in flight;
- a request without an acknowledgement after 1.5 seconds is aborted locally and retried idempotently after full-jitter backoff of 250, 500, 1,000, then at most 2,000 milliseconds;
- at most eight attempts occur while the current acceptance window is open; the API also limits a device/play pair to ten attempts per ten seconds and returns a typed retry delay;
- focus, route recovery, or snapshot recovery may wake a retry, but may not exceed those ceilings;
- retry correctness never depends on `navigator.onLine`, which is only a hint and can be wrong on venue networks;
- changing between Wi-Fi and cellular needs no special branch;
- the current play has send priority; older records receive one reconciliation attempt on the next successful bootstrap and never delay the current question;
- `confirmed` clears the record after the canonical answer state is applied;
- `deadline_passed`, `identity_invalid`, and `not_eligible` are terminal, show their one appropriate message, then clear the record;
- a record from a noncurrent run or older than two hours is discarded without a send;
- if browser storage is unavailable, the same outbox continues in memory and the player sees **Keep this screen open — answer still sending** instead of a durability promise the browser cannot keep.

Closing the browser or clearing its storage before any send succeeds remains outside what software can recover.

### 5. Make one database transaction authoritative

The answer endpoint performs no separate read-before-write chain. It calls one database operation that captures database time immediately, then validates and saves atomically.

The signed device session—not a player ID or submission ID supplied in the request body—determines the player. The database operation verifies that the device owns that eligible player inside the same night and play before accepting anything.

The phone submits the visible answer slot. The server recomputes that player's deterministic scramble and translates the slot to the canonical choice; a scramble or canonical answer claimed by the client is never trusted. The browser reaches only a same-origin handler that verifies the HMAC-signed device cookie. That server handler alone invokes the service-role-only database operation.

For each `(playId, playerId)`:

- only one answer can exist;
- duplicate submissions return the already-saved canonical answer;
- a conflicting retry still returns the first saved choice;
- a saved answer is checked before a deadline rejection, so a lost acknowledgement can reconcile even after reveal;
- a new answer is accepted only while the authoritative acceptance window is open;
- the confirmed count increments only for a newly inserted answer;
- server/database receipt time, never phone time, determines timing and speed bonus eligibility.

The endpoint returns a typed result: `confirmed`, `deadline_passed`, `identity_invalid`, `not_eligible`, or `retry_later`. **Still sending** is a client transport state used when the endpoint has not returned; it is never a fake server confirmation. A generic conflict is never treated as success.

### Security gate before any rollout

The current repository contains a release-blocking identity path: shared player snapshots return full player rows while browser-side database access treats a mutable raw device header as identity. A technical player could reuse another exposed device identifier. The network engine cannot ship behind a flag while that legacy path remains open.

Before any preview or production enablement:

- room, player, host, and TV responses use explicit audience-shaped fields; no shared response contains `device_id`;
- live player question projections never contain `correct_index`, the answer key, another player's selected choice, submission IDs, or private device fields before resolution;
- raw question, answer, eligibility, and play-answer tables are not exposed through broad player Realtime subscriptions;
- anonymous direct insert/update/delete is revoked on the legacy answer table and every new play/answer table;
- `PUBLIC`, `anon`, and `authenticated` execution is revoked on every live mutation function; only `service_role` may execute them;
- every security-definer function fixes a safe `search_path`, fully qualifies relations, and derives player/night/game identity from the verified device and play rather than request-body IDs;
- `question_play_answers (play_id, player_id)` has a composite foreign key to the matching immutable eligibility pair;
- idempotency is scoped to the verified `(playId, playerId)` and never authorizes by submission ID alone;
- external failures are typed and generic; raw database messages never reach a player.

The public deadline-check route used by TV/player surfaces is rate-limited and may only ask the database to finalize the current play after its own deadline. It cannot choose a reason, alter a deadline, target another room's play, or receive private result fields.

The room broadcast contains only run/play identity, room/control revisions, state, deadlines, and aggregate counts. A player snapshot adds only that signed player's canonical answer. The TV receives no selected choice or correctness before resolution. The host receives only the fields needed to run the game.

### 6. Let one server clock control the play

Each play stores:

- when answering opened;
- when the main timer reaches zero;
- when the visible two-second final-answer window ends;
- the frozen eligible count;
- the confirmed count;
- its current state;
- when and why it resolved or was undone.

The legal states are:

- `accepting` → `all_in_hold` → `resolved`
- `accepting` → `final_window` → `resolved`
- `accepting/all_in_hold/final_window` → `undone` within the existing two-second wrong-question window

Clients render remaining time from the authoritative deadlines. A delayed broadcast cannot restart a full timer.

Boundary rules are exact:

- an answer whose database receipt is before main-timer zero can complete the all-confirmed path;
- at or after main-timer zero, the play follows the visible final-window path;
- every official player may still choose while that final window is visible;
- an answer whose database receipt is before the final-window deadline is accepted;
- at or after the final-window deadline, a new answer is rejected;
- the current 5,000-millisecond speed bonus cutoff remains based on authoritative receipt time; the final window never creates extra speed-bonus time.

Timing transitions are also exact:

- normal play stores the final-window deadline two seconds after main-timer zero;
- all-confirmed before main-timer zero stores a finalize time 1.2 seconds after the confirming transaction, but never earlier than the end of Heather's existing two-second wrong-question undo window;
- Heather's first **Show answer now** request moves the play into the visible final window at server receipt and stores a deadline two seconds later;
- pressing **Show answer now** again cannot restart or extend a final window;
- **Show answer now** during an existing all-in beat cannot replace it with a longer wait;
- confirming the last answer during an existing final window cannot shorten or extend that window;
- the first valid caller reaching an overdue unresolved play finalizes it from already confirmed answers; delay alone never voids scores.

No answer is revealed during the final window. Because official controls remain available to everyone until the same displayed deadline, there is no hidden answering advantage for a modified client. Controls freeze at the final-window deadline.

### 7. Funnel every finish through one idempotent operation

The host, TV, and player phones may all ask the server to advance when their displays reach a deadline. Redundant requests are expected. One atomic `finalize_play` operation decides the winner of every race and changes state only once.

Player and TV callers may only request a server-deadline check; they cannot choose a resolution reason, shorten a timer, or begin Heather's manual final window. Only the authenticated host who owns the night may invoke **Show answer now**, undo, or game end.

It handles:

- all-confirmed after the 1.2-second room beat;
- normal timer expiry after the two-second final window;
- Heather's **Show answer now** after the same final window;
- an overdue play that resumes after an interruption.

Only the request that actually changed state may write awards, append the durable reveal event, or broadcast. Every other caller receives the already-decided state through its audience-safe projection.

No scheduled service is required for the first release. Any live surface can safely make the same finalize request; the database clock and transaction decide once.

### 8. Preserve undo, game-end, and reset contracts

Undo remains Heather's current two-second wrong-question escape hatch. Database time measures two seconds from question open. Within that window, and only before resolution, one atomic command marks the play undone, makes its unscored answers ineligible, restores the board, and advances both revisions. After two seconds it returns the existing conflict behavior without changing anything. A replay receives a new play identity.

A retried or delayed open command returns its original command result and can never reopen a play that was undone. A delayed answer tied to the undone play is terminally rejected.

**End game** succeeds only when there is no unfinished play. If a question is active, it returns a typed **Finish the current question first** result and leaves state unchanged. Once the play resolves, the host may end the game normally. A late answer cannot reopen or score an ended game.

Reset-to-setup remains an explicit, confirmed host operation. One transaction clears both legacy and new playthrough/answer/award rows plus adjustments according to the existing reset promise, preserves the latched answer engine, creates a new run identity, and starts the new run's canonical revisions. The engine-aware score view then returns reset totals, and every delayed pre-reset command or answer fails its run precondition.

## Surface behavior

### Player phone

- Keep the last confirmed question visible through a connection interruption; do not replace it with a generic unreachable screen.
- Tap: selected answer plus **Sending your answer...**.
- Confirmation: **Locked in ✓**.
- Slow acknowledgement: **Still sending...** without asking the player to tap again.
- Main-timer zero: **Final answers — 2... 1...** appears and the answer controls remain clearly available.
- Final-window end: controls freeze; any unconfirmed local choice remains **Sending...** until canonical reconciliation returns.
- Lost acknowledgement recovered: transition quietly to the canonical locked state.
- Proven miss: **That answer wasn't received in time. You're synced for the next question.**
- Reconnection: canonical current screen plus a brief **Back in sync** confirmation.

All states must avoid horizontal scrolling and clipped controls at 320×568, respect iOS and Android safe areas, and scale cleanly through 430×932 and larger current phones in portrait. Landscape remains usable, but portrait is the primary play orientation.

### Heather's laptop

- Preserve her existing board, timer, **Show answer now**, undo, and game controls.
- Count only server-confirmed answers as locked.
- Show **EVERYBODY'S IN** during the early-reveal beat.
- Show **Final answers — 2... 1...** after timer zero or **Show answer now**, then **Revealing...** only while the final transaction is in flight.
- If her action is still traveling, show **Sending...** and retain the last confirmed game state.

This release is explained once through the approved host-only **What's New** surface. Players never see release notes. The exact default copy is:

> **A smoother live game**
>
> TR1VIA now carries answers safely through brief connection changes, waits two final seconds before every reveal, and moves early when everybody is in. Your controls stay the same—nothing new to manage. If anything ever looks wrong during a live game, contact Brandon.

The host-only notice offers **Preview the 2-second finish**, **Use smoother timing**, and **Keep current timing**. Heather's choice is explicit, saved once, and reversible between nights. No timing engine can change during an opened night.

### Venue TV

- Remain display-only.
- Hold the last confirmed state during an interruption.
- Ignore old run IDs and lower room revisions; never replay stale answer animations.
- Match **EVERYBODY'S IN**, **Final answers — 2... 1...**, and reveal states with the host and players.
- Keep question, answer choices, scores, and player names legible at venue distance; this design does not reduce the previously approved TV readability requirements.

## Data model

The implementation plan should use additive migrations for records equivalent to:

- `players.can_answer`: false for a host-created score-only name and true for a player created through the signed-device join flow; heartbeat never controls it;
- `nights.current_run_id`, `nights.room_revision`, and `nights.control_revision`: cross-game display ordering and lifecycle preconditions;
- `nights.answer_engine`: `legacy` or `resilient_v1`, latched when the night opens;
- `live_command_receipts`: unique night/run/command ID, expected preconditions, command kind, and canonical result for safe host retries;
- `question_plays`: immutable play ID, run/question/game IDs, status, open/main-timer/final-window/finalize times, counts, and resolution reason;
- `question_play_eligibility`: one immutable `(play_id, player_id)` row per eligible player;
- `question_play_answers`: unique eligible play/player pair, stable submission ID, authoritative receipt time, canonical choice, correctness, and exact awarded points;
- durable room events tied to run ID, room revision, control revision, and play ID.

A partial uniqueness constraint permits only one unfinished `question_plays` row per night run.

For a new-engine night, `question_play_answers` is the only answer/scoring source. `finalize_play` determines correctness and records `is_correct`, `awarded_points`, and authoritative lock time there in the same transaction. Undo is allowed only before resolution, so it never reverses a score.

The existing `game_scores` SQL view is replaced, under the same public view name and columns, with one engine-aware `answer_facts` source:

- the `legacy` branch reads existing `answers` joined through question/category/game and only for nights latched to `legacy`;
- the `resilient_v1` branch reads `question_play_answers` joined through resolved `question_plays` and only for nights latched to `resilient_v1`;
- `UNION ALL` combines those mutually exclusive facts before the existing per-game/player score, correct count, answered count, fastest-correct time, and adjustments aggregates run;
- participation rows with no answers remain visible at zero exactly as today.

The host, TV, recaps, and winners therefore keep reading the same `game_scores` projection without double-counting or mixing engines.

A flagged-off night continues using the legacy answer path after the global security gate is fixed. The selected engine is stored when the night opens and cannot change until that night closes. Reset-to-setup cleans both engines' playthrough rows and creates a new run identity but deliberately preserves the night's engine latch. Heather may change engines only before opening a different night.

Exact column names may follow existing schema conventions, but the identities, uniqueness guarantees, deadlines, and transaction boundaries in this design are requirements, not suggestions.

## Operations and observability

Record only allowlisted aggregate operational measures by opaque play ID:

- answer confirmation latency;
- retry and duplicate counts;
- reconciliations after a lost acknowledgement;
- deadline rejections;
- all-confirmed versus timer versus host resolution reason;
- duplicate finalize attempts that correctly became no-ops.

Allowed fields are coarse latency bucket, typed result code, retry count, and resolution reason. Do not log room codes, answer text or choice, raw request/response bodies, player/device/submission IDs, tokens, cookies, private device data, or raw database errors.

## Safe rollout and rollback

1. Close the current identity and answer-key exposure paths in the security gate, with exploit regression tests, before deploying any new-engine flag.
2. Add the schema and atomic operations without changing active production nights.
3. Put the new play path behind a per-host release flag whose chosen engine is stored when a night opens; never switch an existing night or question between engines.
4. Exercise it first with the founder test host, mixed real phones, two consecutive games, weak-network simulation, undo, reset, and a venue-style mirrored TV.
5. Run the production smoke before offering it to Heather.
6. Between shows, Heather previews the two-second finish and explicitly selects **Use smoother timing** or **Keep current timing**. Never deploy or change her selection during a live Wednesday game.
7. Roll back by disabling the flag for newly opened nights. An already opened night stays on its stored engine through close; keep additive records intact for incident review and never delete live answers as rollback.

## Verification contract

### Unit and component checks

- pending, confirmed, terminal-miss, and back-in-sync states never show a false lock;
- the 64-record outbox survives question-component unmount and refresh, gives the current play priority, expires terminal/old-run/two-hour records, and never exceeds its storage or retry ceiling;
- storage failure produces the truthful keep-this-screen-open state;
- duplicate and conflicting sends preserve the first confirmed choice;
- two tabs for the same player converge on the first database-confirmed choice;
- lost acknowledgements reconcile to the saved answer;
- lower room revisions, old run IDs, and old play IDs cannot restart the timer or move a surface backward;
- an exact host-command retry returns its first result; intervening answer-only room revisions do not reject it, while a changed control revision or semantic precondition does;
- player, host, room, and TV serializers expose only their allowlisted fields;
- **Final answers — 2... 1...** leaves official answer controls available until the authoritative deadline, then freezes them.

### Security regression checks

- a joined player never receives another player's device identifier;
- copying a raw browser device header cannot read or submit as another player;
- anonymous PostgREST insert/update/delete on legacy and new answer/play tables is denied;
- `PUBLIC`, `anon`, and `authenticated` cannot execute answer or finalize functions;
- a body-supplied player, night, game, canonical answer, scramble, or submission ID cannot override signed-cookie identity and server-derived data;
- a cross-room play/player pair fails the eligibility foreign key and transaction checks;
- live player/TV snapshots and Realtime payloads contain no answer key, selected choice, correctness, private identifier, or raw database error before resolution.

### Real-database concurrency checks

- two simultaneous last answers create one all-confirmed transition and one reveal;
- answer versus timer, host reveal, and all-confirmed races score exactly once;
- identical and conflicting question-open commands create one play or one typed stale-command result, never a surprise replay;
- a saved answer whose acknowledgement is lost reconciles after resolution;
- undo versus delayed answer and re-reveal cannot cross play IDs;
- late join, removal, reconnect, and score-only host-added players affect eligibility only as documented;
- undo from `accepting`, `all_in_hold`, or `final_window` succeeds only before `opened_at + 2,000ms` and before resolution; at the boundary or later it changes nothing;
- all-confirmed reveal occurs at `max(last_confirmation + 1,200ms, opened_at + 2,000ms)`;
- an end-game command with an unfinished play changes nothing and returns **Finish the current question first**;
- the engine-aware `game_scores` view uses only the night-latched source, keeps Game 1 and Game 2 isolated, applies adjustments once, and retains zero-answer participants;
- reset clears legacy and new playthrough state and adjustments, preserves the engine latch, rotates the run ID, returns reset score totals, and rejects every old-run request;
- a receipt at `main_zero - 1ms` may trigger all-in, while one at `main_zero` follows the final window;
- a receipt at `final_window_end - 1ms` is accepted, while one at `final_window_end` is rejected;
- a receipt at `opened_at + 4,999ms` may earn the speed bonus, while one at `+5,000ms` cannot;
- a final-window answer is accepted without a speed bonus and cannot shorten or extend the window;
- an overdue unresolved play finalizes confirmed answers once and never auto-voids them.

These tests must use independent database connections. Single-process mocks cannot prove transaction safety.

### Exact network profiles

| Profile | Impairment | Required result |
| --- | --- | --- |
| Healthy | ≤100ms round-trip, 0% loss | Answer acknowledgement p95 ≤1s; committed host action reaches healthy subscribed surfaces p95 ≤250ms |
| Weak venue Wi-Fi | 400ms round-trip, 10% seeded request/response loss, 2Mbps | Across 100 seeded runs where at least one attempt reaches the server before deadline: zero lost/duplicate answers; confirmation p95 ≤4s |
| Lost acknowledgement | First answer commits; its response is dropped | Automatic retry returns the canonical first answer; one row and one score only |
| Network handoff | Connection is cut immediately after tap for 1.5s, then restored on a new path before final-window end | Confirm within 2.5s after restoration without another tap |
| No path | Phone is offline from tap through final-window end | No answer is invented or scored; player receives the proven-miss state after reconciliation |
| Stale delivery | Revision N is delayed three seconds and arrives after N+1 | Every surface remains at N+1 |
| Reconnect surge | 40 players recover within one second; first response is dropped for 25% | Exactly 40 canonical answers, no duplicate score/reveal, p95 response ≤2s, ≤320 answer POST attempts in ten seconds, all surfaces converge within 6.5s |

### End-to-end and visual checks

- one healthy cellular phone and degraded venue-Wi-Fi phones complete the same question under the profiles above;
- one offline player prevents early all-in but the main timer and visible final window still finish;
- every eligible player confirming early produces exactly one all-in beat and reveal;
- a late join watches now and answers the next question;
- an offline Heather action never advances optimistically;
- two consecutive games, intermission, undo/replay, and reset do not leak prior questions, answers, commands, or result screens;
- the host-only notice is absent for players and does not enable new timing until the host explicitly chooses it;
- phone screenshots pass at 320×568, 360×640, 375×667, 390×844, 412×915, and 430×932 in portrait with no horizontal overflow, no clipped status/control, safe-area clearance, and answer targets at least 44×44 CSS pixels;
- landscape remains usable at 667×375 and 844×390;
- host and TV screenshots pass at 1280×720 and 1920×1080 at 100% browser zoom with no network-status overlay covering game content; at 1920×1080 the question is at least 48px, choices 28px, and carousel names 24px, with proportional minimums of 32px/20px/18px at 1280×720 and at least 4.5:1 text contrast.

### Live proof before Heather receives it

A real production smoke must use at least three player phones on mixed connections, the founder test host, and a mirrored display. It must visibly prove normal timer/final-window reveal, all-confirmed reveal, a lost-acknowledgement recovery, one handoff, one undo/replay, Game 1 to Game 2 transition, security-safe payloads, and no stale state. No smoke or enablement occurs during a live show.

## Definition of done

This refinement is done only when:

- a player never sees **Locked in** without a canonical server answer;
- every accepted answer scores at most once and every reveal happens at most once;
- brief network failures and network switching recover without another tap whenever at least one attempt reaches the server before the visible final-window deadline;
- no newly created answer can score after the authoritative final window;
- late joins and host-added score-only names cannot distort early reveal;
- an overdue play reconciles and scores confirmed answers once without guessing an outage or erasing valid scores;
- no player can impersonate another through public projections, raw headers, direct table writes, or exposed RPCs;
- every surface rejects old run IDs and lower room revisions;
- Heather retains the same Original-mode controls from her laptop, understands the visible two-second timing change, and explicitly chooses it before it reaches her nights;
- the TV and specified phone sizes meet the exact legibility, safe-area, and synchronization checks;
- the concurrency, recovery, visual, and two-game production proofs pass.

## Approaches rejected

### Always wait for the full timer

Safe but unnecessarily slow when everyone has answered. It weakens the room's energy.

### Ask Heather when to reveal or whom to believe

It turns network uncertainty into host work and makes fairness subjective.

### Trust phone timestamps or accept answers after reveal

It is vulnerable to clock changes, tampering, and knowledge of the revealed answer.

### Treat a missing answer count as an outage detector

Silence is valid player behavior. Missing answers alone cannot prove a network incident.

### Hide a server grace period after player controls freeze

The server cannot distinguish a delayed packet from a custom client that waited. A hidden grace window would give technical players an unfair advantage.

### Automatically void an overdue unresolved question

Delayed finalization does not prove an outage. Automatic voiding could erase legitimate confirmed scores.

### Chosen: server-confirmed all-in plus one visible final-answer window

It keeps fast questions fast, gives every player the same bounded final opportunity, preserves authoritative scoring, and adds no recurring host work after explicit opt-in.
