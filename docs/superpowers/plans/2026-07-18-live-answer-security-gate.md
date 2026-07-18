# Live Answer Security Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Remove browser-held player authority and close every current identity/answer exposure path before any resilient answer-engine code can be previewed or enabled.

**Architecture:** The HMAC-signed, HTTP-only `tr1via_device` cookie becomes the only player credential. Player browsers read canonical state through same-origin, audience-shaped route responses and receive only allowlisted room broadcasts. Authenticated host browsers retain their existing direct Supabase path. A single additive migration revokes anonymous answer access and hardens all live mutation functions so the application and database gates land atomically.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Supabase/Postgres RLS, Vitest, PGlite, Playwright.

## Global Constraints

- This is a release-blocking prerequisite for `2026-07-18-authoritative-question-play-engine.md`.
- One writer owns the complete gate. Never land the client transport change without the privilege migration, or vice versa.
- Preserve host laptop, host phone, TV, join, heartbeat, and legacy answer behavior.
- Preserve migration `0014_questions_withhold_correct_index_from_players.sql`; do not duplicate or weaken it.
- Never return or log `device_id`, signed cookies, raw database errors, another player's selected choice, or a live `correct_index`.
- Do not edit generated `lib/supabase/types.ts`; this slice changes privileges and wire DTOs, not schema columns.
- No deploy, merge to `main`, production mutation, or Heather enablement is part of this plan.

---

## File Map

**Create:**

- `lib/room/roomAudience.ts` — explicit safe DTOs and serializers.
- `tests/integration/live-security-gate-schema.test.ts` — real-Postgres privilege and forged-header regressions.
- `tests/unit/device-session.test.tsx` — proves raw browser device identity is gone.

**Modify:**

- `supabase/migrations/0021_live_security_gate.sql`
- `app/api/session/init/route.ts`
- `lib/hooks/useDeviceSession.ts`
- `lib/supabase/client.ts`
- `app/api/players/route.ts`
- `app/api/nights/[id]/players/route.ts`
- `app/api/room/[code]/snapshot/route.ts`
- `lib/room/roomSnapshotPayload.ts`
- `lib/room/fetchRoomSnapshot.ts`
- `lib/room/roomFallbackStore.ts`
- `lib/hooks/useRoom.ts`
- `app/(player)/join/page.tsx`
- `app/(player)/room/[code]/page.tsx`
- `app/(player)/room/[code]/recap/page.tsx`
- `app/(player)/room/[code]/won/page.tsx`
- `app/host/live/[nightId]/HostLiveConsoleClient.tsx`
- `app/host/phone/[nightId]/HostPhoneClient.tsx`
- `tests/unit/api-room-snapshot-route.test.ts`
- `tests/unit/roomSnapshotPayload.test.ts`
- `tests/unit/tv-snapshot-route-answer-gating.test.ts`
- `tests/integration/questions-correct-index-rls.test.ts`
- `tests/unit/answer-submit.test.tsx`

## Required Wire Contract

`lib/room/roomAudience.ts` owns field-by-field serializers for these shapes:

```ts
export interface RoomPlayer {
  id: string;
  nightId: string;
  displayName: string;
  joinedAt: string;
  lastSeenAt: string;
  removedAt: string | null;
  appSwitchTotalSeconds: number;
}

export interface PlayerCanonicalAnswer {
  id: string;
  questionId: string;
  playerId: string;
  chosenIndex: 0 | 1 | 2 | 3;
  scramble: [number, number, number, number];
  lockedAt: string;
  msToLock: number;
  isCorrect: boolean | null;
  awardedPoints: number | null;
}

export interface HostLiveAnswer {
  id: string;
  questionId: string;
  playerId: string;
  msToLock: number;
  chosenIndex: 0 | 1 | 2 | 3 | null;
  isCorrect: boolean | null;
}
```

Serializers must never use `{ ...row }`, `select("*")`, or an assertion that can silently carry extra columns.

---

### Task 1: Pin the exploit and projection boundaries in failing tests

**Files:** Create `tests/integration/live-security-gate-schema.test.ts`; modify `tests/unit/api-room-snapshot-route.test.ts`, `tests/unit/roomSnapshotPayload.test.ts`, `tests/unit/tv-snapshot-route-answer-gating.test.ts`, and `tests/integration/questions-correct-index-rls.test.ts`.

**Step 1: Add the real-database exploit fixture**

Use PGlite with Supabase role stubs and migrations `0001`, `0002`, `0014`, `0018`, and future `0021`. Seed two devices, two players, a live question, an answer, and host/player roles. Prove a forged `x-tr1via-device` header cannot `SELECT`, `INSERT`, `UPDATE`, or `DELETE` answers, and cannot mutate players or participation.

Query `information_schema.routine_privileges` and prove `resolve_question`, `resolve_question_if_all_locked`, `reset_night_to_setup`, and `swap_point_value` expose execute only to `service_role`.

