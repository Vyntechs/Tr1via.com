# Shortlist: which live-show fixes to prototype

Date: 2026-11-04. Based on production commit b71ec25, the eight research files, five designs and fifteen reviews. I read code in the clone and changed nothing live. Every size below is my estimate.

## Bottom line

Four candidates are worth building and testing, in this order:

1. Trigger and Crowd Close. Three migrations already written, plus a small server closer.
2. Database Clock. The same migrations, plus a one-second close job inside the database.
3. Code Only With Alarm. No live database change at all.
4. Core Only, Measure First. The trigger and the recorder, with no new closer. This is also the test control.

All four share one baseline, and the baseline does most of the visible work. No design had covered the TV, the host's red hotspot banner or the host's buttons, and no design had fixed the 400 refusal that turns a saved answer into a false failure. Reviewers raised those gaps in nearly every review, so they sit in the baseline rather than in any one candidate.

## What the reviews changed

The brief asks about 40-50 players. The reviews sorted the exposures by what has happened at that size.

Measured at big-room size:

- Unscored crossing answers get worse as rooms grow. 8 of the 11 unscored answers since 09-16 came from the 33-joined night, on closes at 25.04 to 25.24s, with gaps up to 0.61s between receipt and close. Big rooms close so close to the deadline that the roughly 240ms insert path gets caught across it.
- False wording and the hotspot screen are present in code and show up in any room.

Not seen at big-room size:

- Late closes. 0 of 672 questions on nights with 25+ eligible (05), and 0 of 1,000 finished questions on 12 nights with 20+ joined (SELECT by a reviewer). All 24 late closes in the 25s era were in rooms of 11 and 19. Limit: only 2 big nights ran the 25s timer, nothing has reached 40 eligible, and the 09-23 cause is still unknown, so this is thin evidence of safety and not proof.
- All-answered closes. 0 of 250 at 30+ eligible. Server auto-end adds nothing at the target size.

Claims that fell:

- The "14 seconds sooner" replay comes from a 1-player room (UM7RFV). In a 50-phone room the same blip closes on the timer, as it did that night, because a phone's timer-zero call landed at 41:18.055.
- "Requests keep landing" rests on one phone. The laptop on the same network sent nothing that reached Vercel for 14.7s (04). Any "5 requests a second" figure is arithmetic.
- 46 unscored overstates the problem. 35 were received at or after close, all before 09-16. Only 11 (3 correct) are proven on time. Any backfill may touch only those 11, and that stays the founder's decision.
- `after()` is not a retry for broadcasts. Once one closer commits, every later caller gets false, so nobody re-announces. The next landing request is a retry for closing only.

Checked and true:

- `HEARTBEAT_INTERVAL_MS` is 10,000 (app/(player)/room/[code]/page.tsx:109). The comment at heartbeat/route.ts:7 saying 5s is stale.
- The laptop is the TV in the default setup (AGENTS.md:3, components/host/HostLiveConsole.tsx:1). The /tv route exists for venues that prefer a separate tab (app/tv/[code]/page.tsx:22-24). The TV's 4s poll therefore does not exist on a mirrored TV.
- The refusal order bug is real. app/api/answers/route.ts:328-339 refuses before the player lookup at :372, so a resend of a saved answer gets a 400 and never reaches the 409 at :438.

## How I ranked

The test was what protects a real show, in this order: scores right, room told nothing false, room not visibly stuck, question closes anyway, and the risk added by the fix itself.

Candidate 1 ranks first because its scoring protection runs inside the insert and can't be skipped, and its closer can't do harm. A closer that fires only after the deadline can't end a question early. Its worst bug is a late close or a wasted read. That also explains why the server all-answered close was dropped, since that is the one path that can end a question early.

Candidate 2 ranks second. It closes without Vercel, which only matters if the unknown 09-23 cause was a fault in the Vercel route, and its broadcast still waits for a landing request. It has the most unwritten code, and reviewers proved a list of defects on the rig that must be fixed first.

