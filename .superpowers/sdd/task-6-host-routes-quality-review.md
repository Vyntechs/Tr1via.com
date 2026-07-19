# Task 6 host/atomic routes quality and security review

Commits reviewed: `90d7b45` and `83d3433`, including the effective atomic-open and shared lifecycle contracts they route through.

## Ranked findings

### P2 — Immediate receipt-to-game ancestry preserves a lifecycle deadlock

The open repair defers only `live_command_receipts_night_fk` (`supabase/migrations/0026_atomic_answer_engine_open.sql:14-24`). The receipt's `(expected_game_id, night_id)` FK remains immediate (`supabase/migrations/0022_live_answer_engine_schema.sql:249-255`), while the effective claim helper inserts the receipt before lifecycle functions lock the night and game (`supabase/migrations/0025_reset_night_answer_engine.sql:192-209`; `supabase/migrations/0023_live_answer_engine_functions.sql:402-419`). Two distinct commands for the same game can therefore each hold a parent-game `KEY SHARE` lock from FK validation; one then holds the night `FOR UPDATE` lock and waits for the other's game lock, while the other waits for the night while retaining its game lock. PostgreSQL breaks that cycle by aborting one command as a deadlock instead of returning two canonical typed outcomes. The same ordering is used by start, reveal, Show Answer, undo, end, and reset. Defer the direct game ancestry check or adopt one consistent parent-lock-before-receipt protocol, then prove it with two independent PostgreSQL connections.

### P2 — The open route accepts and may broadcast a valid wrong-kind command envelope

Unlike every newly routed lifecycle handler, night open sends any fresh event accepted by the shared command union directly to projection (`app/api/nights/[id]/open/route.ts:42-61`). A strict but wrong-kind `game_started`, `night_reset`, or other applied command result therefore is not rejected as a broken `open_night_run` contract; if its referenced durable state matches, it can be projected and broadcast. The open tests cover extra-field malformation but not a valid wrong command kind (`tests/unit/api-open-night-route.test.ts:120-183`). Require `night_opened` before projection/response handling, matching the per-route kind checks in `app/api/games/[id]/start/route.ts:53-62` and peers.

### P2 — A Show Answer winner that resolves immediately drops the question fireworks beat

`begin_question_play_final_window` legitimately returns either `final_window_started` or `play_resolved`, and the route accepts both (`app/api/games/[id]/end-early/route.ts:58-68`). When this host request is the fresh `play_resolved` winner, the route broadcasts the authoritative live event but never calls `broadcastFireworks` (`app/api/games/[id]/end-early/route.ts:69-86`). Any later public finalizer is a nonfresh replay, so it cannot emit the missing salvo. The parameterized test exercises both outcomes but makes no fireworks assertion (`tests/unit/api-host-live-engine-routes.test.ts:159-191`). Fire the salvo only for a projected fresh `play_resolved` winner, preserving replay suppression.

## §5.1 Root cause fixed: FAIL

Evidence: `supabase/migrations/0026_atomic_answer_engine_open.sql:14-24` — the direct night-FK cycle is fixed, but the same receipt-first protocol retains an immediate game FK before later `FOR UPDATE` game locking.

## §5.2 No new abstractions: PASS

Evidence: `app/api/games/[id]/start/route.ts:36-80` — the change reuses the strict shared envelope parser, exact projector, and bounded broadcast boundary without introducing a new state or vendor abstraction.

## §5.3 No dead code: PASS

Evidence: `tests/unit/api-host-live-engine-routes.test.ts:113-300` — all six resilient host mutations, replay suppression, malformation, wrong kind, and fan-out rejection exercise the added branches; no changed file adds TODO/FIXME or commented-out implementation.

## §5.4 Honest naming: PASS

Evidence: `app/api/host/answer-engine/route.ts:7-29` — `preferredEngine` changes only the authenticated host's future-night setting, while `release_enabled` remains a separately read server-owned gate.

## §5.5 Failure modes considered: FAIL

Evidence: `tests/integration/atomic-answer-engine-open.test.ts:383-410` — catalog coverage proves only the night/run FK modes and PGlite uses one connection; it cannot exercise the remaining receipt-game/night lock cycle. Route tests also omit open wrong-kind and immediate-resolution fireworks regressions.

## Quality/security assessment

