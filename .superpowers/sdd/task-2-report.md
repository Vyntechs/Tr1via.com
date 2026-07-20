# Task 2 — Automatically resume partial certified generation

## Delivered

- Durable generation progress now includes its recovery `attempt`.
- Added a bounded auto-resume policy: only stopped jobs with work remaining
  and attempts one or two restart automatically; attempt three remains on the
  host's Continue/manual recovery screen.
- The host keeps the loading view visible while an eligible durable attempt is
  restarted, including the certified count and shortfall. It invokes the
  resume POST once per durable attempt. A `409` leaves the Continue control
  visible rather than pretending a restart succeeded.
- Durable heartbeats are single-flight and drained after their interval stops,
  before a generation job can return or throw into a terminal state update.
- The generation route now derives stale resumability through
  `generationProgressFromRow`, so a dead worker is recoverable even when its
  stored raw phase is still nonterminal.

## TDD evidence

1. Added progress, policy, heartbeat, and host auto-resume specifications.
2. Observed RED with missing policy/heartbeat modules, missing `attempt`, and
   the host still showing the paused screen without starting recovery.
3. Implemented the minimal policy, gate, route alignment, and client wiring.
4. Focused GREEN:

```sh
npx vitest run tests/unit/generation-job.test.ts tests/unit/generation-auto-resume.test.ts tests/unit/generation-heartbeat.test.ts tests/unit/useGenerationStatus.test.tsx tests/component/HostGenError.test.tsx tests/component/HostSetupPickClient-auto-resume.test.tsx
```

Result: 6 files passed, 37 tests passed.

## Final verification

```sh
npm test
```

Result: passed.

```sh
npx tsc --noEmit
```

Result: blocked only by existing test-fixture/environment typing errors in
`HostHomeClient-founder-build.test.tsx` and `prod-smoke-budget.test.ts`; no
Task 2 errors.

```sh
npm run lint
```

Result: unavailable because this Next 16 project still invokes the removed
`next lint` command.

## Reviewer repair — atomic concurrent-resume claim

A reviewer identified that two requests could read the same stopped row and
both schedule resume workers. The recovery route now conditionally updates by
`category_id`, the observed durable `attempt`, and the stored raw `phase`.
Only the request whose update returns a row schedules `after()`; the other
returns `409`. This also permits a stale raw `repairing` row because stale is
derived before the raw phase is supplied to the claim predicate.

TDD RED:

```sh
npx vitest run tests/unit/generation-job.test.ts tests/unit/api-generate-resume-claim-contract.test.ts
```

Result: 2 failures — missing `claimGenerationResume` and no route claim wiring.

Focused GREEN:

```sh
npx vitest run tests/unit/generation-job.test.ts tests/unit/generation-auto-resume.test.ts tests/unit/generation-heartbeat.test.ts tests/unit/useGenerationStatus.test.tsx tests/component/HostGenError.test.tsx tests/component/HostSetupPickClient-auto-resume.test.tsx tests/unit/api-generate-resume-claim-contract.test.ts
```

Result: 7 files passed, 39 tests passed.

`npx tsc --noEmit` remains blocked only by the same four unrelated fixture and
environment typing errors listed above; the atomic-claim changes add none.

## Architecture repair — stale-worker fencing (Task 2A)

Each begin/claim now passes its returned durable attempt into the worker. A
resume claim also matches the exact observed `heartbeat_at` version. Every
worker progress write conditionally updates by `category_id` plus attempt; a
failed conditional write raises a private superseded signal that exits without
terminal error state or broadcasts.

Immediately before each question insert, photo update, reroll cleanup,
auto-pick, report insert, category finalization, and broadcast, the worker
performs a conditional heartbeat refresh using the same attempt fence. This
replaces the rejected read-only current-attempt check. Broadcasts await a
successful fenced heartbeat first, so an old worker cannot revive a stale
phase, error, photo, or done event after replacement.

TDD RED:

```sh
npx vitest run tests/unit/generation-job.test.ts tests/unit/api-generate-resume-claim-contract.test.ts
npx vitest run tests/unit/generation-heartbeat.test.ts
```

Result: missing heartbeat claim predicate and fenced worker write, then a
heartbeat gate that could not be awaited before broadcast.

Focused GREEN:

```sh
npx vitest run tests/unit/generation-job.test.ts tests/unit/api-generate-resume-claim-contract.test.ts tests/unit/generation-auto-resume.test.ts tests/unit/generation-heartbeat.test.ts tests/unit/useGenerationStatus.test.tsx tests/component/HostGenError.test.tsx tests/component/HostSetupPickClient-auto-resume.test.tsx tests/unit/verify-answers.test.ts tests/unit/collect-verified-questions.test.ts tests/unit/ai-prompts.test.ts
```

Result: 10 files passed, 85 tests passed.

`npx tsc --noEmit` still reports only the same four unrelated fixture and
environment typing errors; no Task 2A typing errors.