Candidate 3 ranks third. Its scoring repair passed on the rig (0 unscored of 2,520 rows) but rides on `after()`, which has no retry. Its alarm can't be proven until a Vercel preview is deployed, which is the founder's call.

Candidate 4 ranks last on robustness because a double fault leaves it waiting on browsers. It's still the first thing to ship under any choice, and if testing shows it passes almost everything, that is a strong case for stopping there.

What would change the order:

- If the founder refuses all live database changes, 3 moves to first.
- If a measured show has requests landing with no close at 25+ eligible, 2 moves up.
- If the preview proof shows a sleeping `after()` works, lift the alarm into 1. It is one file.

## Where reviews disagreed

| Question | Decision | Why |
| :- | :- | :- |
| FOR UPDATE or FOR SHARE in the trigger | Apply the repo file unmodified | One reviewer proved FOR SHARE safe (3,000 answers, 0 deadlocks, both key orders). Another showed the case for it is a 5.9s PATCH, not an answer insert, and its burst tail is worse (128ms against 63ms). Keep it as a one-statement follow-up if a slow insert is ever seen. Measure both in the race test. |
| Scoring repair keyed on `is_correct is null`, or also `locked_at < finished_at` | `is_correct is null` only, and log the rest | Every stored row passed the route's gate, and `receivedAt` is stamped before the route reads `finished_at`. The extra test compares a Vercel clock with a Postgres clock and left 22 of 45 rows unscored at a simulated 5ms offset. |
| Guard on undo's final update | No. Add a check at the top only | A refused final update would leave a finished question with its answers already deleted. A pre-read does not close the race (rig S1), and that race needs a close inside 2 to 5s of reveal, so it is small-room only. |
| Remove the host's 15s rebuild | Keep it | useRoomRoutePoll.ts:12 says that rebuild is the way out of backup mode. 04 clears it as a cause of the incident. Removing it could leave the TV on a 5s poll for the rest of the show. |
| Sweep questions in games marked done | No | A rig run moved game_scores from 0 to 300 on a done game. The UI blocks End Game during a question (HostPhoneClient.tsx:1222), and SELECT found 0 open questions on done games. |
| Tick wait of +0.5s or +1.2s | +1.2s | 452 closes in 45 days fell in 0.25s buckets of 171, 62, 29, 148, 39, 1, 2. At +1.2s browsers still win about 99%, so healthy nights keep today's path. At +0.5s the new code would close about half of them. Big rooms already close by 25.24s, so this only changes mid-size rooms. The 0.75-1.00s cluster is unexplained. |
| Heartbeat as a tick | Only if the alarm fails its proof | It is the only tick that needs extra reads and a memo. Player snapshots need none, because the route already holds the live question (snapshot/route.ts:310). |
| Retries at timer zero | Phones 3 sends, TV 4 sends, then stop | Uncapped retries mean about 51 devices sending for a whole blip, then all landing at recovery. |

## Common baseline

Every candidate includes these. The candidates differ only in what they add. Estimate: 450 to 550 lines plus tests, about 12 files.

**B1. Look up the saved row before refusing.** app/api/answers/route.ts. Replace the two early returns at :328-339 with a stored `lateReason`. Continue through the existing lookups to `player` (:372-383). If `lateReason` is set, select from `answers` by `question_id` and `player_id`. A row exists: return `conflict("already answered")`. No row: write the log line `{kind:"late_refusal", questionId, lateMs}` and return `badRequest(lateReason)`. Run the same lookup in the three insert-error branches at :432-434 (TR025, TRCL0, TRNL0). Add a test: saved answer, reply lost, resend refused at 25.000 returns 409.

