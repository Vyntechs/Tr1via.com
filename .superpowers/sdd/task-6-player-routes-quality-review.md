# Task 6 player/public routes quality/security review

Commit reviewed: `87ae046` only (`355c7b1..87ae046`)

## Ranked findings

### P2 — Best-effort broadcasts can indefinitely withhold an already-committed response

Each new resilient winner path waits for Realtime delivery before returning the canonical result (`app/api/answers/route.ts:185-204`; `app/api/questions/[id]/resolve/route.ts:179-205`; `app/api/room/[code]/plays/[playId]/finalize/route.ts:148-174`). The catches cover only rejection. `broadcastAppliedLiveRoomEvent` and fireworks ultimately call `fetch` without an abort signal or timeout (`lib/api/broadcast.ts:111-128`, `:193-198`, `:314-336`), so a nonsettling Realtime request can hold the HTTP response until the serverless function is killed even though the database transaction already committed. The tests model only immediate rejection (`tests/unit/api-answers-route.test.ts:364-383`; `tests/unit/api-public-finalize-route.test.ts:261-277`) and therefore do not prove the stated post-commit failure isolation. Bound the optional transport wait (and consume late rejection safely) or detach it behind a failure-contained delivery mechanism; add a never-settling broadcast regression proving the canonical response still completes.

## §5.1 Root cause fixed: FAIL

Evidence: `app/api/answers/route.ts:185-211` — the database owns the answer atomically, but an optional external fan-out still gates acknowledgement of that committed answer without a time bound.

## §5.2 No new abstractions: PASS

Evidence: `app/api/room/[code]/plays/[playId]/finalize/route.ts:18-19` — the route adds one strict body schema and reuses the shared RPC parser, event projector, room projector, and broadcast boundary; no vendor or state abstraction was introduced.

## §5.3 No dead code: PASS

Evidence: `tests/unit/api-answers-route.test.ts:131-402` — resilient/legacy branches, authorization, replay, stale projection, malformed results, broadcast rejection, and database call shapes are exercised; the changed files add no TODO/FIXME, commented-out implementation, or debug statement.

## §5.4 Honest naming: PASS

Evidence: `app/api/questions/[id]/resolve/route.ts:158-207` — the resilient resolve route calls only `finalize_current_play_if_due`, and freshness, exact projection, current projection, and fireworks behavior match their identifiers.

## §5.5 Failure modes considered: FAIL

Evidence: `tests/unit/api-public-finalize-route.test.ts:261-277` — rejection is covered, but a pending broadcast promise is not; the latter leaves the committed request pending because the production call is awaited without a timeout.

## Quality/security assessment

