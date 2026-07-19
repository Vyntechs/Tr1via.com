# Task 6 telemetry quality/security review

Commit reviewed: `d6745e2` only (`72a6f50..d6745e2`)

## Ranked findings

### P2 — Re-reading allowlisted properties lets malformed input bypass validation and leak raw data

`createLiveAnswerHealthEvent` validates properties directly from the unknown input and then reads them again while constructing the event (`lib/live-answer/telemetry.ts:77-109`). A stateful getter or `Proxy` can therefore return a valid value during validation and a sensitive value during copying. The direct probe returned an emitted event whose third `playId` read was a different device-like UUID and whose second `resultCode` read was the raw string `"raw database detail"`, despite both values failing the intended allowlist. The denied-field getter test only proves that unknown property names are not accessed (`tests/unit/live-answer-telemetry.test.ts:148-167`); it does not cover mutation between validation and use. Snapshot every allowed property once, validate the snapshots, and build only from those validated snapshots.

### P2 — An asynchronously rejecting sink escapes the best-effort failure boundary

`recordLiveAnswerHealth` wraps only the synchronous sink invocation and immediately reports success (`lib/live-answer/telemetry.ts:121-133`). TypeScript permits an `async` function where a void-returning callback is expected, so a rejected collector promise is not caught. The direct probe returned `true` and observed an unhandled `"collector unavailable"` rejection. That contradicts the claim that collector failure reports `false` and cannot affect the live request (`lib/live-answer/telemetry.ts:117-133`; `.superpowers/sdd/task-6-telemetry-report.md:10-11`). Either explicitly reject thenables without an unhandled rejection or make the recorder async and await/catch the sink; add a regression for a rejected promise.

## §5.1 Root cause fixed: FAIL

Evidence: `lib/live-answer/telemetry.ts:77-109` — the privacy boundary validates and copies different reads of unknown input, so it does not guarantee that emitted values are the validated opaque ID and typed result code.

## §5.2 No new abstractions: PASS

Evidence: `lib/live-answer/telemetry.ts:3-45` — one event type, closed allowlists, and one sink boundary are proportionate to the requested telemetry contract; no vendor or persistence abstraction was added.

## §5.3 No dead code: PASS

Evidence: `tests/unit/live-answer-telemetry.test.ts:11-168` — every exported telemetry primitive and each optional event field is exercised; the changed implementation contains no TODO/FIXME, commented-out block, debug statement, or unreachable branch.

## §5.4 Honest naming: FAIL

Evidence: `lib/live-answer/telemetry.ts:121-133` — `recordLiveAnswerHealth` returns `true` even when an accepted async sink rejects and no successful record occurred.

## §5.5 Failure modes considered: FAIL

Evidence: `tests/unit/live-answer-telemetry.test.ts:134-167` — tests cover only synchronous sink throws and getters on denied property names; they omit rejected promises and stateful getters on allowed fields, both of which fail direct probes.

## Allowlist/security assessment

- **Static plain-object allowlist: PASS.** The intended output keys are limited to opaque UUID `playId`, coarse latency bucket, typed result code, non-negative safe-integer retry/duplicate/reconciliation counts, and normalized resolution reason (`lib/live-answer/telemetry.ts:3-48`, `:77-109`).
- **Denied-field names: PASS.** Unknown properties are neither enumerated nor referenced; throwing denied-field getters remain unread (`tests/unit/live-answer-telemetry.test.ts:148-167`).
- **Denied values through allowed fields: FAIL.** Repeated reads permit the P2 validation/copy substitution above.
- **Malformed primitive/array/range input: PASS.** Non-objects, arrays, invalid UUIDs, non-members, negative/fractional counts, and non-finite/negative latency fail closed (`lib/live-answer/telemetry.ts:54-62`, `:70-89`, `:136-152`).
- **Synchronous sink failure: PASS.** A thrown sink error is caught and returns `false` (`lib/live-answer/telemetry.ts:128-133`).
- **Asynchronous sink failure: FAIL.** A rejected sink promise returns `true` and becomes unhandled, as reproduced directly.
- **Mutation isolation: UNCLEAR.** The commit adds no production caller, so no live mutation is directly coupled to the recorder; unit tests cannot prove request/mutation behavior once integration is added (`.superpowers/sdd/task-6-telemetry-report.md:28-31`).
- **Types: UNCLEAR.** Closed literal unions correctly narrow ordinary events, but `satisfies readonly LiveCanonicalResult["code"][]` proves members are valid, not that the telemetry allowlist remains exhaustive when the canonical union changes (`lib/live-answer/telemetry.ts:11-26`), and the void sink type does not exclude async callbacks (`:45`).

## Type checker / linter

`npx tsc --noEmit`: FAIL with the seven established fixture diagnostics plus one concurrent dirty-worktree diagnostic; no telemetry-file diagnostic appeared.

```text
app/api/answers/route.ts(121,9): TS2322 string | null is not assignable to string
tests/unit/collect-verified-questions.test.ts(59,5), (114,5), (139,5): TS2322 callback returns number, expected void/Promise<void>
tests/unit/HostHomeClient-founder-build.test.tsx(30,19), (44,19): TS2739 missing previousGames and inSetup
tests/unit/prod-smoke-budget.test.ts(12,30), (38,30): TS2345 ProcessEnv missing NODE_ENV
```

`npm run lint`: FAIL because the repository's Next 16 script treats `next lint` as a nonexistent `tr1via/lint` project directory.

`npx eslint lib/live-answer/telemetry.ts tests/unit/live-answer-telemetry.test.ts`: PASS.

## Verification

- Read all three files changed by `d6745e2` fully and inspected the complete shared `LiveCanonicalResult` type.
- Focused telemetry suite: PASS — 1 file, 15/15 tests.
- Direct stateful allowlisted-getter probe: FAIL — emitted substituted UUID and raw result string.
- Direct rejected-promise sink probe: FAIL — returned `true` and emitted an unhandled rejection.
- `git diff --check d6745e2^..d6745e2`: PASS.

## Verdict: REQUEST-CHANGES

The ordinary-object allowlist is narrow, but two malformed/failure paths violate the privacy and best-effort guarantees and need regressions before approval.

## Skipped/Failed:

- `tasks/workflow.md` and `tasks/todo.md` do not exist in this worktree; used the supplied §5 rubric and telemetry review contract.
- Production mutation isolation could not be exercised because `d6745e2` adds no route or mutation integration.
- Repository-wide type-check and lint remain blocked by the baseline/concurrent failures above; focused tests and direct ESLint pass.
- Unrelated concurrent worktree changes in answer/resolve/finalize routes and tests, plus pre-existing `tasks/lessons.md`, were not read, changed, staged, or reviewed.
- No product code, lesson, deployment, push, merge, or production state was changed.
