# Legacy Reset and scoring overlap: investigated and fixed locally

PR #190 was merged as `eec0c8b3ddb5f1b4ddd6df5fe59e1d75e2274d96` on
September 7, 2026. Its `resolve_question_once` migration was already present in
the hosted Trivia database before that merge. This follow-up changes only the
legacy Reset function and its tests. The new Reset migration has **not** been
applied to production.

## Confirmed cause and impact

The existing `reset_night_to_setup` function in `0021_live_security_gate.sql`
deletes reveal history before it waits for a concurrent scorer's answer writes.
A scorer can hold an uncommitted resolve event while Reset's earlier deletion
takes its snapshot. After the scorer commits, Reset removes answers and clears
question timestamps, but that resolve event survives. Cleanup counts also miss
the just-committed reveal and finished question.

The original two failing cases reproduce with both the old scorer and PR #190's
wrapper. The expanded baseline additionally reproduces with
`resolve_question_if_all_locked`. This is an existing defect, not a regression
introduced by PR #190.

The host-mode consequence is described in the
[original investigation](2026-09-07-pr190-verification-and-reset-race.md): a
restarted game can show the previous result and offer an advance that fails
because the old question is no longer finished. That conclusion comes from the
database reproduction and source tracing, not a rendered browser reproduction.

A read-only check of the hosted Trivia database on September 7 found **zero**
resolve events whose question had both `played_at` and `finished_at` cleared.
That checks the specific leftover-event pattern at the time of the query. It
does not establish whether the race has ever occurred or cover other forms of
stale game state. No production rows were modified.

## Focused correction

Migration
[`20260907134447_serialize_legacy_reset_with_resolution.sql`](../../supabase/migrations/20260907134447_serialize_legacy_reset_with_resolution.sql)
locks the target games' question rows, in question-ID order, before Reset counts
or deletes anything. The remainder of the function body is unchanged.

- If a scorer wins, Reset waits, then includes the committed result in both its
  cleanup counts and deletions.
- If Reset wins, a waiting scorer reads the cleared `played_at` after Reset
  commits and rejects the retired question. It cannot recreate its result.

`FOR NO KEY UPDATE` conflicts with the scorers' `FOR UPDATE` locks while
remaining compatible with foreign-key key-share checks. Only question rows are
explicitly locked; the join does not lock game/category parents ahead of the
scorer. These choices follow PostgreSQL's documented
[row-lock compatibility](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS).
Later statements use fresh snapshots under the existing default Read Committed
isolation; see [transaction isolation](https://www.postgresql.org/docs/17/transaction-iso.html#XACT-READ-COMMITTED).

The function keeps its existing service-role-only execute grants, privileged
execution context, pinned search path, arguments, and JSON response shape.
Generated client types do not change. The board, picked and unpicked questions,
players, and game participation records remain intact. The resilient Reset
function is unchanged.

## Verification

- Expanded real-PostgreSQL baseline: **27 passed, 3 failed**. The three failures
  are scorer-first overlaps with timer, manual, and all-locked resolution.
- Candidate migration: **30/30 database race tests passed**, including those
  three cases, all three Reset-first orders, replaying and scoring the same
  board after Reset, and the existing 40-caller and answer-engine races.
- Focused route, host-mode, and PGlite integration checks: **55/55 passed**.
- The new PGlite tests cover live/done cleanup, exact board preservation,
  participation preservation, ready-game adjustment isolation, idempotent
  repeat Reset, and anonymous/authenticated execute denial.
- `npx tsc --noEmit --incremental false` and `git diff --check`: passed.

The real-PostgreSQL harness used only loopback port 54322. The candidate function
was installed temporarily for the race run, then the original local definition
was restored and compared exactly. Test fixtures were cleaned up. The existing
database migration history was not modified.

The database race suite remains separate from `npm test` and GitHub CI. To rerun
it, prepare a local database containing the candidate migration, then run:

```bash
npm run test:db-races -- tests/concurrency/live-answer-races.test.ts
```

This verification addresses Reset overlapping the legacy scorers. It does not
make separate legacy Reveal/Undo/answer-admission HTTP requests atomic with
Reset, certify a rendered browser recovery flow, or establish venue capacity.
No full-suite/build rerun was performed locally for this SQL-only runtime
change; the focused checks above are the local evidence.

## Release boundary

This is a candidate database fix for review. Merging its source alone does not
change the deployed Reset function. Applying the new migration to production
requires the founder's separate approval. Until then, the existing guidance
remains: let a question finish resolving before using Reset.