**B2. The phone never states something it can't know.**
- lib/hooks/useAnswerSubmit.ts: add failure reason `late` for a 400 with those two messages. It must not call `stopAll`, so a request in flight can still confirm.
- Show the late line only if this was the only send and nothing is in flight. Otherwise stay on "still checking".
- At zero, `settleFailed("closed")` (:319, :347) must keep the stored pending answer until a snapshot shows a row or the reveal.
- components/player/PlayerSendStatus.tsx:114-117: replace "Didn't go through, retrying" with "Still checking your answer", and "We couldn't confirm your answer" with "Still checking. If it reached us, it counts." Drop the toppled mascot for that state (PlayerLocked.tsx:213).
- Remove the resend button once the question has closed.

**B3. Resends that can beat the deadline.** useAnswerSubmit.ts: quiet timer becomes `clamp(remainingMs - 1500, 1500, 6000)`. The 1,500 covers a 1,000ms landing margin plus the existing 500ms backoff at :85. Send no follow-up with under 750ms left. Keep the on-screen status on its own 6s timer, so a slow reply near zero doesn't flip the wording. Sends that fail outright keep today's uncapped retry.

**B4. Hotspot screen held back on phones.** lib/realtime/reachability.ts gains `unreachableSince`. page.tsx:233 shows `UnreachableScreen` only with no room in memory and no saved recent join, or after 45s unreachable. A reloaded phone with a saved join shows "Reconnecting" for those 45s. ConnectionRibbon.tsx:39-41: soft "Connection's slow" until 25s, then the cellular hint, so a lone phone on dead WiFi still gets help. Reword "held locally", which is false past the deadline.

**B5. The same rule on the laptop.** components/host/HostConnectionBanner.tsx:23-33: no red hotspot pill for 45s when a good room view is in memory. Show amber "Slow connection. Game still live." lib/hooks/useRoom.ts:373-375: set unreachable only after two failed route-poll cycles.

**B6. A calm TV that needs no network.** All three parts ship together.
- app/tv/[code]/page.tsx:79: render the message screen only when `!snapshot`, so a failed poll keeps the last frame.
- lib/hooks/useTVRoom.ts:216-219: a safety poll skips if one is in flight and under 5s old. Broadcast refetches still abort and restart.
- components/tv/TVQuestion.tsx:309: TIME'S UP at zero in every theme. TVStateMachine shows "Locking in answers" at local zero + 3s with no close seen, from the local timer only. This reaches both /tv and the embedded panel at HostLiveConsole.tsx:246.

**B7. Host buttons survive a lost reply.** New lib/host/hostFetch.ts with an 8s abort. Use it in handleReveal, handleAdvance, handleUndo, handleStartGame, handleEndGame and handleEndEarly in app/host/live/[nightId]/HostLiveConsoleClient.tsx:455-560, and the same actions in HostPhoneClient.tsx.
- On timeout show "Sent, checking" and call `reReadRoom`. Never auto-retry a reveal.
- Treat "question already revealed" and "another question is already live in this game" as re-read, with no red toast.
- Disable the tile while in flight, and add the optimistic played mark the host phone already has.
- Check `isAlreadyResolved` before the `requireAllLocked` branch at :536.
- `busy` always clears on the host phone.

**B8. Host polls.** HostLiveConsoleClient.tsx:232 and :298 become self-scheduling loops: one in flight, 4s abort, next run 2s later with 15% spread. Start the route poll on the first missed direct read (useRoom.ts:899-906) with its own abort controller. The 15s rebuild stays.

**B9. Timer-zero ladder with the timer fix, in one deploy.** New lib/game/resolveAtZero.ts, called from page.tsx:923-932 and TVStateMachine.tsx:555.
- `/resolve` adds `retryInMs` to the "window still open" 409 (route.ts:~291). Wait `retryInMs` plus a positive 100-300ms. These waits don't count against the cap.
- Network failure, 5xx or a 3s timeout retries at 1-2s, then 2.5-4s. Phones send at most 3 times, the TV 4.
- Call `onResolveSettled` once at the end. That final refresh is also the recovery if a close's broadcast is lost.
- lib/hooks/useTimer.ts:60-66: compute the offset from a `receivedAtMs` stamped when the reveal broadcast arrives in useRoom, and don't reset it to 0 on re-render. Never ship this without the ladder, or a phone firing exactly at zero gets one 409 and gives up.

