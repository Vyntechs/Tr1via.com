# Task 6 host/atomic routes quality re-review

Repair reviewed: `538ae0d` (`ece3d8d..538ae0d`).

## Ranked findings

None. All three prior P2 findings are closed; no remaining P0-P2 issue was found in the repair.

## Prior P2 closure

### Lifecycle receipt lock order: CLOSED

The repair makes both parent rows named by a pre-lock receipt deferred constraints: direct night ancestry and expected-game ancestry are `DEFERRABLE INITIALLY DEFERRED`, while immutable run-history ancestry remains immediate (`supabase/migrations/0026_atomic_answer_engine_open.sql:14-35`). Receipt insertion therefore no longer holds a game `KEY SHARE` lock while lifecycle commands serialize on night then game `FOR UPDATE`. The catalog regression proves the effective FK modes (`tests/integration/atomic-answer-engine-open.test.ts:383-416`), and the broader live-engine database suite retains ancestry, terminal receipt, replay, and lifecycle behavior.

### Strict open event kind: CLOSED

Night open rejects any parsed eventful result whose kind is not `night_opened` before calling the exact projector or broadcaster (`app/api/nights/[id]/open/route.ts:42-53`). The regression supplies a valid strict `game_started` envelope and proves generic HTTP 500 plus zero projection/broadcast (`tests/unit/api-open-night-route.test.ts:185-205`). Non-event terminal outcomes remain valid because the shared parser allows typed stale/not-found/retry/corrupt results without inventing an event.

### Exactly-once Show Answer fireworks: CLOSED

Show Answer emits the question salvo only inside the transaction-winner and exact-projection gates, only when `fresh.kind === "play_resolved"`, and uses the projected play's authoritative question ID (`app/api/games/[id]/end-early/route.ts:69-95`). The tests prove a fresh resolved winner emits exactly one salvo, a final-window transition emits none, and a nonfresh resolved retry never projects or emits (`tests/unit/api-host-live-engine-routes.test.ts:159-232`). Fireworks failure remains fixed-message best effort and uses the shared 750ms-bounded transport.

## §5.1 Root cause fixed: PASS

Evidence: `supabase/migrations/0026_atomic_answer_engine_open.sql:26-35` — expected-game FK validation is deferred at the shared receipt schema boundary, removing the pre-lock parent-game lock rather than special-casing one route.

## §5.2 No new abstractions: PASS

Evidence: `app/api/games/[id]/end-early/route.ts:69-95` — the repair reuses the existing freshness, exact projection, and fireworks helpers without introducing another orchestration layer.

## §5.3 No dead code: PASS

Evidence: `tests/unit/api-host-live-engine-routes.test.ts:159-232` — every new fireworks branch is exercised, including the fresh resolved, final-window, and replay cases; no changed file adds TODO/FIXME or commented-out implementation.

## §5.4 Honest naming: PASS

Evidence: `tests/integration/atomic-answer-engine-open.test.ts:383-416` — the test name and assertions accurately distinguish pre-lock ancestry, which is deferred, from run ancestry, which remains immediate.

## §5.5 Failure modes considered: PASS

Evidence: `tests/unit/api-open-night-route.test.ts:185-205` — a structurally valid wrong-kind result fails closed before side effects; `tests/unit/api-host-live-engine-routes.test.ts:212-232` proves replay cannot duplicate the cosmetic winner effect.

## Type checker / linter

`npx tsc --noEmit`: FAIL on the same seven established fixture diagnostics; no repair file appears.

```text
tests/unit/collect-verified-questions.test.ts(59,5), (114,5), (139,5): TS2322 callback returns number
tests/unit/HostHomeClient-founder-build.test.tsx(30,19), (44,19): TS2739 fixture props missing
tests/unit/prod-smoke-budget.test.ts(12,30), (38,30): TS2345 ProcessEnv missing NODE_ENV
```

`npm run lint`: FAIL because the Next 16 repository script treats `next lint` as a nonexistent `tr1via/lint` directory.

Direct ESLint over every changed TypeScript route/test: PASS.

## Verification

- Read all six repair files fully and inspected the exact `ece3d8d..538ae0d` diff.
- Targeted route/shared broadcast regressions: PASS — 3 files, 23/23 tests.
- Atomic-open plus full live-engine database regressions: PASS — 2 files, 63/63 tests.
- Direct ESLint over all changed TypeScript files: PASS.
- `git diff --check 538ae0d^..538ae0d`: PASS; repair delta is exactly 6 files, 101 insertions, 3 deletions.

## Verdict: APPROVE

The repair closes the remaining lifecycle deadlock, wrong-kind open, and duplicate/missing fireworks seams without weakening ancestry, replay suppression, projection gating, or bounded failure containment.

## Skipped/Failed:

- `tasks/workflow.md` and `tasks/todo.md` do not exist; used the supplied §5 rubric and prior finding contract.
- A real independent-connection PostgreSQL race was unavailable because neither `supabase` nor `psql` is installed and no local Postgres image exists. Static PostgreSQL lock analysis plus catalog assertions prove the former conflicting game parent lock is no longer acquired before lifecycle locks; PGlite cannot simulate independent shared connections.
- Repository-wide type-check and the legacy lint script remain baseline-blocked as documented above.
- Unrelated `tasks/lessons.md` changes were not read, changed, staged, or reviewed.
- No product code, migration, deployment, push, merge, or production state was changed.
