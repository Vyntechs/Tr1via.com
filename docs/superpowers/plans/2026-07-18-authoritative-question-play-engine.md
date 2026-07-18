# Authoritative Question Play Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Add a server-authoritative, idempotent Original-mode play engine that preserves every answer received before the visible deadline, scores once, resolves once, and leaves existing production nights on the legacy engine.

**Architecture:** Each opened night has one immutable run identity and monotonic room/control revisions. Each question reveal creates one immutable play with frozen eligibility and database deadlines. Answers, host commands, finalization, undo, game end, and reset are single Postgres transactions using one lock order. The current API routes branch on the night-latched engine; only the transaction winner emits an audience-safe broadcast.

**Tech Stack:** PostgreSQL/Supabase migrations and RPCs, Next.js route handlers, TypeScript strict, Vitest/PGlite, `pg` multi-connection concurrency tests.

## Global Constraints

- Begin only after `2026-07-18-live-answer-security-gate.md` is implemented and verified.
- Existing and already-open nights remain `legacy`; there is no historical backfill.
- Every transaction locks `nights` then `games` then `question_plays` in that order.
- Database `clock_timestamp()` decides receipt time, deadlines, undo, and speed bonus; phone clocks are never trusted.
- New mutation tables are server-only. Revoke execution from `PUBLIC`, `anon`, and `authenticated`; grant only `service_role`.
- Do not publish raw eligibility or answer tables through Realtime. Publish only `live_room_events` and allowlisted room broadcasts.
- The TV is display-only. A public deadline check may only finalize the current room play when the database says it is due.
- Preserve the `game_scores` view name and columns for every existing consumer.
- Rollback disables `resilient_v1` only for newly opened nights; an already latched night finishes on its stored engine and its additive records remain intact for incident review.
- Do not deploy, enable Heather, or switch any open night as part of this plan.

---

## File Map

**Create:**

- `supabase/migrations/0022_live_answer_engine_schema.sql`
- `supabase/migrations/0023_live_answer_engine_functions.sql`
- `supabase/migrations/0024_game_scores_answer_engine.sql`
- `supabase/migrations/0025_reset_night_answer_engine.sql`
- `lib/live-answer/contracts.ts`
- `lib/live-answer/projectPlay.ts`
- `lib/live-answer/telemetry.ts`
- `app/api/room/[code]/plays/[playId]/finalize/route.ts`
- `app/api/host/answer-engine/route.ts`
- `tests/integration/live-answer-engine-schema.test.ts`
- `tests/integration/game-scores-answer-engine.test.ts`
- `tests/unit/api-answers-route.test.ts`
- `tests/unit/live-answer-telemetry.test.ts`
- `tests/concurrency/live-answer-races.test.ts`
- `vitest.db.config.ts`

**Modify:**

- `package.json`, `package-lock.json`
- `lib/api/schemas.ts`
- `lib/api/broadcast.ts`
- `lib/game/scramble.ts`
- `lib/supabase/types.ts` through `npm run typegen` only
- `app/api/nights/[id]/open/route.ts`
- `app/api/games/[id]/start/route.ts`
- `app/api/games/[id]/reveal/route.ts`
- `app/api/answers/route.ts`
- `app/api/games/[id]/end-early/route.ts`
- `app/api/games/[id]/undo/route.ts`
- `app/api/games/[id]/end/route.ts`
- `app/api/nights/[id]/reset-to-setup/route.ts`
- `app/api/players/route.ts`
- `app/api/nights/[id]/players/route.ts`
- `app/api/players/[id]/route.ts`
- `app/api/players/[id]/join-game/route.ts`
- `app/api/room/[code]/snapshot/route.ts`
- `app/api/tv/[code]/snapshot/route.ts`
- relevant existing route and integration tests.

## Required TypeScript Contracts

Add to `lib/live-answer/contracts.ts`:

```ts
export type LivePlayState =
  | "accepting"
  | "all_in_hold"
  | "final_window"
  | "resolved"
  | "undone";

export interface LiveRevision {
  runId: string;
  roomRevision: number;
  controlRevision: number;
  playId: string | null;
}

export interface LivePlayProjection {
  playId: string;
  gameId: string;
  questionId: string;
  state: LivePlayState;
  openedAt: string;
  mainZeroAt: string;
  finalWindowStartsAt: string | null;
  finalWindowEndsAt: string;
  finalizeAt: string | null;
  eligibleCount: number;
  confirmedCount: number;
}

export type SubmitAnswerResult =
  | { code: "confirmed"; confirmedSlot: 1 | 2 | 3 | 4; duplicate: boolean; live: LiveRoomProjection }
  | { code: "deadline_passed" | "identity_invalid" | "not_eligible" }
  | { code: "retry_later"; retryAfterMs: number };
```