**B10. One winner on end-early, and no table locks.** app/api/games/[id]/end-early/route.ts:123-139.
- For `requireAllLocked`, do a lock-free check: `game_participations` joined to `players` (removed_at null, can_answer true) against `answers` for the question. Require more than 0 eligible and matching sets.
- Both branches then call `resolve_question_once`. Broadcast only on true. On false return `conflict("question is already resolved")`.
- This stops the double broadcast (`resolve_question_if_all_locked` returns true when already finished) and takes the all-nights table locks (0021:152-153) out of the show.
- lib/hooks/useAllLockedAutoReveal.ts: cap retries at 1.2, 2.4 and 4.8s.

**B11. Undo refuses a finished question.** app/api/games/[id]/undo/route.ts: after reading `latest`, read `finished_at` and return a conflict if set. Leave the final update alone.

**B12. Spread recovery only.** useRoom.ts: when a player's channel rejoins or reachability returns to ok, do one snapshot refresh after a random 0-2,000ms. Normal question-event refetches stay immediate.

**B13. Say who closed it.** New lib/live/logClose.ts. Every close path writes `{kind:"close", questionId, roomCode, closedBy, lateMs}` after its broadcast. Phones and TV send a header naming the caller to `/resolve`. Add a post-show query run by an automated job, so nobody has to remember it.

**B14. Shared test harness, built once.** A proxy that forwards requests and holds replies for 13s, run against local Next on the rig. This needs PostgREST on the rig, which 08 lists as possible and untried (Mac build available). Fallback: route-handler tests with a dropped-reply fetch stub, plus the SQL race tests. Also fix the fixture in tests/concurrency/live-answer-races.test.ts, and add a contract test pinning SQL's 25 seconds to `questionDurationFor`. The harness must show the host and TV too, not phones alone.

**B15. Rules around shipping.**
- No deploy or migration while any night is open or scheduled that day. Real shows include Fridays and one Tuesday, and a Wednesday started at 13:40.
- One behaviour change per show, with a stated pass and fail.
- Diagnostics first where the candidate has them.
- One run sheet: what failure looks like, who decides, never refresh the laptop in a freeze, and the host phone on cellular.
- Confirm the Vercel plan and Skew Protection before relying on rollback. Hobby only goes back one deployment, and new pushes stay held until Undo Rollback.

## Candidate 1: Trigger and Crowd Close

Live database change: yes, three files already in the repo. Size: baseline plus about 120 lines.

**Build.**

New lib/live/closeDue.ts:

- `CLOSE_DUE_AFTER_MS = 1200`.
- Move `broadcastLegacyResolveBestEffort` from the resolve route into this file and import it back.
- `closeQuestionIfDue(admin, {questionId, expectedPlayedAt, roomCode, source})`:
  1. Read the question. Stop unless `played_at` equals `expectedPlayedAt`, `finished_at` is null, `played_at` is under 10 minutes old, and now is at least deadline + 1,200ms, using `questionDurationFor`.
  2. Call `resolve_question_once` directly with no PGRST202 fallback. Treat P0001 as a clean stop. On another error wait 500ms, redo step 1, retry once.
  3. On true, broadcast `resolve` with `{questionId, correctIndex, refetch:true, serverNow}`, then `broadcastFireworks(roomCode, "salvo", questionId)`. Never retry a broadcast.
  4. Call `logClose`.
- `/resolve` itself is unchanged except for B9 and B13.

Ticks:

