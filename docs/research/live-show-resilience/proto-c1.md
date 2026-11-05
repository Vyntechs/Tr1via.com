# Candidate 1 prototype: trigger and crowd close

Branch proto/c1, commit b4f1086, on top of proto/base 5fefaa0. Worktree: wt-c1. Nothing deployed or pushed.

## What I built

When a legacy question is 1.2 seconds past its deadline and still open, the next phone, host or TV snapshot closes it. The room gets one `resolve` broadcast and one salvo, and one `{"kind":"close"}` log line is written.

- lib/live/closeDue.ts (new): `CLOSE_DUE_AFTER_MS`, `closeQuestionIfDue`, the moved `broadcastLegacyResolveBestEffort`, both switches, and `tickCloseIfDue`, which holds the 500ms per-question limit and the 1,500ms cap.
- app/api/room/[code]/snapshot/route.ts and app/api/tv/[code]/snapshot/route.ts: an inline tick, for legacy nights where the question belongs to a live game. The room tick sits after the authorization checks, so strangers and removed players can't trigger it.
- app/api/questions/[id]/resolve/route.ts: imports the moved function. No behaviour change.
- lib/live/logClose.ts: labels `snapshot-tick` and `tv-tick`, and a `close_shadow` line.
- .env.example: both switches.
- vitest.db.config.ts: the `@` and `server-only` aliases, so a rig test can import the real closer.

Switches are read on every call. `LIVE_CLOSE_MODE` takes `on` or `shadow`, and anything else or unset means off. With it off, a snapshot does no extra database work.

Migrations: no new files. The three the shortlist names are already in the repo and proto/base didn't change them: 20261007180000, 20260915182433, 20260907134447. 20260831135541 stays out, as the shortlist says.

## Size

Whole commit: 11 files, 1,054 lines added, 22 removed.

323 added lines sit outside tests/: 316 are app code and .env.example, and 7 are vitest.db.config.ts. The 316 compare with the shortlist's estimate of about 120. closeDue.ts is 241 of them, and about 20 of those moved from /resolve. The rest of the overrun is types, the switches, the tick function and comments.

Tests are 731 lines: closeDue.test.ts 299, legacy-close-race.test.ts 374, and 58 added to the two route test files.

## Proof

- Vitest, 8 touched files, `--maxWorkers=2 --minWorkers=1`: Test Files 8 passed (8), Tests 118 passed (118). closeDue.test.ts alone is 21 tests. It covers not overdue, played_at moved or cleared, 10-minute limit, already finished, one broadcast only on a win, lost race, P0001, the single retry, shadow, throttle, cap.
- `npx tsc --noEmit`: exit 0, no output.
- eslint on the touched source and test files: exit 0.
- I broke closeDue.ts four ways to check the tests notice: removed the lost-race stop, the already-finished stop, the played_at match and the overdue check. Each time 1 or 2 tests failed (2, 2, 1, 2). The file is restored.
- `vitest list` on the rig test found its 5 tests, so its imports resolve. It lists them without running them or touching a database.

Logs are in logs-proto/, named c1-*.

## Not run

**The rig race test has never run.** tests/concurrency/legacy-close-race.test.ts is typed and linted, but this brief ruled out tests/concurrency. Its SQL and its lock-queue assumptions are unproven until someone runs it. It may need fixes on first run. It needs the rig on 54322:

    cd rig-pg && node rig.mjs reset --mode repo-head
    cd ../wt-c1 && npx vitest run -c vitest.db.config.ts tests/concurrency/legacy-close-race.test.ts

It stops with a clear message if the trigger is missing, so a prod-parity rig fails on purpose.

If it fails, suspect `scoredByTrigger` in the first test before anything else. That check relies on Postgres keeping the queue order of 25 answers, the closer, then 25 answers. The checks that carry the claim (0 unscored, one `resolve` row, one winner) don't depend on order.

Also not run: `next build`, the full unit suite, the existing concurrency tests and the harness. Nothing here has been seen on a phone or against Supabase's web layer.

The FOR SHARE comparison isn't done either. The shortlist's "where reviews disagreed" table says to measure both locks in the race test, and this brief asked for FOR UPDATE only.

## Changes from the spec

1. `LIVE_CLOSE_NIGHTS` unset or blank means every night. The spec calls it an allow-list and doesn't say what blank means. Harness night ids are random and RUN.md's arm example passes only `LIVE_CLOSE_MODE=on`, so an empty-means-none rule would have made an arm silently do nothing. The cost: `on` with this variable blank covers every legacy night in production. Set it deliberately for rollout.
2. `closeQuestionIfDue` takes `themeKey`. The spec's input has no theme, and the deadline needs `questionDurationFor`. Routes resolve it the way /resolve does.
3. It also takes an optional third `deps` argument so tests can swap the clock and count broadcasts.
4. `tickCloseIfDue` is new. The spec describes the guard, limit and cap per route. Both routes need the same thing, so it lives in one place.
5. Tick position. Spec says after line 310 of the room route. That's before `liveGame` exists, so it sits just before the `live` projection.
6. Labels. `source` values are `snapshot-tick` and `tv-tick`, from harness/room/PORTED.md, so the harness reads them as written. A host-laptop snapshot that closes also says `snapshot-tick`.
7. Shadow line is `{"kind":"close_shadow"}`, so it can't be counted as a real close.
8. played_at is compared as an instant, not as text, so `Z` and `+00:00` match.
9. Rig test scope grew. "One broadcast" is counted through the real `closeQuestionIfDue` on real row locks, with a thin stand-in for PostgREST. There are two race shapes: one closer against 20 /resolve-style callers, and 20 closers. A gate transaction holds the row until every racer is queued. Two small tests were added: a first send at 25.000s gets TR025, and the closer leaves a question alone at 25.5s.

## Things to know before scoring it

- Harness arm needs `--mode repo-head`. Prod-parity skips the trigger and the reset migration by file name. Repo-head also brings in 20260831135541, which Candidate 1 keeps out, so that arm isn't an exact match unless those files are copied under new names (RUN.md:33). 20260831135541 is image handling, so I expect it not to matter here. I haven't checked that.
- The snapshot that closes replies with the room as it was before the close. On a phone with a working socket the broadcast queues a follow-up refresh. On a phone with a dead socket the reveal waits for its next poll. I left this as specified. Re-running the handler once after a win would fix it for that one phone.
- A close can commit with no broadcast. If the database commits but its reply is lost, the retry finds the question finished and stops. If the 1,500ms cap fires and Vercel freezes the function, the broadcast may never go out. Both are recovered only by polling, and the spec's "never retry a broadcast" accepts this. The freeze behaviour is unverified.
- The throttle is per instance. Several instances can each read and call the database, and the row lock still picks one winner.
- No client code changed, so PORTED.md needs no edit.
