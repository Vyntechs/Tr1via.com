# Task 6 player/public routes quality/security re-review

Commits reviewed: player/public route delivery through `b6741ad`; repair delta `6e8184f..b6741ad`.

## Ranked findings

None. The prior P2 is closed.

## Prior P2 closure

`postBroadcasts` now creates one `AbortController`, aborts it after exactly 750ms, passes its signal to `fetch`, and clears the timer in `finally` (`lib/api/broadcast.ts:104-145`). The live answer broadcaster awaits that bounded helper (`lib/api/broadcast.ts:174-213`), and fireworks awaits the same helper (`lib/api/broadcast.ts:329-352`), so both healthy and stalled deliveries share one failure boundary.

The exact fake-timer regression proves a signal-aware nonsettling fetch remains pending at 749ms, rejects at 750ms, observes an aborted signal, and leaves zero timers (`tests/unit/live-answer-broadcast.test.ts:103-139`). Its healthy case proves the request is actually sent and awaited to success, with zero residual timers (`tests/unit/live-answer-broadcast.test.ts:40-88`). The answer-route regression proves that a committed winner remains pending only through that bound, then returns canonical HTTP 200/`confirmed`; its catch emits only a fixed message and does not expose the rejected error (`tests/unit/api-answers-route.test.ts:368-400`). Because each promise rejection is awaited and caught at the route boundary, no detached promise can produce an unhandled rejection (`app/api/answers/route.ts:185-207`; `app/api/questions/[id]/resolve/route.ts:179-207`; `app/api/room/[code]/plays/[playId]/finalize/route.ts:148-176`).

## §5.1 Root cause fixed: PASS

Evidence: `lib/api/broadcast.ts:116-145` — the shared optional Realtime transport itself now owns the deadline and timer cleanup, closing the unbounded post-commit await rather than special-casing one caller.

## §5.2 No new abstractions: PASS

Evidence: `lib/api/broadcast.ts:104-145` — the repair adds one timeout constant and standard `AbortController` lifecycle inside the existing transport helper; it introduces no new service, state layer, or wrapper.

## §5.3 No dead code: PASS

Evidence: `tests/unit/live-answer-broadcast.test.ts:40-139` — both healthy completion and timeout cleanup exercise the new controller/timer path; the three changed files contain no commented-out implementation, stray TODO/FIXME, or debug logging.

## §5.4 Honest naming: PASS

Evidence: `lib/api/broadcast.ts:104-107` — `LIVE_BROADCAST_TIMEOUT_MS` accurately names the 750ms live-delivery budget used by the shared broadcast transport.

## §5.5 Failure modes considered: PASS

Evidence: `tests/unit/live-answer-broadcast.test.ts:103-139` — load-independent nonsettling transport, exact boundary timing, abort propagation, rejected completion, and timer cleanup are covered; `tests/unit/api-answers-route.test.ts:368-400` proves the committed response and log-sanitization behavior after failure.

## Quality/security assessment

- **Authorization/authority fields: PASS.** Resilient answers derive device identity from the signed cookie and exclude player/device/canonical answer/deadline authority from the strict request body (`app/api/answers/route.ts:103-120`, `:145-154`). Anonymous finalizers accept only opaque room/run/play identity (`app/api/room/[code]/plays/[playId]/finalize/route.ts:77-95`, `:127-134`).
- **Room/run/play ancestry: PASS.** Public finalize binds the play to the room night and current run before invoking the service-role RPC (`app/api/room/[code]/plays/[playId]/finalize/route.ts:97-145`).
- **Privacy: PASS.** The live-answer broadcast builds an explicit aggregate-only payload and discards caller extras (`lib/api/broadcast.ts:174-212`); the regression asserts player, device, submission, eligibility, slot, and canonical-index data are absent (`tests/unit/live-answer-broadcast.test.ts:40-87`).
- **Replay/one-write semantics: PASS.** Only the transaction winner can broadcast; replay and non-winner attempts return before fetch (`lib/api/broadcast.ts:174-186`; `tests/unit/live-answer-broadcast.test.ts:90-101`, `:141-154`). Each resilient route retains one mutation RPC and durable-current fallback.
- **Fireworks bound: PASS.** Fireworks and live answer events both await the same bounded `postBroadcasts` implementation (`lib/api/broadcast.ts:208-213`, `:329-352`). Resilient callers swallow fireworks failure with static messages and still return durable canonical state (`app/api/questions/[id]/resolve/route.ts:195-207`; `app/api/room/[code]/plays/[playId]/finalize/route.ts:164-176`).
- **Raw logs/unhandled rejection: PASS for resilient player/public paths.** The three catches use no error binding and log fixed strings only (`app/api/answers/route.ts:190-200`; `app/api/questions/[id]/resolve/route.ts:184-200`; `app/api/room/[code]/plays/[playId]/finalize/route.ts:153-169`). The older non-resilient resolve branch still logs caught errors, but it predates and is outside the repair delta (`app/api/questions/[id]/resolve/route.ts:266-279`).

## Type checker / linter

`npx tsc --noEmit`: FAIL on seven established fixture diagnostics plus two diagnostics from concurrent, untracked host-route work; no diagnostic names any file in `6e8184f..b6741ad`.

```text
tests/unit/api-host-answer-engine-route.test.ts(99,13), (112,13): TS2339 concurrent untracked route has no GET export
tests/unit/collect-verified-questions.test.ts(59,5), (114,5), (139,5): TS2322 callback returns number
tests/unit/HostHomeClient-founder-build.test.tsx(30,19), (44,19): TS2739 fixture props missing
tests/unit/prod-smoke-budget.test.ts(12,30), (38,30): TS2345 ProcessEnv missing NODE_ENV
```

`npm run lint`: FAIL because the repository's Next 16 script treats `next lint` as a nonexistent `tr1via/lint` project directory.

Direct ESLint over the transport, changed tests, and all three player/public routes: PASS.

## Verification

- Read all three repair files fully and retraced all three player/public resilient call chains from database result through projection, delivery, catch, and canonical response.
- Focused plus extended unit regressions: PASS — 9 files, 58/58 tests.
- Direct database live-engine regressions: PASS — 1 file, 50/50 tests.
- Direct ESLint: PASS — transport, changed tests, and three player/public routes.
- `git diff --check 6e8184f..b6741ad`: PASS; repair delta is exactly 3 files, 93 insertions, 17 deletions.

## Verdict: APPROVE

The shared 750ms abort boundary closes the prior P2 while preserving healthy awaited delivery, canonical committed success, timer cleanup, fireworks containment, sanitized logs, and rejection handling.

## Skipped/Failed:

- `tasks/workflow.md` and `tasks/todo.md` do not exist in this worktree; used the supplied §5 rubric and the existing task-specific review contract.
- Repository-wide type-check and `npm run lint` remain blocked by the documented baseline/concurrent failures; focused tests, database tests, direct ESLint, and diff checks pass.
- The failed `/dev/stdin` `vite-node` experiment could not load a virtual script; no repository file was created or changed. Fireworks' shared timeout is proved directly by its call to the same bounded private helper.
- Unrelated dirty host/game-route/lesson work was not read, changed, staged, or reviewed.
- No product code, deployment, push, merge, migration, or production state was changed.
