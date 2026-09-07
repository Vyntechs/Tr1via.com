# PR190 verification and remaining reset race

Status: verification/report delivery, **not a reset fix**. The two reset-overlap
regression tests intentionally remain ordinary failing tests. No runtime code or
migration was changed by this follow-up.

## Source and scope

- PR: [#190](https://github.com/Vyntechs/Tr1via.com/pull/190).
- Runtime head verified: `2888ee4310d329f0ef96837238bf4ab339a6ac0a`.
- Fetched main: `a32a682c3af964e1da22b93981cb67ee0d0a7e45`.
- Follow-up changes: this report and
  [`live-answer-races.test.ts`](../../tests/concurrency/live-answer-races.test.ts).
- Objective: preserve corrected test coverage and the authentic reset bug for
  remote review. Do not widen this delivery into a reset implementation, merge,
  production deployment, or production database change.

PR190's runtime improvement elects one legacy timer-resolve caller to publish the
result, reducing duplicate broadcasts when many phones finish together. The
additional verification below does not establish 200-device venue capacity or
guarantee a single broadcast across all other host endpoints.

## Board-editing failures: stale tests, not a broken product guard

The baseline database suite actually reproduced three failures (14 passed / 17):

- Two fixtures changed `correct_index` after Start. The existing board guard
  correctly rejects this. The fixtures now choose the known correct answer
  before opening/starting the game.
- The concurrent board-edit test expected an edit to succeed after Start won the
  lock race. It now asserts SQLSTATE `55000` and the actual guard message,
  `the board cannot change after its game starts`.

The original lock-wait, single-Start, board-state, scoring, and exact
4999ms/5000ms boundary assertions remain. All original 17 tests now pass. No
production board guard was weakened.

## Added database coverage and current result

Run against a prepared local Supabase PostgreSQL instance containing this
branch's migrations:

```bash
npm run test:db-races -- tests/concurrency/live-answer-races.test.ts
```

The harness rejects hosted database URLs; it uses loopback port 54322, database
`postgres`, isolated synthetic fixtures, and scoped cleanup. It does not apply
migrations or reset the database. Do not point it at production.

Result: **24 passed, 2 failed, 26 total**. The two failures are only the reset
overlaps described below. They are not skipped or marked expected-failure.

Seven added cases pass:

- New timer resolver versus the old manual scorer, in both lock-winner orders.
- New timer resolver versus the all-locked scorer, in both lock-winner orders.
- All-locked declines a missing answer; the timer then scores once.
- The actual undo route's separate committed write sequence cancels a delayed
  direct RPC without scoring. This is not a claim that a valid two-second Undo
  can overlap a due 30-second timer for the same reveal.
- Completed reset cancels a delayed resolver and preserves board/player counts.

The four overlapping resolver cases retain real scorer locks in one transaction,
observe the second PostgreSQL connection waiting on a lock, then commit the
winner. They verify one resolve event, two scored answers, and 210 total points.
They test database correctness, not every route's broadcast behavior.

**CI distinction:** `npm test` does not include this real-PostgreSQL suite.
`.github/workflows/ci.yml` separately runs deterministic venue-scale tests, but
not `test:db-races`. Green GitHub checks do not mean these two reset cases pass.

## Authentic remaining bug: reset can retain a just-completed result

Classification: material, **pre-existing**, still unfixed. Reproduces with both
`resolve_question` (the old scorer) and `resolve_question_once` (PR190's wrapper).

Reproduction is in the parameterized test named:
`legacy reset overlapping uncommitted %s clears every resolve event`.

1. A legacy game is live; its question was revealed 31 seconds ago. Two players
   have answered, so the normal timer-resolve time guard is satisfied.
2. Connection A starts a transaction and runs the real scorer, keeping its
   changes and inserted resolve event uncommitted.
3. Connection B calls the real `reset_night_to_setup`. Its first reveal deletion
   cannot see A's new event. Its later answer deletion waits on A's scoring locks.
   The test observes that lock wait before advancing.
4. A commits. Reset then clears answers and question timestamps and returns the
   game to ready, but does not repeat its earlier reveal deletion.

Observed after successful reset:

```json
{"state":"ready","played":false,"finished":false,"resolves":1,"answers":0,"points":0,"correct":0}
```

The required invariant is `resolves: 0`. No duplicated points or failed answer
cleanup was observed. Explicit transaction gating makes a real overlap
deterministic; it does not modify the installed SQL or introduce an unrelated
blocking lock.

### Cause and reachable consequence

In [`0021_live_security_gate.sql`](../../supabase/migrations/0021_live_security_gate.sql),
`reset_night_to_setup` deletes reveals before deleting answers, without first
serializing against the scorer. The legacy
[`reset-to-setup` route](../../app/api/nights/[id]/reset-to-setup/route.ts) checks
host ownership and invokes that function; it does not exclude a live question.
The host dashboard exposes Reset during a live game.

The legacy [Start route](../../app/api/games/[id]/start/route.ts) accepts the reset
game and does not clear surviving reveal history. Room/TV snapshots can retain
that history as `currentReveal`. Executing the actual `deriveHostMode` function
with representative snapshots produced:

- Ready game with stale resolve: `lobby`.
- Restarted live game with stale resolve: `reveal-sticky`.
- Restarted live game without stale resolve: `picking`.

Source tracing shows the erroneous host mode offers Next question for the old
question, whose cleared `finished_at` makes the advance route return 409. This
is source plus pure-function evidence, **not a rendered browser reproduction of
the reset defect**. TV additionally requires `finishedAt`, so a stale TV answer
display is not established. Player UI consequences beyond snapshots were not
verified.

### Why this is not introduced by PR190

The old scorer, all-locked scorer, reset SQL, board guard, and legacy
reset/undo/end-early route files are unchanged between the recorded main and
runtime PR head. The old-scorer parameter independently reproduces the defect.
Trimmed installed local function bodies matched the recorded main and PR SQL.

A prior read-only production/local comparison also matched
`md5(btrim(prosrc))` for `reset_night_to_setup`
(`df0a2dc883d686b715bfc8d97d552f04`) and `resolve_question`
(`a86fc3c54f6e40355cb390895e0f1d6f`). This establishes deployed code identity,
not an observed production incident. No production data was mutated to reproduce
this issue.

### Follow-up boundary, not implemented here

Investigate consistent reset/scorer locking **before the first reset deletion**.
Any correction needs its own narrowly reviewed migration and tests covering both
winner orders, completed reset cancellation, scoring, and board preservation.
The two red tests provide acceptance criteria; they must become green through a
real fix, not weakened assertions. Production application remains a separate
approval. This report does not label the reset path safe or decide whether to
merge PR190 despite the pre-existing defect.

## Missing-update browser rehearsal: passed within a limited scope

Earlier local verification used actual Supabase Auth/REST/Realtime/PostgreSQL,
the app's real gameplay routes, a host browser, TV, and three isolated phones.
Two genuine 30-second questions were played. Incoming broadcast and row-change
messages were discarded while WebSocket heartbeats and ordinary HTTP remained
available. Every surface captured two discarded resolve broadcasts.

No manual refresh, direct test resolver, or timer fast-forward was used. Both
questions produced one persisted resolve event and the expected scores. All ten
natural resolve responses were 200; one winner per question, others already
resolved. Snapshot requests succeeded; page errors were zero. Screenshots were
inspected, including successful continuation to the second question.

Observed UI visibility delay from database `finished_at` (not independently
measured commit time):

| Surface | Question 1 | Question 2 |
| --- | ---: | ---: |
| Three phones | 461–462ms | 345–346ms |
| TV | 3983ms | 846ms |
| Host | 8007ms | 13957ms |

The roughly 14-second host fallback is a real limitation of this observation.
Recovery includes normal timer-request settled refreshes; it does not isolate
passive polling. This is not proof of real venue RF behavior, suspended mobile
browsers, 200-player capacity, or instantaneous degraded-network synchronization.

Raw browser results/screenshots remain local diagnostic artifacts, not committed
remote tests. This section records the observed rehearsal and its limits, not a
claim that reviewers can rerun it from this report alone. Synthetic rehearsal
data was cleaned up, temporary local grants restored, and added browser/server
services stopped. The local database was preserved. No production write was
part of this rehearsal or this delivery.
