# Candidate 2 prototype: Database Clock

Branch proto/c2 in ROOT/wt-c2, head commit 7e44581, on top of proto/base. Local only.

A Postgres function now closes overdue legacy questions on a 1-second tick, whether or not any device is talking. It writes a row to an outbox table. The next request that reaches Vercel claims that row and sends the reveal. Route closes are unchanged and keep their single best-effort broadcast, so the outbox protects sweep closes only.

## What was built

Migration supabase/migrations/20261104120000_live_clock_db_close.sql, from dbclock/candidate.sql, with all nine listed changes:

1. `close_question_if_complete`, `_answer_counts` and the all-answered branch are gone. Timers only.
2. `db_broadcast` and every `realtime.send` are gone.
3. The rule is `played_at <= now - 25s - grace_ms`, with grace_ms defaulting to 1,000. It sits in the candidate query, so a row that isn't due is never touched.
4. The row lock is `for update skip locked`. `lock_timeout` stays at 500ms for whatever `resolve_question` locks inside, and it's set before the tick stamp, so a session holding the `live_clock` row can't hang the tick.
5. `question_close_events` gains `played_at` and `commit_at`. `commit_at` is `clock_timestamp()` taken right after each close.
6. `claim_close_broadcasts` checks `questions`: finished_at set and played_at equal to the stored value. Failures get `dropped_at` with reason `question_changed`.
7. `claim_count < 3` is replaced by rows under 60s old, a 3s lease and limit 3 per claim. Older rows get reason `expired` plus a `raise warning`.
8. Modes off, shadow, on and `only_night_id` are kept.
9. `cron.schedule` for the 1-second job, a daily trim of `cron.job_run_details`, and a one-minute gate (`live_clock_cron_gate`) that keeps the 1-second job on only while a legacy game is live. All of it is skipped when pg_cron isn't installed, so the migration applies on the rig.

lib/api/closeOutbox.ts has `drainCloseOutbox` and `scheduleCloseDrain`. It claims, sends `resolve`, stamps `sent_at`, then sends fireworks with roomCode and questionId, with no retry. A 750ms timeout is stamped `rest-timeout` and never resent.

The drain runs in `after()` from heartbeat, both snapshots, the top of the answers handler, both `alreadyResolved` returns in /resolve, end-early and advance. Reveal awaits it inline (see below).

Pre-show check: SQL function `live_clock_preshow_check()` and scripts/live-clock-preshow.mjs, which prints one PASS or FAIL line. It covers job ticking, mode, `only_night_id` and unsent rows.

Migrations 1 to 3 from Candidate 1 are already in the repo and weren't touched. The rollback order is written at the top of the new migration.

## Size

| Part | Lines |
| :- | :- |
| Migration | 296 |
| lib/api/closeOutbox.ts | 125 |
| scripts/live-clock-preshow.mjs | 26 |
| Route call sites, 8 files | 26 |
| lib/supabase/types.ts | 92 |
| tests/integration/live-clock-db-close.test.ts | 324 |
| tests/unit/closeOutbox.test.ts | 191 |
| tests/unit/api-reveal-route.test.ts | 40 added |

The spec guessed about 150 lines of SQL. The real file is 296, because the pre-show check, the gate and the cron block were not in the candidate file.

## Turning the arm on

The seed row sets mode to `on`. The column default stays `off`, and a live migration must seed `off`. `--env LIVE_CLOSE_MODE=on` is Candidate 1's switch and does nothing here. The arm needs:

    node room/matrix.mjs --worktree ../wt-c2 --policy room/policies/floor.json --label arm-dbclock --rebuild \
      --mode repo-head --migrations ../wt-c2/supabase/migrations \
      --db-tick "select public.close_due_questions()"

`--mode repo-head` matters. prod-parity skips three of the migrations this candidate depends on, including the deadline trigger. repo-head also loads 20260831135541, the image migration the shortlist keeps out. I don't expect that to touch closing, but I didn't test it either way. To keep it out, point `--migrations` at a folder holding the repo files minus that one, or stay in prod-parity with the other three copied under new file names (RUN.md, the rig skips by file name). This candidate changes no client code, so room/devices.mjs needs no port.

## Changes from the spec, and why

