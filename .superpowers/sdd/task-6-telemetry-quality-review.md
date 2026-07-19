# Task 6 telemetry quality/security re-review

Telemetry range reviewed: `d6745e2..28821b1`; repair delta: `d243341..28821b1`

## Ranked findings

None.

## Prior P2 — CLOSED: validation/copy substitution

The constructor now reads each of the seven permitted properties exactly once into local snapshots, validates only those snapshots, and constructs the event only from them (`lib/live-answer/telemetry.ts:79-109`). The regression uses stateful getters for every allowed property and proves each is read once while only the validated first values are emitted (`tests/unit/live-answer-telemetry.test.ts:68-125`). An independent direct probe reproduced the former alternating `playId`/`resultCode` input and returned the safe first UUID and `confirmed`, with one read apiece; no substituted device-like UUID or raw database string escaped.

## Prior P2 — CLOSED: asynchronous sink rejection

The sink type now explicitly supports `void | Promise<void>`, and the recorder is asynchronous and awaits the sink inside its failure boundary (`lib/live-answer/telemetry.ts:45-47`, `:121-133`). The committed regression covers a rejecting asynchronous sink (`tests/unit/live-answer-telemetry.test.ts:207-219`). An independent direct probe returned `false` and observed zero `unhandledRejection` events.

## §5.1 Root cause fixed: PASS

Evidence: `lib/live-answer/telemetry.ts:79-109` — validated values and emitted values are now the same immutable primitive snapshots, eliminating the time-of-check/time-of-use privacy hole rather than filtering one example.

## §5.2 No new abstractions: PASS

Evidence: `lib/live-answer/telemetry.ts:45-47` — widening the existing sink contract to synchronous or promised completion and awaiting it is the smallest change that accurately models collector behavior.

## §5.3 No dead code: PASS

Evidence: `tests/unit/live-answer-telemetry.test.ts:11-241` — every exported primitive, all seven event properties, invalid input, synchronous failure, asynchronous failure, and denied-field behavior are exercised; no TODO/FIXME, commented-out implementation, debug output, or unreachable branch was added.

## §5.4 Honest naming: PASS

Evidence: `lib/live-answer/telemetry.ts:121-133` — `recordLiveAnswerHealth` now resolves `true` only after the sink completes successfully and resolves `false` for invalid events, synchronous throws, or promise rejection.

## §5.5 Failure modes considered: PASS

Evidence: `tests/unit/live-answer-telemetry.test.ts:68-137`, `:181-239` — regressions cover stateful allowed-field access, malformed values, invalid-event sink suppression, synchronous throws, asynchronous rejection, and throwing denied-field getters.

## Allowlist/security assessment

- **Exact output fields: PASS.** Events contain only opaque UUID `playId`, coarse latency bucket, typed result code, non-negative safe-integer retry/duplicate/reconciliation counts, and normalized resolution reason (`lib/live-answer/telemetry.ts:3-50`, `:89-109`).
- **Denied-field access/copy: PASS.** The implementation references only the seven allowlisted names and never enumerates input; denied request, cookie, identity, answer, credential, and raw-error getters are not read (`lib/live-answer/telemetry.ts:79-87`; `tests/unit/live-answer-telemetry.test.ts:221-239`).
- **Hidden identity/raw-error substitution: PASS.** Single-read primitive snapshots prevent getters or proxies from changing values after validation (`lib/live-answer/telemetry.ts:79-109`).
- **Malformed input: PASS.** Non-objects, arrays, throwing accessors, invalid UUIDs, untyped strings, invalid counts, and non-finite/negative exact latency fail closed (`lib/live-answer/telemetry.ts:56-64`, `:72-114`, `:136-152`).
- **Sink failure isolation: PASS.** Both throws and rejected promises are awaited/caught and resolve `false`, so the recorder does not throw into a live mutation path (`lib/live-answer/telemetry.ts:121-133`).
- **Types: PASS.** Closed literal unions constrain every event field, `LiveCanonicalResult["code"]` prevents an untyped result member, readonly properties plus frozen primitive-only output prevent post-validation mutation, and the sink's promise shape is explicit (`lib/live-answer/telemetry.ts:11-50`, `:101-111`).

## Type checker / linter

`npx tsc --noEmit`: FAIL with the seven established fixture diagnostics plus one concurrent dirty-worktree answer-route diagnostic; no telemetry-file diagnostic appeared.

```text
app/api/answers/route.ts(126,9): TS2322 string | null is not assignable to string
tests/unit/collect-verified-questions.test.ts(59,5), (114,5), (139,5): TS2322 callback returns number, expected void/Promise<void>
tests/unit/HostHomeClient-founder-build.test.tsx(30,19), (44,19): TS2739 missing previousGames and inSetup
tests/unit/prod-smoke-budget.test.ts(12,30), (38,30): TS2345 ProcessEnv missing NODE_ENV
```

`npm run lint`: FAIL because the repository's Next 16 script treats `next lint` as a nonexistent `tr1via/lint` project directory.

`npx eslint lib/live-answer/telemetry.ts tests/unit/live-answer-telemetry.test.ts`: PASS.

## Verification

- Read all three telemetry files changed through `28821b1` fully and checked for committed consumers.
- Focused telemetry suite: PASS — 1 file, 17/17 tests.
- Direct stateful allowed-getter probe: PASS — safe values emitted, one read per property.
- Direct asynchronously rejecting sink probe: PASS — resolved `false`, zero unhandled rejections.
- `git diff --check d243341..28821b1`: PASS.

## Verdict: APPROVE

Both prior privacy/failure-isolation defects are closed with direct and committed regression proof, and no new P0-P2 issue was found.

## Skipped/Failed:

- `tasks/workflow.md` and `tasks/todo.md` do not exist in this worktree; used the supplied §5 rubric and telemetry re-review contract.
- `28821b1` still adds no production telemetry caller, so route-level mutation integration is outside this commit; the recorder itself contains all validated-input and sink failure paths.
- Repository-wide type-check and lint remain blocked by the baseline/concurrent failures above; focused tests, direct probes, direct ESLint, and diff check pass.
- Unrelated concurrent worktree changes in answer/resolve/finalize routes and tests, plus pre-existing `tasks/lessons.md`, were not read, changed, staged, or reviewed.
- No product code, lesson, deployment, push, merge, or production state was changed.