Every new snapshot and broadcast carries `runId`, `roomRevision`, `controlRevision`, and `playId`.

---

### Task 1: Add red schema, privilege, and scoring tests

**Files:** Create `tests/integration/live-answer-engine-schema.test.ts` and `tests/integration/game-scores-answer-engine.test.ts`.

**Step 1: Pin the schema contract**

Using PGlite, assert the required night/player columns, tables, status checks, partial uniqueness, composite eligibility foreign key, RLS, table grants, and RPC grants. Prove raw `anon` and `authenticated` writes and RPC execution are denied.

**Step 2: Pin engine-aware scoring**

Seed one legacy night and one resilient night, each with Game 1/Game 2, a two-game player, a zero-answer participant, and adjustments. Assert the legacy branch reads only `answers`; resilient reads only resolved `question_play_answers`; neither double-counts; Game 1/Game 2 remain isolated; zero-answer players stay visible.

**Step 3: Run red tests**

```bash
npx vitest run tests/integration/live-answer-engine-schema.test.ts tests/integration/game-scores-answer-engine.test.ts
```

Expected: fail because migrations `0022`-`0024` do not exist.

**Step 4: Commit**

```bash
git add tests/integration/live-answer-engine-schema.test.ts tests/integration/game-scores-answer-engine.test.ts
git commit -m "test: define authoritative play schema"
```

---

### Task 2: Add the engine/run/play schema

**Files:** Create `supabase/migrations/0022_live_answer_engine_schema.sql`; modify normal and host-added player routes.

**Step 1: Add identity and latch columns**

- `players.can_answer boolean not null default true`.
- `nights.answer_engine text not null default 'legacy' check (answer_engine in ('legacy','resilient_v1'))`.
- `nights.answer_engine_latched_at timestamptz`, `current_run_id uuid`, `room_revision bigint not null default 0`, `control_revision bigint not null default 0`.
- Normal signed join writes `can_answer=true`; host-created score-only name writes `can_answer=false`.

**Step 2: Add server-only host rollout settings**

Create `host_answer_engine_settings(host_id primary key, release_enabled boolean default false, preferred_engine text default 'legacy', updated_at timestamptz)`. Enable RLS and grant only service-role access. This prevents a browser table update from self-enabling the release.

**Step 3: Add immutable command/play tables**

- `live_command_receipts`: primary key `(night_id, command_id)`, run/kind/request hash, expected control/game/play/status, canonical result.
- `question_plays`: identities, status, opened/main/final/finalize/resolved times, reason, eligible/confirmed counts. Add one-unfinished-play-per-run partial unique index and one non-undone play per run/question.
- `question_play_eligibility`: primary key `(play_id, player_id)`.
- `question_play_answers`: primary key `(play_id, player_id)`, stable submission ID, visible/canonical choices, server receipt, exact lock time, correctness/award, composite FK to eligibility.
- `question_play_attempt_windows`: `(play_id, player_id)` window start/count for ten answer attempts per ten seconds.
- `play_finalize_attempt_windows`: one coarse per-play window/count that allows at least a forty-player recovery surge but bounds public deadline-check abuse.
- `live_room_events`: night/run/play/game/question, revisions, allowlisted kind/payload, unique `(night_id, run_id, room_revision)`.

Enable RLS on all new tables; grant service role only. Add only `live_room_events` to `supabase_realtime`.

**Step 4: Verify and commit**

```bash
npx vitest run tests/integration/live-answer-engine-schema.test.ts
git add -- supabase/migrations/0022_live_answer_engine_schema.sql app/api/players/route.ts 'app/api/nights/[id]/players/route.ts' tests/integration/live-answer-engine-schema.test.ts
git commit -m "feat: add immutable live play schema"
```

---

### Task 3: Implement atomic run, command, play, and answer functions

**Files:** Create `supabase/migrations/0023_live_answer_engine_functions.sql`; modify `lib/game/scramble.ts`; extend schema tests.

**Step 1: Add deterministic scramble test vectors**

Export fixed question/player UUID vectors from `lib/game/scramble.ts` tests and implement a private SQL helper that produces identical permutations. Prove all vectors match. The resilient answer RPC accepts only a visible slot and derives canonical choice itself.

**Step 2: Implement command receipt semantics**

Every command hashes its semantic request, inserts a pending receipt with `ON CONFLICT DO NOTHING`, blocks concurrent duplicates on the receipt row, returns the original result for an exact retry, and returns typed `stale` for the same ID with a different hash/precondition. Answer-only room revisions do not invalidate host commands; control-revision or semantic changes do.