- Reveal can't drain in `after()`, since that runs after the reply and the spec wants the close out before the reveal broadcast. It awaits inline with a 1,000ms cap, and I put it before the `played_at` stamp rather than just before the broadcast. After the stamp, a slow drain would eat into the players' 25 seconds.
- Reveal skips the once-a-second limit (`urgent`), so the limit is not strict on that one path. Without this, a heartbeat drain a moment earlier could block the one drain that matters. If a drain is already running, reveal joins it.
- Network errors with no HTTP reply go back for retry. The spec says only a definite refusal does. These errors are usually a failed connection, and a duplicate costs one refetch where a miss leaves phones waiting for the 15s refresh. A reset after the request left could double-send.
- The claim call has a 750ms abort, which the spec doesn't name. It keeps a stuck database from holding reveal.
- `event` and `reason` columns are removed, because the sweep now only closes timers. The shadow index moved to `(question_id, played_at)`.
- Added columns: `dropped_at`, `drop_reason`, `live_clock.grace_ms`, `last_tick_at`, `last_gate_at`. `last_tick_at` costs one row write per tick, and it's what lets the check work without pg_cron. The advisory lock comes first, so overlapping ticks can't queue on that row.
- The check treats a recent gate run as ticking when no game is live, because the 1-second job is rightly off then.
- The drain writes a `close_outbox` log line, not a `close` line. A `close` line would stop harness/room/closers.mjs labelling the question `db-tick`.

## Test results

Exact counts:

- `npx tsc --noEmit`: exit 0, 0 errors.
- vitest, touched files only, `--maxWorkers=2 --minWorkers=1`: Test Files 19 passed (19), Tests 172 passed (172). `--maxWorkers=2` alone refuses to start here. Log: logs-proto/c2-vitest-touched.log.
- Rig script dbclock/test-c2.mjs on a private copy at port 54340, since removed. PASS in both modes.

| Check | repo-head | prod-parity |
| :- | :- | :- |
| S3, healthy close visible, worst of 5 rounds, 4 stuck rows ahead | 4.3ms | 3.7ms |
| 40 forced races, 2 sweepers and 5 route callers, rounds without exactly one winner | 0 | 0 |
| Winners, sweep / route | 31 / 9 | 30 / 10 |
| 20 claimers, one row | 1 claim | 1 claim |
| Close time on a 1s loop | 26.006s | 26.007s |
| Idle tick p95 | 0.3ms | 0.2ms |

The S3 target was under 100ms, and the old lock showed 2,024ms. The stuck rows stayed open and all four closed on the next tick. The script also confirmed a reset after close leaves nothing to claim, the service role can claim and stamp, and anon is refused all five calls.

The closer is SQL, so the requested closer tests run real SQL in pglite (tests/integration/live-clock-db-close.test.ts, 15 tests), not as a TypeScript mock. They cover not overdue, stale played_at, already finished and one row only on a win. "One broadcast only on a win" splits in two: the SQL test proves one row and one claim, and tests/unit/closeOutbox.test.ts proves one claim gives one resolve and one fireworks. A new reveal test proves the order is queued resolve, stamp, reveal.

## Not done or not checked

- No stack or matrix run, per the brief. So the drain has never gone through the real `after()`, the REST stand-in or the gateway. Those paths are covered by mocks and SQL role checks only.
- tests/concurrency, next build and the full vitest suite weren't run.
- Real pg_cron wasn't used. The schedule block and gate ran against a stand-in `cron` schema in pglite. pg_cron's source accepts `'1 second'` (`TryParseInterval` in src/job_metadata.c, range 1 to 59), but I did not check which pg_cron version the live project has.
- pglite doesn't load the full migration chain, because it lacks Supabase's storage schema. It loads 0001, 0002, 0021 and resolve_question_once, then adds `answer_engine` by hand. The full chain ran on the rig.
- S3 covers locks on the question row. A lock elsewhere inside `resolve_question` still costs up to 500ms per room, in the one tick transaction. I couldn't think of a real case that doesn't also hold the question row, and I didn't test one.
- The pre-show script exists but nothing runs it on a schedule. Someone or something still has to start it before a show.
- dbclock/test-c2.mjs lives under ROOT and isn't on the branch, because it depends on rig-pg.

## Known weak spots

- If the `sent_at` stamp fails after a good send, the lease resends and the room refetches twice.
- The gate runs once a minute, so a game can go live up to 60s before the 1-second job starts. A very fast first question could miss the sweep and rely on the browser path.
- The spec's biggest risk stands. This is a new closer for every room at once, and the off switch is a SQL write nobody at a show can run.
- Rollback order is hard: mode off, Vercel rollback, unschedule, drop functions. The reply-drop harness is a hard gate before mode on.