**Step 2: Add two-player route leak cases**

Seed sentinel `device_id`, `scramble`, live `correct_index`, and another-player choices. Assert no host or player response contains `device_id`; player mode contains only signed-player self state and own answers; host-only `liveAnswers` is absent from player mode; live answer keys are absent.

**Step 3: Add fail-closed serializer cases**

Feed serializers rows with `device_id: "LEAK"`, `submission_id: "LEAK"`, and a live `correct_index`. Assert serialized JSON contains neither sentinel nor live answer key.

**Step 4: Run red tests**

```bash
npx vitest run tests/integration/live-security-gate-schema.test.ts tests/unit/api-room-snapshot-route.test.ts tests/unit/roomSnapshotPayload.test.ts tests/unit/tv-snapshot-route-answer-gating.test.ts tests/integration/questions-correct-index-rls.test.ts
```

Expected: new tests fail against current full-row snapshots and missing migration.

**Step 5: Commit red tests**

```bash
git add tests/integration/live-security-gate-schema.test.ts tests/unit/api-room-snapshot-route.test.ts tests/unit/roomSnapshotPayload.test.ts tests/unit/tv-snapshot-route-answer-gating.test.ts tests/integration/questions-correct-index-rls.test.ts
git commit -m "test: pin live player identity boundary"
```

---

### Task 2: Replace raw room rows with audience-shaped DTOs

**Files:** Create `lib/room/roomAudience.ts`; modify the room snapshot route/payload/fetch/store, the normal player join route, the host latecomer route, and their tests.

**Step 1: Implement explicit serializers**

Add `serializeRoomPlayer`, `serializePlayerSelf`, `serializePlayerCanonicalAnswer`, `serializeHostLiveAnswer`, and `serializeRoomQuestion`. Assign every property explicitly. A question includes `correctIndex` only when `finished_at` is non-null.

**Step 2: Narrow database projections**

The shared roster query may select only:

```text
id, night_id, display_name, joined_at, last_seen_at, removed_at, app_switch_total_seconds
```

The player self lookup may read `device_id` only server-side to authorize. Use a discriminated payload:

```ts
type RoomSnapshotPayload =
  | { audience: "player"; self: RoomPlayer; myAnswers: PlayerCanonicalAnswer[]; myParticipations: ParticipationDTO[]; liveAnswers?: never }
  | { audience: "host"; self: null; myAnswers?: never; myParticipations?: never; liveAnswers: HostLiveAnswer[] };
```

Public/player failures return generic typed messages, never raw `error.message`.

**Step 3: Make join responses safe**

Keep database behavior unchanged; return only serialized safe player fields from both player join and host-add-player routes.

**Step 4: Verify and commit**

```bash
npx vitest run tests/unit/api-room-snapshot-route.test.ts tests/unit/roomSnapshotPayload.test.ts
git add -- lib/room/roomAudience.ts 'app/api/room/[code]/snapshot/route.ts' lib/room/roomSnapshotPayload.ts lib/room/fetchRoomSnapshot.ts lib/room/roomFallbackStore.ts app/api/players/route.ts 'app/api/nights/[id]/players/route.ts' tests/unit/api-room-snapshot-route.test.ts tests/unit/roomSnapshotPayload.test.ts
git commit -m "fix: shape live room data by audience"
```

---

### Task 3: Remove raw device identity from browser JavaScript

**Files:** Modify session init, device hook, browser Supabase client, player join page, and answer tests; create `tests/unit/device-session.test.tsx`.

**Step 1: Write the hook regression**

Seed `localStorage.tr1via_device_id = "stolen-value"`, mock session init as `{ ready: true }`, and assert the key is deleted and the hook exposes only `{ isReady, isLoading }`.

**Step 2: Change the session contract**

The route still verifies/mints the HTTP-only cookie, but returns only `{ ready: true }`. The hook removes stale storage and returns:

```ts
export interface DeviceSession {
  isReady: boolean;
  isLoading: boolean;
}
```

**Step 3: Remove the mutable Supabase header**

Delete `fetchWithDeviceHeader`, its storage key, and the custom fetch from `lib/supabase/client.ts`. Authenticated hosts continue using their Supabase session.

**Step 4: Update join and answer checks**

Join gates on `isReady`. Answer tests assert `credentials: "same-origin"` and no body/header contains `deviceId`, `playerId`, or `x-tr1via-device`.

**Step 5: Verify and commit**

```bash
npx vitest run tests/unit/device-session.test.tsx tests/unit/answer-submit.test.tsx
git add -- app/api/session/init/route.ts lib/hooks/useDeviceSession.ts lib/supabase/client.ts 'app/(player)/join/page.tsx' tests/unit/device-session.test.tsx tests/unit/answer-submit.test.tsx
git commit -m "fix: keep player identity in signed cookie"
```