**Step 3: Implement service-role RPCs**

Use fixed `search_path = pg_catalog, public`, fully qualified relations, and lock order `night -> game -> play`:

```text
open_night_run(night, command, expected_run, expected_control)
start_live_game(game, run, command, expected_control)
open_question_play(game, question, run, command, expected_control)
submit_question_play_answer(play, run, verified_device, submission, visible_slot)
begin_question_play_final_window(game, play, run, command, expected_control)
finalize_current_play_if_due(room_code, run, play)
undo_question_play(game, play, run, command, expected_control)
end_live_game(game, run, command, expected_control)
```

`open_question_play` freezes active participating nonremoved `can_answer=true` players, stores the normal main deadline and `main + 2s` final deadline, mirrors `questions.played_at`, and advances room/control revisions.

`submit_question_play_answer` captures `clock_timestamp()` once, derives player from the verified cookie value, checks immutable eligibility, enforces ten attempts per ten seconds, returns a saved first answer before checking deadline, accepts new answers only before final deadline, increments confirmed count once, and enters `all_in_hold` only when everyone confirms before main zero. Finalize time is `greatest(last receipt + 1200ms, opened_at + 2000ms)`.

Zero eligible players never enter `all_in_hold`. A conflicting duplicate returns the first saved choice. Answer confirmation increments `room_revision` but never `control_revision`. An answer during an existing final window cannot shorten or extend it, and no newly created answer is accepted at or after its exact end.

`finalize_current_play_if_due` may enter the final window at main zero or resolve a due play. It rate-limits public checks in Postgres, cannot accept a caller-supplied reason or deadline, and an overdue reconnect always scores confirmed answers without guessing an outage or voiding the play. Awards, question finish stamp, event, and revisions happen once.

**Step 4: Verify and commit**

```bash
npx vitest run tests/integration/live-answer-engine-schema.test.ts
git add supabase/migrations/0023_live_answer_engine_functions.sql lib/game/scramble.ts tests/integration/live-answer-engine-schema.test.ts
git commit -m "feat: make live play mutations atomic"
```

---

### Task 4: Replace scoring and reset atomically

**Files:** Create `0024_game_scores_answer_engine.sql` and `0025_reset_night_answer_engine.sql`; modify reset tests.

**Step 1: Replace `game_scores` with one answer-facts CTE**

Legacy facts read current `answers` only for legacy nights. Resilient facts read resolved `question_play_answers` only for resilient nights. Combine with `UNION ALL`, then apply current aggregates and adjustments once. Preserve the public view name/columns and zero-answer rows.

**Step 2: Add engine-aware reset**

Implement `reset_live_night_to_setup(night, run, command, expected_control)`. In one transaction clear legacy answer/reveal rows, resilient play/eligibility/answer/event rows, adjustments, and played/finished timestamps; preserve `answer_engine`; rotate `current_run_id`; reset canonical revisions; reject every old-run request. Keep receipts for audit/idempotency or archive them within the same transaction.

**Step 3: Verify and commit**

```bash
npx vitest run tests/integration/game-scores-answer-engine.test.ts tests/unit/api-reset-night.test.ts
git add supabase/migrations/0024_game_scores_answer_engine.sql supabase/migrations/0025_reset_night_answer_engine.sql tests/integration/game-scores-answer-engine.test.ts
git commit -m "feat: isolate resilient scoring and reset"
```

---

### Task 5: Regenerate types and add audience-safe projections

**Files:** Run type generation; create `lib/live-answer/contracts.ts`, `lib/live-answer/projectPlay.ts`; modify room/TV snapshots and broadcast types.

**Step 1: Regenerate types**

```bash
npm run typegen
```

Never hand-edit the generated result.

**Step 2: Project by audience**

Common room/TV/host projections include run/revisions/play state/deadlines/aggregate counts. Player projection adds only the signed player's canonical answer. Host projection adds only operational counts. TV never receives a selected choice or correctness before resolution.

**Step 3: Make event payloads safe**

Broadcast only after `applied=true`. Answer events carry aggregate confirmed/eligible counts, never player, submission, slot, canonical choice, or device identity. Exact command retries never rebroadcast.

**Step 4: Verify and commit**

```bash
npx vitest run tests/unit/api-room-snapshot-route.test.ts tests/unit/tv-snapshot-route-answer-gating.test.ts tests/unit/roomSnapshotPayload.test.ts
npx tsc --noEmit
git add -- lib/supabase/types.ts lib/live-answer/contracts.ts lib/live-answer/projectPlay.ts 'app/api/room/[code]/snapshot/route.ts' 'app/api/tv/[code]/snapshot/route.ts' lib/api/broadcast.ts
git commit -m "feat: project canonical play state safely"
```