- app/api/room/[code]/snapshot/route.ts, after line 310: if the night is legacy, the game is live and the question is overdue, await `closeQuestionIfDue(...)` inline, raced against a 1,500ms cap. Inline matters. Whether `after()` work finishes when a reply can't be delivered is unverified, so these ticks must not depend on it. The cost is a slower reply on the one snapshot that does the close, on a rare path.
- app/api/tv/[code]/snapshot/route.ts: same, from the live question read at :124-128.
- Keep a per-instance Map allowing one attempt per question per 500ms, so the other phones' snapshots skip straight past.
- No heartbeat tick and no alarm.

Switches: `LIVE_CLOSE_MODE=off|shadow|on` and `LIVE_CLOSE_NIGHTS`, an allow-list of night ids. Shadow logs "would have closed" and does nothing else. Both need a redeploy, so they work between shows only. That is acceptable because a post-deadline closer can't end anything early.

Migrations, each a named file applied alone, never `db push --include-all`:

1. 20261007180000 diagnostics, plus `DIAGNOSTIC_LOGGING=on` and `CRON_SECRET` with a deploy. Run one show alone for a baseline.
2. After B1 is live, 20260915182433 unmodified. New rule for players: an answer received after close gets a 400 where today it is stored unscored.
3. 20260907134447. This replaces `reset_night_to_setup` and takes effect at once, so it is not inert. It addresses 2 reset deadlocks in 30 forced rig rounds.

20260831135541 is image handling and stays out.

Rollout: baseline, then shadow for one show, then on.

**Tests.**

| # | Result | Detail |
| :- | :- | :- |
| 1 | Partial | Phones close it at zero as they do today, and the tick backs that up at 26.2s. Phones get the reveal. A mirrored TV holds TIME'S UP from its local timer until the laptop returns. The next question waits for the host, or the host phone on cellular. |
| 2 | Pass on scoring, partial on screens | Every answer that lands before 25.000 scores. Phones say "Still checking", with no hotspot screen. Locked in and the reveal still need a reply to get through. |
| 3 | Partial | Early clock passes through `retryInMs`. With all zero calls lost, a phone snapshot must land between 26.2 and 27.0s. At 50 phones that is likely, not certain: my rough estimate from 3.3 snapshots a second is a 7% miss if all land and worse if few do. Rooms under about 20 may miss the 2s line. Nothing landing means nothing closes, and nobody can be told either. |
| 4 | Pass on the rig | 0 deadlocks. Inserts run single file per question (p50 1.1ms, max 19.4ms). Behind a stuck writer, 1,013ms against 19.7ms for FOR SHARE. No table locks after B10, so other nights are untouched. Not load-tested live at 50. |
| 5 | Pass | One winner and one broadcast through `resolve_question_once`. Fireworks unchanged. Undo refuses closed questions, narrow race aside. Removed players and can_answer are filtered. A joiner inside about 20ms misses that question, as today. |
| 6 | Pass going forward | The trigger scored crossing answers in the forced race (0 unscored). A first send landing at or after 25.000 is still refused. The 46 old rows are untouched. |
| 7 | Partial | Host polls guarded, recovery spread over 2s. One wake still costs 157-500 calls and about 110KB per phone (raw row size). Unmeasured on real WiFi. |
| 8 | Needs live change | Three existing files. Undo: `drop trigger answers_enforce_legacy_deadline on public.answers`, Vercel rollback, drop the diagnostics tables if wanted. The reset function needs its old body restored by hand. |

**Biggest risk.** The trigger's refusal is a rule change, and it rests on two clocks. A close stamped early by a Postgres clock behind Vercel's could refuse an on-time answer. No such case in 658 closes, and the post-show query checks for any timer close under 25.000s.

## Candidate 2: Database Clock

Live database change: yes, five steps plus pg_cron. Size: baseline plus about 150 lines of SQL and 250 of app code.

The difference from Candidate 1: closing moves out of Vercel into a job that runs whether or not any device is talking.

**Build.** Migrations 1-3 from Candidate 1, then a new one from scratchpad/dbclock/candidate.sql with these changes. They fold in the rig findings and drop the fast path.

