# Task 6 atomic-open quality/security review

Commit reviewed: `c629701` only (`c02da68..c629701`)

## Ranked findings

### P2 — Concurrent distinct open commands can deadlock while upgrading the night lock

`open_night_run` claims/inserts its command receipt before locking the night (`supabase/migrations/0026_atomic_answer_engine_open.sql:37-59`). That insert enforces the direct `live_command_receipts.night_id -> nights.id` foreign key (`supabase/migrations/0025_reset_night_answer_engine.sql:69-76`), which takes a parent-row `KEY SHARE` lock. Two distinct concurrent command IDs can therefore each hold compatible key-share locks, then each request `FOR UPDATE` on the same night and wait on the other's key-share lock. PostgreSQL resolves the cycle by aborting one request as a deadlock, so the advertised concurrent/idempotent open produces a 500/retry instead of two canonical outcomes. The PGlite tests use one connection and cannot exercise PostgreSQL lock upgrades (`tests/integration/atomic-answer-engine-open.test.ts:108-117`). Acquire the night lock before inserting the receipt (while preserving a globally consistent lock order), and add a real two-connection PostgreSQL race regression.

### P2 — The new broadcast catch logs raw upstream error content

The route logs the caught error object verbatim (`app/api/nights/[id]/open/route.ts:50-60`). The broadcast helper constructs that error from the raw Realtime response body (`lib/api/broadcast.ts:126-128`), so infrastructure/vendor details can be copied into application logs. The route test suppresses `console.warn` but does not assert that rejected error text is absent (`tests/unit/api-open-night-route.test.ts:69-95`, `:185-202`). Log a fixed allowlisted message only, as the player/public resilient routes do.

## §5.1 Root cause fixed: FAIL

Evidence: `supabase/migrations/0026_atomic_answer_engine_open.sql:37-59` — engine selection and opening share one transaction, but receipt-before-night ordering leaves the central concurrent-open race vulnerable to a parent-FK lock-upgrade deadlock.

## §5.2 No new abstractions: PASS

Evidence: `app/api/nights/[id]/open/route.ts:31-78` — the route reuses the shared command parser, exact event projector, and broadcast boundary; the only local parser exists for the deliberately separate legacy result shape.

## §5.3 No dead code: PASS

Evidence: `tests/unit/api-open-night-route.test.ts:97-202` — atomic legacy, fresh winner, replay, malformed envelope, and rejected broadcast branches are exercised; changed files add no TODO/FIXME, commented-out implementation, or debug statement.

## §5.4 Honest naming: PASS

Evidence: `supabase/migrations/0026_atomic_answer_engine_open.sql:61-112` — `already_open`, `legacy_opened`, and `stale` identify distinct outcomes, while resilient `applied` is reserved for the revision/event-producing path.

## §5.5 Failure modes considered: FAIL

Evidence: `tests/integration/atomic-answer-engine-open.test.ts:326-380` — exact retry, receipt termination, and grants are covered, but no independent-connection test exercises the receipt-FK/night-lock cycle; route failure coverage also omits raw-log assertions.

## Quality/security assessment