---

### Task 6: Branch existing APIs on the latched engine

**Files:** Modify all lifecycle routes listed in the file map; create finalize and host-setting routes plus `tests/unit/api-answers-route.test.ts`; modify existing route tests.

**Step 1: Add strict request schemas**

```ts
type ResilientReveal = { questionId: string; runId: string; commandId: string; expectedControlRevision: number };
type ResilientAnswer = { playId: string; runId: string; submissionId: string; slotChosen: 1 | 2 | 3 | 4 };
type HostPlayCommand = { playId: string; runId: string; commandId: string; expectedControlRevision: number };
```

No resilient body accepts player ID, device ID, scramble, canonical choice, answer key, reason, or deadline.

**Step 2: Preserve legacy nights**

Each current route reads the night latch. `legacy` follows today's path after the security gate. `resilient_v1` calls the matching RPC. `open` latches allowed host preference once. `start`, `reveal`, answer, Show answer, undo, end, and reset use typed results.

**Step 3: Add public deadline check**

`POST /api/room/[code]/plays/[playId]/finalize` validates code/run/play, rate-limits by opaque room/play, and calls only `finalize_current_play_if_due`. It cannot choose another play, reason, or deadline and returns an audience-safe projection.

**Step 4: Add host preference route**

`GET/POST /api/host/answer-engine` requires the authenticated host. It may choose `legacy` or `resilient_v1` only when `release_enabled` is true. It changes future-night preference only and never an opened night.

**Step 5: Verify and commit**

```bash
npx vitest run tests/unit/api-answers-route.test.ts tests/unit/api-end-early-route.test.ts tests/unit/api-room-snapshot-route.test.ts
npx tsc --noEmit
git add -- lib/api/schemas.ts 'app/api/nights/[id]/open/route.ts' 'app/api/games/[id]/start/route.ts' 'app/api/games/[id]/reveal/route.ts' app/api/answers/route.ts 'app/api/games/[id]/end-early/route.ts' 'app/api/games/[id]/undo/route.ts' 'app/api/games/[id]/end/route.ts' 'app/api/nights/[id]/reset-to-setup/route.ts' 'app/api/room/[code]/plays/[playId]/finalize/route.ts' app/api/host/answer-engine/route.ts tests/unit/api-answers-route.test.ts
git commit -m "feat: route live nights through latched engine"
```

**Step 6: Add allowlisted operational telemetry**

`lib/live-answer/telemetry.ts` may emit only opaque play ID, coarse latency bucket, typed result code, retry count, duplicate/reconciliation count, and resolution reason. It must reject or drop room codes, answer text/choice, request bodies, player/device/submission IDs, cookies, tokens, and raw database messages.

```bash
npx vitest run tests/unit/live-answer-telemetry.test.ts
git add -- lib/live-answer/telemetry.ts tests/unit/live-answer-telemetry.test.ts
git commit -m "feat: record safe live answer health"
```

---

### Task 7: Prove races with independent database connections

**Files:** Create `tests/concurrency/live-answer-races.test.ts`, `vitest.db.config.ts`; modify `package.json` and lockfile.

**Step 1: Add the harness**

Add `pg` and `@types/pg`, plus `test:db-races` using `vitest.db.config.ts`. Tests target a disposable local Supabase database and use independent `pg` connections; PGlite cannot prove locking.

**Step 2: Add required races**

Prove: simultaneous last answers; answer versus timer/host finalization; duplicate/conflicting open commands; Show Answer idempotency; undo versus delayed answer/replay; unfinished-play game end; reset/run rotation; lost acknowledgement reconciliation; late join/removal/reconnect/score-only eligibility; exact deadline/speed boundaries; and forty players with duplicate retries producing exactly forty answers and one terminal transition.

**Step 3: Run and commit**

```bash
supabase start
supabase db reset
npm run test:db-races
git add package.json package-lock.json vitest.db.config.ts tests/concurrency/live-answer-races.test.ts
git commit -m "test: prove authoritative answer races"
```

---

### Task 8: Verify the backend slice

```bash
npx vitest run tests/integration/live-answer-engine-schema.test.ts tests/integration/game-scores-answer-engine.test.ts
npm run test:db-races
npm test
npx tsc --noEmit
npm run build
git diff --check
```

Run static critic, security reviewer, and validator. Stop if any duplicate path can score/broadcast twice, any old run can mutate current state, any non-service role reaches an RPC/table mutation, or a legacy night changes behavior. Do not push, deploy, merge, or enable a host from this plan.