1. Delete `close_question_if_complete`, `_answer_counts` and the all-answered branch. The sweep closes timers only. All-answered stays with the host hook. This also removes the undo race (S1), the undo floor and the `played_at` versus reveal-row problem, because a 26s close can't meet a 2s undo window.
2. Delete `db_broadcast` and every `realtime.send`. Delivery to public channels is untested.
3. Timer rule: `v_now >= played_at + 25 seconds + live_clock.grace_ms`, default 1,000. Closes land 26.0 to 27.0s. Healthy nights stay on the browser path.
4. Row lock becomes `for update skip locked`, so a stuck room can't hold others (S3 showed 2,024ms). Rerun S3 and require the healthy close visible in under 100ms.
5. `question_close_events` gains `played_at` and `commit_at`. Stamp `commit_at` with `clock_timestamp()` after each close, because `finished_at` hides a late commit.
6. `claim_close_broadcasts` joins `questions` and requires `finished_at` set and `played_at` equal to the stored value. Rows that fail are marked dropped. This covers reset and undo (S1, S2).
7. Replace `claim_count < 3` with a time budget: rows under 60s old, 3s lease, limit 3 per claim. Log give-ups.
8. Keep `live_clock` modes off, shadow, on, and `only_night_id`.
9. `cron.schedule('tr1via-close-due', '1 second', 'select public.close_due_questions()')` plus a daily trim of `cron.job_run_details`. A one-minute job turns the 1s job on only while a game is live, which avoids about 605,000 idle runs a week.

New lib/api/closeOutbox.ts:

- `drainCloseOutbox(admin)` runs at most once a second per instance. It calls the claim function, then for each row sends `resolve`, stamps `sent_at`, then sends fireworks separately with `roomCode` and `questionId`, no retry.
- A 750ms timeout counts as possibly sent. Stamp it and don't resend. Only a definite refusal goes back for retry.

Call the drain in `after()` from:

- heartbeat
- player and TV snapshots
- the top of the answers handler, above the early refusals
- both `alreadyResolved` returns in `/resolve`
- end-early
- advance
- reveal, before its own broadcast, so a queued close goes out ahead of the next question

Route closes keep their single best-effort broadcast. Say so plainly: the outbox protects sweep closes only.

Rules:

- Rollback order is hard: mode off, then Vercel rollback, then unschedule, then drop functions.
- Add an automated pre-show check: job ticking, mode correct, `only_night_id` empty, no unsent rows.
- The rig has no pg_cron, so prototype with a 1s loop.
- The reply-drop harness is a hard gate before mode on.

**Tests.**

| # | Result | Detail |
| :- | :- | :- |
| 1 | Partial | Closes by 27.0s with no device at all. Phones hear once a request lands. The laptop hears through postgres_changes on return, the one thing here no landing-request closer gives. The next question still needs a host. |
| 2 | Pass on scoring, partial on screens | Same as Candidate 1. Rig: 960 on-time answers, 0 refused, 0 unscored. A close sent during the blip may go unheard, so phones rely on B12 and the 15s refresh. |
| 3 | Pass on the rig, unproven live | Needs no device. The rig used a 100ms loop, so a true 1s tick on this project is unproven. If nothing lands, the close happens but the broadcast waits. |
| 4 | Pass on the rig | As Candidate 1. The sweep takes no table locks and skips busy rows. One tick is one transaction, so S3 must be rerun. |
| 5 | Pass on the rig | 60 forced races, one winner each. 20 claimers, 1 row. Fireworks path unwritten and untested. A slow acknowledgement can't double-send after the timeout rule. |
| 6 | Pass going forward | Trigger, as Candidate 1. |
| 7 | Partial | As Candidate 1, plus a throttled claim call at recovery. |
| 8 | Needs live change, reversible | Five steps. Off switch is one SQL write, which nobody at a show can run. Closed questions stay closed. |