- **Atomic latch/no partial state: PASS.** Engine selection, latch, opened timestamp, run, revisions, durable event, and terminal receipt are one PL/pgSQL transaction (`supabase/migrations/0026_atomic_answer_engine_open.sql:83-143`); any statement failure rolls all of them back.
- **Receipt cleanup/idempotency: PASS outside the concurrency finding.** Legacy, already-open, and stale outcomes terminate their receipts, while resilient winners store one canonical result; exact command retries are non-fresh (`supabase/migrations/0026_atomic_answer_engine_open.sql:63-80`, `:98-112`, `:133-143`; `tests/integration/atomic-answer-engine-open.test.ts:326-350`).
- **Race/deadlock: FAIL.** The P2 lock-order cycle above is not covered by the single-connection test harness.
- **Authorization/grants: PASS.** The route requires owned-night authorization before creating an admin client, and only `service_role` can execute `open_night_run`; the function is `SECURITY DEFINER` with fixed `search_path` (`app/api/nights/[id]/open/route.ts:19-31`; `supabase/migrations/0026_atomic_answer_engine_open.sql:14-24`, `:147-150`).
- **Direct RPC misuse: PASS at the browser boundary.** `PUBLIC`, `anon`, and `authenticated` execution are explicitly revoked, so request callers cannot bypass route ownership. Service role remains the intended trusted invoker.
- **Legacy behavior: PASS.** Disabled/missing/legacy preference opens and latches legacy without a live run/event or revision change; already-open rooms preserve the original timestamp and latch (`supabase/migrations/0026_atomic_answer_engine_open.sql:61-112`; `tests/integration/atomic-answer-engine-open.test.ts:123-164`, `:212-253`).
- **Exact retry: PASS.** Direct same-command retry returns the byte-equivalent canonical result with `freshlyApplied: false`; independent route retries remain durable/idempotent through the already-open result (`tests/integration/atomic-answer-engine-open.test.ts:326-334`).
- **Malformed envelopes/user errors: PASS.** Both resilient and legacy shapes are strict; malformed/raw fields map to a generic response and never broadcast (`app/api/nights/[id]/open/route.ts:42-44`, `:81-110`; `tests/unit/api-open-night-route.test.ts:172-183`).
- **Raw error logging: FAIL.** The route copies the broadcast error object into logs as described in the P2.
- **Nullable run foreign keys: PASS for intended open/reset ancestry, with a schema-hardening caveat.** The composite run FK permits the pre-open null, while the direct night FK preserves cascade ownership (`supabase/migrations/0026_atomic_answer_engine_open.sql:9-12`; `supabase/migrations/0025_reset_night_answer_engine.sql:63-76`). Browser roles cannot write receipts. A future constraint limiting null `run_id` to `open_night_run` would preserve the invariant against trusted-code mistakes but is not a current P0-P2 exploit.
- **Reset-preallocated run: PASS.** A latched resilient night reuses its preallocated current run and does not create a second run (`supabase/migrations/0026_atomic_answer_engine_open.sql:83-96`, `:115-124`; `tests/integration/atomic-answer-engine-open.test.ts:275-294`). The extended reset suite passes exact reopen/reset replay.
- **Projection/broadcast selection: PASS.** Only a strict transaction winner projects and broadcasts; replays and legacy results do neither (`app/api/nights/[id]/open/route.ts:42-62`; `tests/unit/api-open-night-route.test.ts:120-170`).
- **Broadcast wait behavior: tracked separately.** This commit awaits the shared broadcast boundary at `app/api/nights/[id]/open/route.ts:50-58`; the shared timeout repair is explicitly in another active lane and is not duplicated as a finding here.

## Type checker / linter

`npx tsc --noEmit`: FAIL on the seven established fixture diagnostics plus two concurrent dirty-worktree host-route diagnostics; no atomic-open file appears.

```text
tests/unit/api-host-answer-engine-route.test.ts(99,13), (112,13): TS2339 concurrent route lacks GET export
tests/unit/collect-verified-questions.test.ts(59,5), (114,5), (139,5): TS2322 callback returns number, expected void/Promise<void>
tests/unit/HostHomeClient-founder-build.test.tsx(30,19), (44,19): TS2739 missing previousGames and inSetup
tests/unit/prod-smoke-budget.test.ts(12,30), (38,30): TS2345 ProcessEnv missing NODE_ENV
```

`npm run lint`: FAIL because the repository's Next 16 script treats `next lint` as a nonexistent `tr1via/lint` project directory.

Direct ESLint over the changed route and both test files: PASS.

## Verification

- Read all four changed files fully and traced receipt helpers, direct/composite FKs, reset archive/run behavior, RPC grants, exact-event projection, and broadcast transport.
- Focused plus extended PGlite suites: PASS — 3 files, 73/73 tests.
- Route/shared unit regressions: PASS — 4 files, 31/31 tests.
- Direct ESLint over changed TypeScript files: PASS.
- `git diff --check c629701^..c629701`: PASS.

## Verdict: REQUEST-CHANGES

The transaction prevents partial latching and preserves legacy/retry/reset semantics, but concurrent opens can deadlock and the new route logs raw upstream broadcast failures.

## Skipped/Failed:

- `tasks/workflow.md` and `tasks/todo.md` do not exist in this worktree; used the supplied §5 rubric and atomic-open review contract.
- No real PostgreSQL server is available in this environment; PGlite has no independent shared-database connections, so the FK lock-upgrade race was established by static PostgreSQL lock semantics rather than executed.
- The shared broadcast timeout repair is a separate active lane and was not reviewed or duplicated as a finding.
- Repository-wide type-check and lint remain blocked by the baseline/concurrent failures above; focused/extended tests and direct ESLint pass.
- Unrelated dirty host/lifecycle/broadcast files and `tasks/lessons.md` were not changed, staged, or reviewed.
- No product code, lesson, deployment, push, merge, or production state was changed.
