# Task 6 atomic-open prerequisite specification review

Commit reviewed: `c629701`

## Verdict: PASS

No remaining specification blocker was found. The atomic open prerequisite
implements the previously required lock, latch, rollout, retry, and legacy
compatibility contract without moving engine selection into the route.

## SQL contract and authority boundary

- The effective function retains the exact public identity
  `open_night_run(uuid, uuid, uuid, bigint) returns jsonb`; it remains
  `SECURITY DEFINER` with `search_path=pg_catalog, public`.
- `PUBLIC`, `anon`, and `authenticated` have no execute privilege. Only
  `service_role` can execute the function, and the rollout table remains behind
  the existing service-owned boundary.
- The function reads the current receipt run and claims the command receipt
  before taking `FOR UPDATE` on the night. Exact retries and command-ID
  conflicts therefore terminate at the receipt without inverting the
  established receipt → night lock order.
- Every path after a successful claim makes the receipt terminal: resilient
  winners are `applied`; legacy, already-open, and stale/no-op outcomes are
  canonically completed without leaving `pending` rows.

## Open and latch behavior

- An already-open night exits immediately after the night lock. It does not
  consult host rollout settings, rewrite the engine/latch/run/open timestamp,
  increment either revision, or insert a room event. Its original `opened_at`
  is returned through a strict non-fresh `already_open` result.
- Expected run/control values are validated before an unopened night reads or
  applies rollout preference. A stale command stores and replays the canonical
  stale rejection while leaving engine, latch, run, and open state unchanged.
- An unlatched night selects `resilient_v1` only for the exact pair
  `release_enabled = true` and `preferred_engine = 'resilient_v1'`. A missing
  setting, disabled release, or legacy preference fails closed to legacy.
- A latched night never reconsults preference. A reset legacy night remains
  legacy even after preference changes; a reset resilient night remains
  resilient and reuses its preallocated current run.
- The resilient winner alone attaches/creates the run, stamps the latch and
  open time, increments room/control revisions, inserts one `night_opened`
  event, completes the applied receipt, and returns the established fresh
  canonical event envelope.
- The legacy path changes only `answer_engine`, `answer_engine_latched_at`, and
  `opened_at`. It creates no current/live run, room event, revision increment,
  or fresh/broadcastable envelope.

## Retry and route behavior

- Exact resilient retries return `freshlyApplied:false` with the byte-identical
  nested canonical winner and cannot create another run, event, or revision.
- An independent direct PGlite probe additionally confirmed exact legacy and
  already-open retries return byte-identical nested results, remain non-fresh
  on both calls, and retain terminal canonical receipts.
- The host route supplies its owned night/run/control snapshot to the single
  atomic RPC. It never reads rollout settings or pre-updates `answer_engine` or
  `opened_at`.
- The route strictly parses resilient versus legacy/already-open envelopes.
  Only an exact parsed fresh resilient event is projected and broadcast;
  legacy, already-open, replay, stale, and malformed outcomes cannot broadcast.
- After the RPC the route re-reads only the durable night outcome and preserves
  the existing successful HTTP response exactly as `{ openedAt }`.
- Best-effort fast-broadcast failure does not change a committed open into an
  HTTP failure; durable recovery remains authoritative.

## Verification

```text
npx vitest run tests/integration/atomic-answer-engine-open.test.ts tests/unit/api-open-night-route.test.ts
PASS — 2 files, 17 tests

npx vitest run tests/integration/live-answer-engine-schema.test.ts tests/integration/reset-night-answer-engine.test.ts tests/unit/live-answer-rpc-result.test.ts tests/unit/live-answer-event-projection.test.ts tests/unit/live-answer-broadcast.test.ts
PASS — 5 files, 87 tests

npx eslint app/api/nights/[id]/open/route.ts tests/integration/atomic-answer-engine-open.test.ts tests/unit/api-open-night-route.test.ts
PASS

git diff --check c629701^..c629701
PASS

Direct PGlite legacy/already-open retry probe
PASS — both nested results byte-identical; freshness false/false; terminal canonical receipts

npx tsc --noEmit
BASELINE ONLY — the established seven unrelated fixture errors in
collect-verified-questions.test.ts, HostHomeClient-founder-build.test.tsx, and
prod-smoke-budget.test.ts. No atomic-open file appears.
```

Verified by: commit-only migration/route/test inspection, PGlite behavior and
catalog checks, strict route tests, extended freshness/reset/parser/projection
regressions, direct retry probe, ESLint, TypeScript baseline comparison, and
diff check.

Skipped/Failed: The first parallel extended-test attempt ended before reporting
a final status; it was discarded and rerun alone, passing 87/87. No product
file was edited. Full suite, build, independent-connection concurrency,
deployment, rollout, merge, and production verification were outside this
bounded prerequisite review. The unrelated `tasks/lessons.md` modification was
not inspected, staged, or committed.