- **Authorization/authority fields: PASS.** Resilient answers derive device identity from the signed cookie and use a strict body that excludes player/device/canonical answer/deadline fields (`app/api/answers/route.ts:103-120`, `:145-154`; `lib/api/schemas.ts:112-120`). The anonymous finalizers accept only opaque room/run/play identity and cannot supply reason, deadline, player, or answer (`app/api/room/[code]/plays/[playId]/finalize/route.ts:18`, `:81-95`, `:127-134`).
- **Room/run/play ancestry: PASS.** Public finalize binds play to the room's night and current run before the service-role RPC (`app/api/room/[code]/plays/[playId]/finalize/route.ts:97-145`). The legacy resolve bridge selects the current non-undone play for the run and requires its question to equal the route question (`app/api/questions/[id]/resolve/route.ts:140-176`). Database foreign keys and the RPC recheck the ancestry under lock.
- **Privacy: PASS.** Strict RPC parsers reject extra/raw database fields; answer responses omit device and canonical choice, and public finalizer projections contain only run/play identity, revisions, deadlines, state, and aggregate counts (`app/api/answers/route.ts:157-211`; `lib/live-answer/projectPlay.ts:45-67`).
- **Stale/replay behavior: PASS.** Only `freshlyApplied` transaction winners can project/broadcast; exact retries skip broadcast and rebuild current durable room state (`app/api/answers/route.ts:185-211`; `app/api/room/[code]/plays/[playId]/finalize/route.ts:148-176`). Route regressions cover old-play answer and resolved-finalizer replay.
- **One-write semantics: PASS.** Each resilient route invokes exactly one service-role mutation RPC and performs no route-level table write; the database's lock/revision/event transaction owns answer/finalize effects (`app/api/answers/route.ts:145-155`; `app/api/questions/[id]/resolve/route.ts:158-168`; `app/api/room/[code]/plays/[playId]/finalize/route.ts:127-137`). The 50-test direct database suite proves one winner/event and canonical replay.
- **Exact-event projection: PASS.** Fresh events are reparsed, ancestry-checked, and projected at the exact winner revision before audience-safe broadcast; stale projection falls back without broadcasting (`app/api/questions/[id]/resolve/route.ts:167-207`; `lib/live-answer/projectEvent.ts:17-95`).
- **Post-commit rejection: PASS.** Explicit broadcast rejection is swallowed with static logs and the committed response remains successful (`app/api/answers/route.ts:190-200`; `app/api/room/[code]/plays/[playId]/finalize/route.ts:153-169`).
- **Post-commit nonsettling transport: FAIL.** The P2 above leaves all three resilient winner responses externally gated.
- **Rate limiting: PASS for the specified database seam.** `finalize_current_play_if_due` owns a 120-attempt/10-second play bucket and returns typed `retry_later`; resolved replays bypass saturation (`supabase/migrations/0023_live_answer_engine_functions.sql:914-959`). Direct database regressions at `tests/integration/live-answer-engine-schema.test.ts:2016-2110` and `:2337-2354` pass.
- **Legacy regressions: PASS.** Answer tests retain the exact 204 insert path, and the shared public-player error suite retains generic legacy database failures (`tests/unit/api-answers-route.test.ts:139-178`; `tests/unit/api-public-player-error-boundary.test.ts:87-129`).
- **Raw logs: PASS for new paths.** New resilient catches log fixed messages only and do not include rejected error objects. The legacy resolve catch still logs its error object at `app/api/questions/[id]/resolve/route.ts:266-279`, but those lines predate this commit.
- **Query scope/current projection: PASS.** Queries use explicit columns and no answer/device/cookie row is loaded for public projections. The before/play/after revision check prevents mixed-revision current snapshots and follows the existing snapshot convention (`app/api/answers/route.ts:44-100`; `app/api/room/[code]/snapshot/route.ts:126-142`).

## Type checker / linter

`npx tsc --noEmit`: FAIL on the same seven established fixture diagnostics; no changed route or test appears.

```text
tests/unit/collect-verified-questions.test.ts(59,5), (114,5), (139,5): TS2322 callback returns number, expected void/Promise<void>
tests/unit/HostHomeClient-founder-build.test.tsx(30,19), (44,19): TS2739 missing previousGames and inSetup
tests/unit/prod-smoke-budget.test.ts(12,30), (38,30): TS2345 ProcessEnv missing NODE_ENV
```

`npm run lint`: FAIL because the repository's Next 16 script treats `next lint` as a nonexistent `tr1via/lint` project directory.

Direct ESLint over all seven changed route/test files: PASS.

## Verification

- Read all seven changed files fully and traced request schemas, RPC parsers, exact/current projectors, broadcast transport, and database finalizer/rate-limit logic.
- Focused/shared/security unit regressions: PASS — 9 files, 61/61 tests.
- Direct database live-engine regressions: PASS — 1 file, 50/50 tests.
- Direct ESLint over all changed route/test files: PASS.
- `git diff --check 87ae046^..87ae046`: PASS.

## Verdict: REQUEST-CHANGES

The authorization, privacy, idempotency, projection, and database-rate-limit boundaries are sound, but optional Realtime delivery still has an unbounded post-commit denial path.

## Skipped/Failed:

- `tasks/workflow.md` and `tasks/todo.md` do not exist in this worktree; used the supplied §5 rubric, the authoritative resilience design/plan, and commit-specific review contract.
- A true never-settling transport probe was not run because it intentionally has no completion condition; static call-chain inspection proves the unbounded await, and existing tests cover rejection only.
- Repository-wide type-check and lint remain blocked by the documented baseline failures above; focused/shared/database tests and direct ESLint pass.
- Unrelated pre-existing `tasks/lessons.md` and concurrent untracked migration/integration files were not read, changed, staged, or reviewed.
- No product code, lesson, deployment, push, merge, or production state was changed.
