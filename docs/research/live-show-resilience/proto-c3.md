# Prototype: Candidate 3, Code Only With Alarm

Branch proto/c3 in wt-c3, commits 0e6fe86 and 312eb28 on top of proto/base 5fefaa0. Local only. Nothing is pushed or deployed, and no migration is included.

## What I built

**Closer (lib/live/closeDue.ts).** `closeQuestionIfDue` follows the Candidate 1 steps: read and check, `resolve_question_once` with no PGRST202 fallback, P0001 as a clean stop, one retry after 500ms on any other error, then one `resolve` broadcast and one salvo for the winner only, then `logClose`. `broadcastLegacyResolveBestEffort` moved here and /resolve imports it back.

**Ticks.** The room and TV snapshot routes call `closeOverdueOnTick` inline, after auth and outside the shared load, capped at 1,500ms. A per-instance Map allows one attempt per question per 500ms. A snapshot on a question that isn't overdue costs no database call.

**Alarm.** The reveal route exports `maxDuration = 60`. Right after the `played_at` stamp it schedules `runCloseAlarm`, which sleeps to `played_at` + 26.2s and runs the closer with source `alarm`. Every wake logs one `alarm_wake` line with outcome and lateness. It skips the tick Map, so a tick can't silence it.

**Scoring repair (lib/live/scoreLateAnswers.ts).** It runs in the five places the spec lists and nowhere else. It reads stored rows, scores them with `awardPoints`, updates `where id = ? and is_correct is null`, and logs rows with `locked_at >= finished_at`. The 10-minute limit sits inside `scoreLateAnswers`, so no caller can reach old rows. A repair that wrote rows sends one refetch hint 2s later.

**Measurement.** `closed_by` and `late_ms` merge into the newest resolve row at close time, keeping `correct_index`. Phones add resend count, longest reply wait and seconds at zero to the heartbeat body, and the route logs them as `phone_stats`.

**Switches.** `LIVE_CLOSE_MODE=off|shadow|on` and `LIVE_CLOSE_NIGHTS`, both in .env.example.

## Size

App code: 21 files, +837 / -41. Tests: 9 files, +1584 / 0. The spec guessed about 250 lines, so this is about 3.3 times that. closeDue.ts is 294 lines and scoreLateAnswers.ts is 194, and both carry long comments. The heartbeat plumbing and extra log events add about 150 more.

New files: lib/live/closeDue.ts, scoreLateAnswers.ts, liveCloseMode.ts, afterReply.ts, phoneStats.ts.

Edited: app/api/answers, games/[id]/reveal, games/[id]/end, games/[id]/end-early, questions/[id]/resolve, players/[id]/heartbeat, room/[code]/snapshot and tv/[code]/snapshot routes, app/(player)/room/[code]/page.tsx, lib/live/logClose.ts, lib/api/broadcast.ts, lib/api/schemas.ts, lib/hooks/useAnswerSubmit.ts, useRoom.ts, useTVRoom.ts, .env.example.

## What I changed from the spec, and why

1. **The closer takes `nightId` and `themeKey` as well.** The allow-list needs the night, and `questionDurationFor` needs the theme to match /resolve.
2. **`LIVE_CLOSE_MODE` unset means off. `LIVE_CLOSE_NIGHTS` unset means every night.** The spec gave neither default. A harness run must pass `--env LIVE_CLOSE_MODE=on`, or this branch behaves like proto/base.
3. **The repair obeys the switch.** The spec gave it none. Off does nothing. Shadow counts rows and logs `score_repair` with `dryRun: true` and writes nothing, because the spec says shadow does nothing else. So the repair goes live with the closer, one show later than it could.
4. **New broadcast event `scores-refetch`.** The spec named no event. Re-sending `resolve` would replace `lastBroadcast`, and the phone and TV read the reveal tag from there for the clock offset. The next-reveal sweep sends its hint 2s into a new question, so that risk is real. Phones and the TV got a handler that leaves the tag alone. Old JavaScript ignores the event. The host has no handler, because its scores poll runs every 2s.
5. **/resolve and end-early write the close record too.** Otherwise `closed_by` would be blank for browser closes, which are most closes. They run no repair, as "these places only" requires.
6. **The close record goes after the broadcast.** design-codeonly.md put it before. After means a slow write can't hold up the room.
7. **The 409 branch repairs inline, capped at 1s.** That resend may be the only request getting through in a blip, and after() isn't proven when a reply can't be delivered. The cost is up to 1s more on that reply.
8. **Work that overruns a cap is handed to after().** The tick and the repair stop waiting at their cap, but the promise keeps running. Without this a function could freeze it after the reply.
9. **`afterReply` wraps after().** A failure to schedule can't turn a saved answer or a stamped reveal into a 500.
10. **One hint per question per instance.** A burst of resends each repairing a row would otherwise send one each.
11. **A failed heartbeat gives its stats back.** A blip is when those numbers matter most.

`closed_by` values added: `alarm`, `room-tick`, `tv-tick`. `clearCloseTicksForTest` in closeDue.ts is a test helper in app code. It does nothing unless called.

## Proof

- `npx vitest related` on every changed app file, `--maxWorkers=2 --minWorkers=1`: 87 files passed, 950 tests passed. Log: logs-proto/c3-related-final.log. This is not the full suite.
- New and extended test files alone: 8 files, 144 tests passed. closeDue.test.ts holds 38 of them, including stops when not overdue, stale `played_at`, already finished, and one broadcast only on a win.
- `npx tsc --noEmit`: exit 0.
- One later test edit added `gameIsLive: true` to the TV tick check. That file alone: 1 file, 11 tests passed. The related run above came before it.
- eslint on lib/live, the eight API routes and the new test files: exit 0.
- Seven deliberate breaks to closeDue.ts, each undone afterwards: removing the stale check, comparing `played_at` as strings, removing the finished check, the due check or the age check, broadcasting on a loss, and dropping the metadata merge. Each one failed at least one test.
- Stubs check on the diff: no TODO, skip, only or ts-ignore. The one test-only item is the helper named above.

## Limits

- **A local `next start` runs after() happily, and that proves nothing about Vercel.** Whether a 26s sleep finishes, and whether it finishes when the reply can't be delivered, is the founder's hard gate and is still open. So is whether 60s works on the actual plan.
- All of this ran against an in-memory stand-in for the database, with after() captured by the test. Nothing here touched Postgres.
- I didn't start the stack, run tests/concurrency, run next build, or run the full vitest suite, as the brief said. The rig's 0 unscored of 2,520 is earlier evidence and hasn't been re-run on this code. Test 4 at 50 phones hasn't been run either.
- No browser check. The page.tsx heartbeat body and the seconds-at-zero effect have no test at page level. phoneStats and its call in useAnswerSubmit do.
- The close record's update reaches `mergeRevealChange` on the host. I read that code and it replaces `currentReveal` with the same resolve row, but no test runs it.
- The phone whose snapshot did the close waits up to 1.5s and still gets a reply showing the question open, because the room was read before the tick ran. The `resolve` broadcast's refresh should cover it, but no test runs that pairing, and the spec didn't name this cost.
- A sweep skips a question finished over 10 minutes before the next reveal, so a long break right after a failed repair leaves that row unscored.

## Not built

- The automated job that pulls log lines after each show. That is the same gap B13 left on the floor. Without it the alarm's wake lines depend on log retention, which is unverified.
- The fallback heartbeat tick. The spec adds it only if the hard gate fails.

To undo: delete the branch. Nothing depends on it.