- **Authentication/ownership: PASS.** Every lifecycle route authenticates and proves game/night ownership before using the service-role client (`app/api/games/[id]/start/route.ts:24-36`; `app/api/nights/[id]/reset-to-setup/route.ts:26-38`). The preference route scopes reads and writes to `auth.host.id` and its strict body cannot change `release_enabled` (`app/api/host/answer-engine/route.ts:32-69`).
- **RPC grants and search paths: PASS.** Live mutation functions remain `SECURITY DEFINER` with fixed `pg_catalog, public` search paths and browser-role execution revoked; effective open grants only `service_role` (`supabase/migrations/0026_atomic_answer_engine_open.sql:26-36`, `:159-162`; `supabase/migrations/0023_live_answer_engine_functions.sql:1179-1208`).
- **Receipt terminal paths: PASS outside the deadlock.** Open terminates legacy, already-open, stale, and applied receipts (`supabase/migrations/0026_atomic_answer_engine_open.sql:73-93`, `:110-155`); reset archives pending/terminal predecessors and completes its own winner atomically (`supabase/migrations/0025_reset_night_answer_engine.sql:360-458`).
- **Latch/preference isolation: PASS.** Engine selection occurs under the night lock; already-open and latched nights ignore later preference changes (`supabase/migrations/0026_atomic_answer_engine_open.sql:68-108`). Host preference writes cannot update a night (`app/api/host/answer-engine/route.ts:60-68`).
- **Malformed/ancestry handling: PARTIAL.** Strict schemas reject extra fields and most lifecycle routes verify command kind plus request target. Exact projection independently suppresses stale or mismatched game/play ancestry (`lib/live-answer/projectEvent.ts:18-95`). The open wrong-kind gap above remains. The real `play_opened` SQL result omits `questionId` (`supabase/migrations/0023_live_answer_engine_functions.sql:570-575`), so the reveal route's conditional question check cannot prove the requested question from the canonical response (`app/api/games/[id]/reveal/route.ts:67-77`); database ancestry still prevents cross-question mutation.
- **Replay/freshness/projection: PASS.** Only `freshlyApplied:true` becomes a transaction winner; replays and nonwinners do not project or broadcast (`lib/live-answer/rpcResult.ts:244-303`). Exact projection checks run, revisions, event state, and ancestry before fan-out (`lib/live-answer/projectEvent.ts:29-95`).
- **Fireworks: FAIL for immediate Show Answer resolution; PASS for game end.** Finale fireworks are gated behind fresh exact game-end projection (`app/api/games/[id]/end/route.ts:65-85`), while the P2 above identifies the missing fresh question salvo.
- **Broadcast containment: PASS.** The shared transport passes an abort signal, aborts at 750ms, and clears its timer (`lib/api/broadcast.ts:104-145`). All resilient host catches use fixed messages without raw error objects; sequential game-end live/finale fan-outs are each individually bounded (`app/api/games/[id]/end/route.ts:69-84`).
- **Legacy behavior: PASS in the reviewed diff.** Legacy branches retain their prior schemas and table/RPC paths; direct legacy end-early and reset regressions pass. Older legacy catches still log raw errors and some legacy responses expose database messages, but those lines predate these commits and were not expanded by the resilient branches.
- **Maintainability: CONCERN.** Six routes duplicate parse → kind-check → project → broadcast orchestration, and the open/fireworks omissions demonstrate drift. This is not a separate blocker beyond the findings above, but the repair should centralize only the common validated delivery boundary if that reduces divergence without hiding route-specific ancestry.

## Type checker / linter

`npx tsc --noEmit`: FAIL on the same seven established test-fixture diagnostics; no reviewed file appears.

```text
tests/unit/collect-verified-questions.test.ts(59,5), (114,5), (139,5): TS2322 callback returns number
tests/unit/HostHomeClient-founder-build.test.tsx(30,19), (44,19): TS2739 fixture props missing
tests/unit/prod-smoke-budget.test.ts(12,30), (38,30): TS2345 ProcessEnv missing NODE_ENV
```

`npm run lint`: FAIL because the Next 16 project treats `next lint` as a nonexistent `tr1via/lint` directory.

Direct ESLint over every changed TypeScript route/test: PASS.

## Full-test/build claim inspection

- The host report claims a full `npm test` pass but does not retain command output; critic scope did not rerun the full suite. The 140 focused/shared/legacy/database tests run here all pass.
- `npm run build`: independently PASS at current `83d3433` HEAD, including Next production compilation, TypeScript build phase, and 36/36 static pages. The prebuild regenerated `app/themes.generated.css` byte-identically.

## Verification

- Read all 13 files changed by `90d7b45` and `83d3433` fully, plus the effective receipt helpers, lifecycle functions, schema FKs/grants, strict parser, exact projector, auth helpers, and bounded broadcast transport.
- Focused/shared/legacy unit regressions: PASS — 10 files, 70/70 tests.
- Atomic/live-engine/scoring database regressions: PASS — 3 files, 70/70 tests.
- Production build: PASS.
- Direct ESLint: PASS over all changed TypeScript files.
- `git diff --check` for both commit deltas: PASS.

## Verdict: REQUEST-CHANGES

The host authority, strict parsing, projection, replay, 750ms broadcast containment, legacy branching, and atomic open latch are substantially sound, but lifecycle receipt locking can still deadlock and two winner-only delivery behaviors are incomplete.

## Skipped/Failed:

- `tasks/workflow.md` and `tasks/todo.md` do not exist; used the supplied §5 rubric, Task 6 brief, authoritative plan/spec, and host report.
- The full `npm test` suite was not rerun because full-suite validation belongs to the validator; focused/shared/legacy/database coverage and production build were run directly.
- No independent two-connection PostgreSQL lifecycle race was run against shared local state; the deadlock follows from the effective immediate FK and explicit lock order, while PGlite cannot model independent shared connections.
- Repository-wide type-check and the legacy lint script remain baseline-blocked as documented above.
- Unrelated `tasks/lessons.md` changes were not read, changed, staged, or reviewed.
- No product code, migration, deployment, push, merge, or production state was changed.