**Biggest risk.** A new closer for every room at once, with nobody at the show able to stop it. Second, a rollback in the wrong order silently drops the reveal broadcast on any sweep close.

## Candidate 3: Code Only With Alarm

Live database change: none. Size: baseline plus about 250 lines.

The difference from Candidate 1: no founder database decision, and no trigger, so scoring moves into app code and closing gains a server alarm.

**Build.** closeDue.ts and the inline snapshot ticks as Candidate 1, plus:

*Scoring repair.* New lib/live/scoreLateAnswers.ts. `scoreLateAnswers(admin, questionId)` reads rows with `is_correct is null`, scores each with `awardPoints` (lib/game/score.ts) from the stored `chosen_index` and `ms_to_lock`, and updates `where id = ? and is_correct is null`. Log any row with `locked_at >= finished_at`. Run it in these places only:

- `after()` in the answers route, on insert success and on 23505, after re-reading `finished_at`. A duplicate reads the stored row, never the resend's values.
- The B1 branch that returns 409.
- `closeQuestionIfDue`, after the broadcast, in a try/catch with a 1s cap.
- The reveal route, for the previous question in the same game.
- The end route, for the last question.

Only touch questions finished in the last 10 minutes, so the 46 old rows are left alone. If a repair wrote any row, send one refetch hint after 2s. Never write to the resolve row from a later sweep, because a reveals update can replace `currentReveal` and flip a mirrored TV (lib/hooks/useRoom.ts:1772, lib/host/roomToTVSnapshot.ts:232).

*Alarm.* app/api/games/[id]/reveal/route.ts: add `export const maxDuration = 60`. Right after the `played_at` stamp succeeds (:~157), call `after()`: sleep to `played_at + 25,000 + 1,200ms`, then run the closer with `source:"alarm"` and `expectedPlayedAt`. Log every wake with outcome won, lost or stale, and lateness. At +1.2s most wakes lose to browsers, so the log proves the alarm runs on every question.

*Hard gate, founder's call.* Before any show, a preview deployment proves a 26s `after()` sleep completes when the client drops the reply, and that 60s works on the actual plan. If it fails, drop the alarm and add a heartbeat tick with a per-instance memo.

*Measurement.* No diagnostics tables here. Write `closed_by` and `late_ms` into the newest resolve row's `metadata` at close time only. Log lines cover the rest, and an automated job pulls them right after each show because retention is unverified. Fold resend count, longest reply wait and seconds at zero into the heartbeat body and log them.

*Off switch.* None mid-show. `LIVE_CLOSE_MODE` as Candidate 1, shadow for one show first. Rollback changes server routes only. JavaScript already on 50 phones keeps running until each person reloads.

**Tests.**

| # | Result | Detail |
| :- | :- | :- |
| 1 | Partial | Same as Candidate 1, with the alarm closing it even if nothing lands, if the gate passes. |
| 2 | Pass on scoring with an after() caveat, partial on screens | Rig: 0 unscored of 2,520 with the re-read. If the `after()` dies, the next-reveal sweep repairs it later, so a reveal can show no points for a moment. |
| 3 | Pass if the gate passes | Alarm at 26.2s with 0.8s of margin, needing no device. Otherwise as Candidate 1. |
| 4 | Pass, reasoned | No new locks on the insert path. 3 small reads per answer after the reply. Needs a rig run at 50. |
| 5 | Pass | 180 of 180 clean rounds on the repair batches. Undo race as baseline. |
| 6 | Pass for saved rows | Depends on the lock order the rig confirmed. Rig limits: no network, PostgREST or Vercel. |
| 7 | Partial | As Candidate 1, plus sweep reads. |
| 8 | Code only | Vercel rollback, with the limits above. |

**Biggest risk.** The alarm and the scoring repair ride on `after()`, which has no retry, and a sleeping alarm has never run on this project. Second copy of the scoring rule in TypeScript, checked against SQL at 7 point values and 4 timings with 0 mismatches.

