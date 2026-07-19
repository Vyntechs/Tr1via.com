# Task 6 privacy-safe live-answer telemetry report

## Outcome

- Added a narrow per-play health-event constructor and best-effort recorder.
- Events require an opaque UUID play ID and a closed, shared-contract result code.
- Optional measures are limited to a coarse latency bucket, non-negative retry/duplicate/reconciliation counts, and normalized `all_confirmed`, `timer`, or `host` resolution reason.
- The constructor creates a new frozen object from the allowlist. Unknown fields are never enumerated or copied.
- Room codes, answer text/choice, request bodies, player/device/submission identity, cookies, authorization, tokens, and raw database messages are dropped even when attached to otherwise valid input.
- Invalid IDs, fine-grained latency strings, unknown result/reason strings, and invalid counts fail closed without invoking the sink.
- Collector failures are swallowed and reported as `false`, so telemetry cannot change a committed live mutation's outcome.

## TDD evidence

- Initial RED: the focused suite failed because `lib/live-answer/telemetry.ts` did not exist.
- Initial GREEN: the minimum allowlist constructor, coarse bucketer, and recorder passed 14 tests.
- Tightening RED: a play-only event was accepted without a typed result code.
- Tightening GREEN: result code became required and the focused suite passed all 15 tests.

## Verification

- Focused telemetry suite: 1 file, 15 tests passed.
- Broad live-answer unit regression: 6 files, 54 tests passed.
- Direct ESLint over both owned files: passed.
- `git diff --check` over both owned files: passed.
- `npx tsc --noEmit`: no telemetry-file diagnostics. It reported the seven established fixture errors plus one concurrent player-route diagnostic in `app/api/answers/route.ts`; that route belongs to another active lane.

## Skipped/Failed

- No route integration, external analytics vendor, persistent telemetry table, migration, production logging, deployment, rollout, push, merge, or production mutation was added or performed.
- The repository `npm run lint` script remains incompatible with Next 16; direct ESLint was used and passed.
