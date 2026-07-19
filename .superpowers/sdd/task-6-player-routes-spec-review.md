# Task 6 player/public routes specification review

Commit reviewed: `87ae046`

## Verdict: PASS

No remaining specification blocker was found in the resilient player-answer,
question-resolve, or public-finalize routes.

## Player answer contract

- `ResilientAnswerSchema` accepts exactly `playId`, `runId`, `submissionId`, and
  visible `slotChosen`; strict parsing rejects caller-supplied player/device
  identity, canonical answer, answer key, scramble, reason, or deadline before
  database mutation.
- The route gets the verified device only from the signed HTTP-only cookie and
  passes that server-derived value as `p_verified_device_id`. No request field
  can replace it.
- A resilient submission makes exactly one mutation RPC call:
  `submit_question_play_answer`. The database remains responsible for player
  resolution, frozen eligibility, canonical choice, receipt time, deduplication,
  and scoring.
- The response confirmation is projected only from the strictly parsed nested
  canonical result. The outer database-only `freshlyApplied` marker is never
  returned to the browser, and no device/player identity, selected canonical
  choice, correctness, award, or raw database error is exposed.
- A replay returns the same canonical confirmation while the response's `live`
  field is rebuilt from a stable current run/revision projection. Old-play
  retries therefore reconcile forward rather than moving the client backward.
- Only `freshLiveEventFromRpc` can nominate a broadcast. It requires an exact
  `freshlyApplied: true` parsed winner, and `projectExactLiveEvent` must still
  prove the event's current ancestry/revisions. Replay, rejected/nonwinner,
  malformed, and stale-projection paths emit no room broadcast.
- Best-effort broadcast failure is caught after the authoritative answer RPC;
  it cannot turn a committed answer into a failed HTTP response or leak the
  transport error.
- The legacy question/scramble/participation insert and 204 response remain
  intact. The only added guard is the required engine branch, preventing a
  legacy-shaped payload from entering a resilient night.

## Resolve and public-finalize contract

- A resilient `/api/questions/:id/resolve` selects the current non-undone play
  for the night/run and calls only `finalize_current_play_if_due`; it never calls
  legacy `resolve_question`. Legacy nights retain the established deadline
  guard, legacy RPC, award projection, response, and best-effort broadcasts.
- The public finalize route accepts the room code and play ID only from its URL
  plus a strict body containing only `runId`. Caller-supplied reason, deadline,
  player/device identity, canonical answer/index, or answer text is rejected
  before the RPC.
- Both resilient finalization entry points strictly parse the same database
  envelope, verify returned run/play and optional game/question ancestry, and
  reproject current durable state for nonwinning or superseded requests.
- A room event is emitted only for the exact fresh projected winner. Fireworks
  run only for that winner when its event is `play_resolved`; replay, not-due,
  malformed, stale, and final-window-only outcomes cannot duplicate them.
- Broadcast and fireworks are best-effort after the database transaction.
  Failures return no raw transport detail and do not change a committed
  finalization into an HTTP failure.

## Security and audience boundary

- Every new database error path uses generic route errors; malformed envelopes
  fail closed and raw database details are not reflected.
- Resilient responses and broadcasts contain only opaque run/play/game/question
  ancestry, revisions, aggregate live state, and the submitting player's own
  visible confirmation. They contain no player/device/submission identity,
  answer key, canonical selected choice, correctness, or award before reveal.
- The public finalizer delegates its bounded attempt rate limiting to the
  authoritative RPC's opaque room/play bucket; it cannot choose another play,
  reason, or deadline.

## Verification

```text
npx vitest run tests/unit/api-answers-route.test.ts tests/unit/api-resolve-route.test.ts tests/unit/api-public-finalize-route.test.ts tests/unit/api-public-player-error-boundary.test.ts
PASS — 4 files, 22 tests

npx vitest run tests/unit/live-answer-rpc-result.test.ts tests/unit/live-answer-event-projection.test.ts tests/unit/live-answer-request-schemas.test.ts tests/unit/live-answer-broadcast.test.ts tests/unit/api-room-snapshot-route.test.ts tests/integration/live-answer-engine-schema.test.ts tests/integration/reset-night-answer-engine.test.ts
PASS — 7 files, 112 tests

npx eslint app/api/answers/route.ts app/api/questions/[id]/resolve/route.ts app/api/room/[code]/plays/[playId]/finalize/route.ts tests/unit/api-answers-route.test.ts tests/unit/api-resolve-route.test.ts tests/unit/api-public-finalize-route.test.ts tests/unit/api-public-player-error-boundary.test.ts
PASS

git diff --check 87ae046^..87ae046
PASS

npx tsc --noEmit
BASELINE ONLY — the established seven unrelated fixture errors in
collect-verified-questions.test.ts, HostHomeClient-founder-build.test.tsx, and
prod-smoke-budget.test.ts. No reviewed route or route-test file appears.
```

Verified by: commit-only source/diff inspection, strict shared parser and exact
projection review, focused route tests, extended parser/projection/database
regressions, lint, TypeScript baseline comparison, and diff check.

Skipped/Failed: No product file was edited. Full repository suite, build,
deployment, rollout, merge, and production verification were outside this
bounded review. Unrelated shared-worktree changes to `tasks/lessons.md` and the
atomic-open migration/test were not inspected, staged, or included.