---

### Task 4: Make signed-cookie snapshots the normal player path

**Files:** Modify `lib/hooks/useRoom.ts`, all three player room pages, and the two host `useRoom` call sites.

**Step 1: Make audience explicit**

```ts
interface UseRoomArgs {
  roomCode: string | null;
  audience: "host" | "player";
  sessionReady?: boolean;
}
```

**Step 2: Preserve the host path**

Keep authenticated host direct reads and host-only Postgres Changes. Map rows into safe shared DTOs before storage.

**Step 3: Replace the player path**

For player audience, bootstrap and recover only through `fetchRoomSnapshotPayload`; subscribe only to allowlisted `room:${code}` broadcasts. Refetch on reveal, undo, resolve, game-ended, focus/online recovery, and the existing safety heartbeat. Never subscribe a player browser to raw `players`, `questions`, `answers`, `reveals`, or `game_participations` changes. Keep the last confirmed snapshot visible while fetching.

**Step 4: Remove fabricated identity and answers**

Player pages use `snapshot.self`, `snapshot.myAnswers`, `snapshot.myParticipations`, and `snapshot.scores`. Delete device-ID comparisons, direct answer/participation reads, player raw-answer score subscriptions, and recap/winner answer reads. A selected button may show pending, but cannot become an `AnswerRow`, affect scoring, or enter `PlayerLocked` before canonical confirmation.

**Step 5: Verify and commit**

```bash
npx vitest run tests/unit/api-room-snapshot-route.test.ts tests/unit/roomSnapshotPayload.test.ts tests/unit/player-between-games.test.tsx tests/unit/player-join-game2.test.tsx
npx tsc --noEmit
git add -- lib/hooks/useRoom.ts 'app/(player)/room/[code]/page.tsx' 'app/(player)/room/[code]/recap/page.tsx' 'app/(player)/room/[code]/won/page.tsx' 'app/host/live/[nightId]/HostLiveConsoleClient.tsx' 'app/host/phone/[nightId]/HostPhoneClient.tsx'
git commit -m "fix: route player state through signed session"
```

Expected type-check difference: only the two documented pre-existing `HostHomeClient-founder-build.test.tsx` fixture errors.

---

### Task 5: Revoke legacy browser authority in Postgres

**Files:** Create `supabase/migrations/0021_live_security_gate.sql`; finish `tests/integration/live-security-gate-schema.test.ts`.

**Step 1: Add the migration**

At minimum:

```sql
revoke all on table public.answers from anon;
revoke insert, update, delete on table public.players from anon;
revoke insert, update, delete on table public.game_participations from anon;
drop policy if exists answers_self_insert on public.answers;
drop policy if exists answers_self_select on public.answers;
revoke all on function public.resolve_question(uuid) from public, anon, authenticated;
grant execute on function public.resolve_question(uuid) to service_role;
```

Repeat explicit execute revocation/grant for `resolve_question_if_all_locked(uuid)`, `reset_night_to_setup(uuid)`, and `swap_point_value(uuid, integer)`. Recreate or alter every live SECURITY DEFINER function to use `set search_path = pg_catalog, public` and fully qualified relations, at minimum `current_player_id`, `is_night_host`, `resolve_question`, `resolve_question_if_all_locked`, `reset_night_to_setup`, and `swap_point_value`. Preserve behavior exactly.

**Step 2: Verify and commit**

```bash
npx vitest run tests/integration/live-security-gate-schema.test.ts tests/integration/questions-correct-index-rls.test.ts
git add supabase/migrations/0021_live_security_gate.sql tests/integration/live-security-gate-schema.test.ts
git commit -m "fix: revoke legacy browser answer authority"
```

---

### Task 6: Verify the gate as one atomic slice

**Step 1: Focused verification**

```bash
npx vitest run tests/integration/live-security-gate-schema.test.ts tests/integration/questions-correct-index-rls.test.ts tests/unit/api-room-snapshot-route.test.ts tests/unit/roomSnapshotPayload.test.ts tests/unit/tv-snapshot-route-answer-gating.test.ts tests/unit/device-session.test.tsx tests/unit/answer-submit.test.tsx
```

**Step 2: Repository verification**

```bash
npm test
npx tsc --noEmit
npm run build
git diff --check
```

**Step 3: Mandatory review**

Run the security reviewer and static critic on the complete diff. Require explicit proof that no player response/storage contains `device_id`, no anonymous role can read or mutate answers, no player raw-table Realtime subscription remains, host/TV projections remain safe, and raw database errors do not cross public boundaries.

**Step 4: Stop condition**

If any host workflow depends on revoked anonymous grants, repair the signed route boundary. Never re-grant browser authority as a shortcut. Do not push, open a PR, merge, migrate production, or enable Heather without the founder's explicit release gate.