## Candidate 4: Core Only, Measure First

Live database change: yes, two files. Size: baseline only.

The difference: no new closer. The baseline ladder is the only change to closing. Apply 20261007180000 and 20260915182433 as in Candidate 1, leave 20260907134447 for later, run shows, then decide from data.

Stop rule: add Candidate 1's ticks only if the recorder shows a close over 27s, or requests landing with no close, at 25+ eligible. In prototype testing this arm is the control, showing what each closer actually adds.

**Tests.**

| # | Result | Detail |
| :- | :- | :- |
| 1 | Partial | Phones close it, as today. |
| 2 | Pass on scoring, partial on screens | As Candidate 1. |
| 3 | Partial | Early clock passes. If all phone and TV calls are lost, it stays open until a retry lands. Fails the literal test. |
| 4 | Pass on the rig | As Candidate 1. |
| 5 | Pass | B10 applies. |
| 6 | Pass going forward | Trigger. |
| 7 | Partial | As Candidate 1. |
| 8 | Needs live change | Two files, drop trigger to undo. |

**Biggest risk.** If the 09-23 cause returns in a big room, this has no server backstop.

## Dropped

- Server all-answered close at 40-50. 0 of 250 at 30+, and it is the only automatic path that can end a question early.
- Heartbeat tick. Extra reads and a memo for a double fault, except as the alarm's fallback in Candidate 3.
- `realtime.send` fast path. Delivery to public room channels is untested, and it fails silently.
- `close_due_questions` as a function called from Vercel routes. `resolve_question_once` already names a timer winner, and the all-locked logic has no value at target size.
- FOR SHARE port. See the table above.
- One-second buzzer grace. It is the only idea that rescues a first send lost in the last second, and 4.7% of answers land in the final 2 seconds (05). It costs about 1.2s per question, about 100s a night, on every normal question. Reopen once B1's refusal log has a real show of counts. The timer fix may remove much of the need.
- Hedged sends capped at 5. A regression from today's uncapped retry on outright failures. B3 gets most of it from one formula.
- Heartbeat check mode. It shares the return path that failed.
- Local reveal and question flips from broadcasts. Delivery during a blip is unknown, a redelivered old broadcast caused a real flip on 2026-06-19 (lib/hooks/resolvedQuestionState.ts:8-13), and phones could spoil the answer before the TV.
- Always-on 0-2.5s refetch spread. It staggers the reveal 84 times a night against no observed harm. B12 keeps it for recovery.
- Snapshot sharing keyed per wake. Per-instance, and Fluid status is unknown. Measure wire size at 40+ first, then split static board from live state if it's large.
- Removing the 15s host rebuild. See the table above.
- Slimming `/resolve` to one read. The ladder's roughly 600 small reads over 6s are harmless, and the engine check needs the night read anyway.
- Finishing resilient_v1. 9-task plan, 43 files, doesn't self-close, 25 vs 30/32s mismatch.
- TypeScript mop-up alongside the trigger. Two scoring rules for no gain.
- Backfilling the 46 rows. Only 11 are proven on time, and that's the founder's call.
- Device delays at zero. With a +1.2s closer they aren't needed.
- Outbox rows for route closes, and step 8 of the dbclock plan. It adds a pause at zero on every question.

## Still unverified

- Whether a sleeping `after()` runs on this project, and whether it runs when the reply can't be delivered.
- Vercel plan, Fluid Compute, Skew Protection, log retention, and whether a preview shares the production database.
- pg_cron at one second on this project.
- Landing rate at 50 phones during a blip. One phone's evidence only.
- Whether sockets delivered during the incident.
- The 09-23 cause, and the 0.75-1.00s close cluster.
- Whether Vercel and Postgres clocks disagree by over a few tens of milliseconds.
- Which TV setup real shows use. `surface_observations` has no rows, so only the owner can answer.
