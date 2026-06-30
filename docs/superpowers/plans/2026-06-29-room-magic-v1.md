# Room Magic v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional Room Magic to Heather's Classic: player phones can send one bounded post-reveal reaction, and the TV/host-mirrored TV turns those signals into short-lived shared atmosphere without changing gameplay.

**Architecture:** Add a night-level default-off setting and a server-only reaction receipt table for rate limiting. Player reactions go through one API route, validate the joined player and resolved question, insert one receipt per player/question, and broadcast a cosmetic `room-magic-reaction` event on the existing `room:{code}` channel. Clients render the event on a separate cosmetic state field, never through `lastBroadcast`, so no score, answer, timer, or snapshot refetch path depends on Room Magic.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Supabase Postgres/RLS/admin client, Supabase Realtime REST broadcast, Vitest, Testing Library, Playwright.

## Global Constraints

- Heather's Classic remains unchanged by default.
- Room Magic is off for every existing night and host until explicitly enabled for a night.
- No change to answer submission, scoring, reveal, resolve, lock-in timing, leaderboard, host phone, or host live controls.
- No sound, no audio APIs, no speaker/music copy, and no audible feedback.
- No free text, no chat, no moderation queue, no badges, no profiles, no reaction scoring, and no player-visible reaction history.
- No destructive database change: no drops, renames, or production data rewrite.
- Database changes are additive and safe to leave in place if the app PR is reverted.
- Cosmetic broadcasts never trigger `fetchSnapshot`, `refreshLiveState`, player answer refetches, or TV safety recovery logic.
- If Room Magic setting is missing, unreadable, or false, Room Magic is off.
- If reaction submit or broadcast fails, the live game continues.
- Keep between-games cheer local for v1. It can reuse this system in v1.1 after reveal reactions are proven.
- Implementation should run on `staging/room-magic-v1` because this touches player phone, TV, realtime, API, and a database change file.
- Do not deploy or apply production database changes during development. Preview and production release are separate founder-approved steps.

---

## File Structure

**Create:**
- `supabase/migrations/0017_room_magic_v1.sql`
- `lib/room-magic/reactions.ts`
- `app/api/room-magic/reactions/route.ts`
- `app/api/nights/[id]/room-magic/route.ts`
- `components/player/RoomMagicReactionControls.tsx`
- `components/tv/TVRoomMagicOverlay.tsx`
- Tests under `tests/unit`, `tests/component`, `tests/integration`, and `tests/e2e`.

**Modify:**
- `lib/supabase/types.ts`
- `lib/api/broadcast.ts`
- `lib/hooks/useRoom.ts`
- `lib/hooks/useTVRoom.ts`
- `lib/room/roomSnapshotPayload.ts`
- `app/api/room/[code]/snapshot/route.ts`
- `app/api/tv/[code]/snapshot/route.ts`
- `app/(player)/room/[code]/page.tsx`
- `components/player/PlayerLocked.tsx`
- `components/player/PlayerRevealCorrect.tsx`
- `components/player/PlayerRevealWrong.tsx`
- `components/player/index.ts`
- `app/tv/[code]/page.tsx`
- `components/host/HostLiveConsole.tsx`
- `app/host/live/[nightId]/HostLiveConsoleClient.tsx`
- `app/host/setup/[nightId]/page.tsx`
- `app/host/setup/[nightId]/HostSetupOverviewClient.tsx`

**Read-only references:**
- `docs/superpowers/specs/2026-06-29-room-magic-v1-design.md`
- `lib/api/broadcast.ts` fireworks event pattern
- `app/api/nights/[id]/theme/route.ts` ownership and live-game conflict pattern
- `tests/integration/question-generation-reports-schema.test.ts` pglite schema-test pattern

---

## Task 1: Database Setting And Server-Side Reaction Receipts

**Files:**
- Create: `supabase/migrations/0017_room_magic_v1.sql`
- Modify: `lib/supabase/types.ts`
- Test: `tests/integration/room-magic-schema.test.ts`

**Interfaces:**
- Produces: `nights.room_magic_enabled boolean not null default false`
- Produces: `room_magic_reactions`
- Enforces: one reaction per `question_id`, `player_id`, `moment`
- Exposes: no direct anon/authenticated table access to reaction receipts

- [ ] **Step 1: Write the failing schema test**

Create `tests/integration/room-magic-schema.test.ts` using the pglite setup from `tests/integration/question-generation-reports-schema.test.ts`.

Assertions:

```ts
expect(nightsColumn.rows[0]?.column_default).toContain("false");
expect(nightsColumn.rows[0]?.is_nullable).toBe("NO");
expect(reactionTable.rows[0]?.relrowsecurity).toBe(true);
expect(grantsByRole.get("anon") ?? []).toEqual([]);
expect(grantsByRole.get("authenticated") ?? []).toEqual([]);
expect(grantsByRole.get("service_role")).toContain("INSERT");
```

Also seed a host, night, game, category, question, and player, then insert two `room_magic_reactions` rows with the same `(question_id, player_id, moment)`. The second insert must reject with a unique-constraint error.

- [ ] **Step 2: Run the schema test and verify it fails**

Run:

```bash
npx vitest run tests/integration/room-magic-schema.test.ts
```

Expected: FAIL because `0017_room_magic_v1.sql` and the table/column do not exist.

- [ ] **Step 3: Add the database change file**

Create `supabase/migrations/0017_room_magic_v1.sql`:

```sql
alter table public.nights
  add column if not exists room_magic_enabled boolean not null default false;

create table if not exists public.room_magic_reactions (
  id uuid primary key default gen_random_uuid(),
  night_id uuid not null references public.nights(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  kind text not null check (kind in ('applause', 'nice_one', 'wow', 'brutal')),
  moment text not null default 'reveal' check (moment = 'reveal'),
  created_at timestamptz not null default now(),
  unique (question_id, player_id, moment)
);

create index if not exists room_magic_reactions_night_created_idx
  on public.room_magic_reactions (night_id, created_at desc);

create index if not exists room_magic_reactions_question_kind_idx
  on public.room_magic_reactions (question_id, kind);

create index if not exists room_magic_reactions_player_created_idx
  on public.room_magic_reactions (player_id, created_at desc);

alter table public.room_magic_reactions enable row level security;

revoke all on public.room_magic_reactions from anon;
revoke all on public.room_magic_reactions from authenticated;
grant all on public.room_magic_reactions to service_role;
```

- [ ] **Step 4: Generate Supabase types**

Run:

```bash
npm run typegen
```

Expected: `lib/supabase/types.ts` includes `nights.room_magic_enabled` and `room_magic_reactions`.

If the local Supabase CLI or database is unavailable, stop this task and report that type generation is blocked. Do not hand-edit the generated file.

- [ ] **Step 5: Run the schema test and verify it passes**

Run:

```bash
npx vitest run tests/integration/room-magic-schema.test.ts
```

Expected: PASS.

---

## Task 2: Domain Primitives And Broadcast Contract

**Files:**
- Create: `lib/room-magic/reactions.ts`
- Modify: `lib/api/broadcast.ts`
- Test: `tests/unit/room-magic-reactions.test.ts`
- Test: `tests/unit/broadcast-room-magic.test.ts`

**Interfaces:**
- Produces: `ROOM_MAGIC_REACTION_KINDS`
- Produces: `RoomMagicReactionKind`
- Produces: `isRoomMagicReactionKind(value)`
- Produces: `RoomMagicReactionEvent`
- Produces: `broadcastRoomMagicReaction(roomCode, payload)`

- [ ] **Step 1: Write the failing domain tests**

Create `tests/unit/room-magic-reactions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ROOM_MAGIC_REACTION_KINDS,
  ROOM_MAGIC_REACTION_LABELS,
  isRoomMagicReactionKind,
} from "@/lib/room-magic/reactions";

describe("room magic reactions", () => {
  it("supports the four approved bounded reactions", () => {
    expect(ROOM_MAGIC_REACTION_KINDS).toEqual([
      "applause",
      "nice_one",
      "wow",
      "brutal",
    ]);
    expect(ROOM_MAGIC_REACTION_LABELS.brutal).toBe("Brutal");
  });

  it("rejects unknown values", () => {
    expect(isRoomMagicReactionKind("wow")).toBe(true);
    expect(isRoomMagicReactionKind("chat")).toBe(false);
    expect(isRoomMagicReactionKind(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement the domain helper**

Create `lib/room-magic/reactions.ts`:

```ts
export const ROOM_MAGIC_REACTION_KINDS = [
  "applause",
  "nice_one",
  "wow",
  "brutal",
] as const;

export type RoomMagicReactionKind = (typeof ROOM_MAGIC_REACTION_KINDS)[number];

export const ROOM_MAGIC_REACTION_LABELS: Record<RoomMagicReactionKind, string> = {
  applause: "Applause",
  nice_one: "Nice one",
  wow: "Wow",
  brutal: "Brutal",
};

export interface RoomMagicReactionEvent {
  kind: RoomMagicReactionKind;
  questionId: string;
  playerId: string;
  serverNow: string;
}

export function isRoomMagicReactionKind(
  value: unknown,
): value is RoomMagicReactionKind {
  return (
    typeof value === "string" &&
    ROOM_MAGIC_REACTION_KINDS.includes(value as RoomMagicReactionKind)
  );
}
```

- [ ] **Step 3: Extend the broadcast contract**

Modify `lib/api/broadcast.ts`:

```ts
import type {
  RoomMagicReactionEvent,
  RoomMagicReactionKind,
} from "@/lib/room-magic/reactions";
```

Add `"room-magic-reaction"` to `RoomEventName`.

Add:

```ts
export interface RoomMagicReactionPayload extends BroadcastPayload {
  questionId: string;
  playerId: string;
  kind: RoomMagicReactionKind;
}

export async function broadcastRoomMagicReaction(
  roomCode: string,
  event: RoomMagicReactionEvent,
): Promise<void> {
  await postBroadcasts([
    {
      topic: `room:${roomCode}`,
      event: "room-magic-reaction",
      payload: event,
    },
  ]);
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx vitest run tests/unit/room-magic-reactions.test.ts tests/unit/broadcast-room-magic.test.ts
```

Expected: PASS.

---

## Task 3: Player Reaction API

**Files:**
- Create: `app/api/room-magic/reactions/route.ts`
- Test: `tests/unit/api-room-magic-reactions.test.ts`

**Interfaces:**
- Consumes: `POST /api/room-magic/reactions`
- Body: `{ questionId: string, kind: RoomMagicReactionKind }`
- Produces: `{ accepted: true, broadcasted: boolean }`
- Duplicate response: `{ accepted: false, reason: "already_sent" }`

- [ ] **Step 1: Write failing API tests**

Cover these cases:

- `400` for invalid body or unknown reaction kind.
- `403` when Room Magic is disabled for the night.
- `403` when device cookie has no joined player in the question's night.
- `409` when the question is not resolved.
- `200 { accepted: true, broadcasted: true }` for a valid first reaction.
- `200 { accepted: false, reason: "already_sent" }` for duplicate unique constraint `23505`.
- `200 { accepted: true, broadcasted: false }` when insert succeeds and broadcast throws.

- [ ] **Step 2: Implement the route**

Route behavior:

1. Parse JSON with zod.
2. Validate `kind` using `isRoomMagicReactionKind`.
3. Read the player device id with the same helper used by `app/api/answers/route.ts`.
4. Use `getSupabaseAdmin()`.
5. Load the question with category, game, and night relation data.
6. Require `question.played_at` and `question.finished_at`.
7. Require `night.room_magic_enabled === true`.
8. Find the joined player for `night_id` and device id with `removed_at is null`.
9. Verify the player's participation row exists for the game.
10. Insert into `room_magic_reactions`.
11. Treat Postgres `23505` as an accepted no-op duplicate.
12. Broadcast `room-magic-reaction` with `kind`, `questionId`, `playerId`, and `serverNow`.
13. Swallow broadcast failure and return `broadcasted: false`.

Do not expose device id, host id, or answer choices in the response.

- [ ] **Step 3: Run focused API tests**

Run:

```bash
npx vitest run tests/unit/api-room-magic-reactions.test.ts
```

Expected: PASS.

---

## Task 4: Snapshot And Hook Plumbing

**Files:**
- Modify: `lib/room/roomSnapshotPayload.ts`
- Modify: `app/api/room/[code]/snapshot/route.ts`
- Modify: `app/api/tv/[code]/snapshot/route.ts`
- Modify: `lib/hooks/useRoom.ts`
- Modify: `lib/hooks/useTVRoom.ts`
- Test: `tests/unit/roomSnapshotPayload.test.ts`
- Test: `tests/unit/tv-snapshot-room-magic.test.ts`
- Test: `tests/unit/room-magic-hook-broadcast.test.tsx`

**Interfaces:**
- Player/host `RoomSnapshot` gains `lastRoomMagicReaction: RoomMagicReactionEvent | null`.
- TV `TVNight` gains `roomMagicEnabled: boolean`.
- TV `TVRoomState` gains `lastRoomMagicReaction: RoomMagicReactionEvent | null`.
- Cosmetic event handling does not mutate `lastBroadcast`.

- [ ] **Step 1: Add room magic to durable snapshot payloads**

In the room snapshot route, ensure the `night` row includes `room_magic_enabled` through the generated `NightRow`.

In the TV snapshot route, add `roomMagicEnabled: Boolean(night.room_magic_enabled)` to `TVNight`.

In `lib/hooks/useTVRoom.ts`, add:

```ts
roomMagicEnabled: boolean;
```

to `TVNight`.

- [ ] **Step 2: Add separate cosmetic event state to `useRoom`**

In `lib/hooks/useRoom.ts`:

- Import `RoomMagicReactionEvent` and `isRoomMagicReactionKind`.
- Add `lastRoomMagicReaction: RoomMagicReactionEvent | null` to `RoomSnapshot`.
- Add `lastRoomMagicReaction: null` to `EMPTY`.
- In `payloadToRoomSnapshot`, set `lastRoomMagicReaction: null`.
- Add a `.on("broadcast", { event: "room-magic-reaction" }, handler)` branch.
- Handler validates `questionId`, `playerId`, `serverNow`, and `kind`.
- Handler calls `setSnapshot((prev) => ({ ...prev, lastRoomMagicReaction: event }))`.
- Handler updates channel freshness if needed, but does not call `refreshLiveState`, does not mutate `lastBroadcast`, and does not fetch.

- [ ] **Step 3: Add separate cosmetic event state to `useTVRoom`**

In `lib/hooks/useTVRoom.ts`:

- Add `lastRoomMagicReaction` state.
- Add `.on("broadcast", { event: "room-magic-reaction" }, handler)`.
- Handler validates the payload.
- Handler sets `lastRoomMagicReaction`.
- Handler does not call `fetchSnapshot`.
- Return `lastRoomMagicReaction`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx vitest run tests/unit/roomSnapshotPayload.test.ts tests/unit/tv-snapshot-room-magic.test.ts tests/unit/room-magic-hook-broadcast.test.tsx
```

Expected: PASS.

---

## Task 5: Player Phone UI

**Files:**
- Create: `components/player/RoomMagicReactionControls.tsx`
- Modify: `components/player/PlayerLocked.tsx`
- Modify: `components/player/PlayerRevealCorrect.tsx`
- Modify: `components/player/PlayerRevealWrong.tsx`
- Modify: `components/player/index.ts`
- Modify: `app/(player)/room/[code]/page.tsx`
- Test: `tests/component/RoomMagicReactionControls.test.tsx`
- Test: `tests/component/PlayerRevealRoomMagic.test.tsx`
- Test: `tests/unit/player-locked-live-count.test.tsx`

**Interfaces:**
- Produces: reveal-only reaction controls.
- Produces: one local tap per reveal.
- Produces: "Sent to the room" feedback on lock-in when enabled.

- [ ] **Step 1: Write failing component tests**

Assertions:

- Controls render four approved labels.
- Controls post to `/api/room-magic/reactions` with `questionId` and `kind`.
- After a successful tap, buttons are disabled and confirmation appears.
- A failed post does not throw and does not show alarming copy.
- Controls are absent when `roomMagicEnabled` is false.
- Controls are absent before `finished_at`.
- `PlayerLocked` can render the existing live-count behavior plus the short "Sent to the room" line when enabled.

- [ ] **Step 2: Implement `RoomMagicReactionControls`**

Component rules:

- Props: `questionId: string`, `enabled: boolean`, `className?: string`.
- Return `null` when disabled.
- Render labels from `ROOM_MAGIC_REACTION_LABELS`.
- Use normal buttons, no sound, no free text input.
- Keep stable dimensions so the reveal screen does not jump after tap.
- On first tap, optimistically mark the reaction as sent.
- Send `fetch("/api/room-magic/reactions", { method: "POST", headers, body })`.
- On duplicate response, keep the sent state.
- On failed response/network error, settle quietly with non-alarming copy such as `Not sent`.
- Respect `usePrefersReducedMotion` by avoiding decorative motion classes when reduced.

- [ ] **Step 3: Mount controls only on reveal screens**

In `app/(player)/room/[code]/page.tsx`, compute:

```ts
const roomMagicEnabled = Boolean(snapshot.night?.room_magic_enabled);
const canReact = roomMagicEnabled && Boolean(question.finished_at);
```

Pass `roomMagicControls` into `PlayerRevealCorrect` and `PlayerRevealWrong` only when `canReact`.

Do not mount controls during lobby, answering, lock-in before resolve, between-games, recap, or winner screens.

- [ ] **Step 4: Add lock-in feedback**

In `PlayerLocked`, add an optional `roomMagicEnabled?: boolean` prop. When true, show a short line below the locked answer state:

```tsx
Sent to the room.
```

Do not add controls while a question is active.

- [ ] **Step 5: Run focused component tests**

Run:

```bash
npx vitest run tests/component/RoomMagicReactionControls.test.tsx tests/component/PlayerRevealRoomMagic.test.tsx tests/unit/player-locked-live-count.test.tsx
```

Expected: PASS.

---

## Task 6: TV And Host-Mirrored Atmosphere Overlay

**Files:**
- Create: `components/tv/TVRoomMagicOverlay.tsx`
- Modify: `components/tv/index.ts`
- Modify: `app/tv/[code]/page.tsx`
- Modify: `components/host/HostLiveConsole.tsx`
- Modify: `app/host/live/[nightId]/HostLiveConsoleClient.tsx`
- Test: `tests/component/TVRoomMagicOverlay.test.tsx`
- Test: `tests/component/HostLiveRoomMagicOverlay.test.tsx`

**Interfaces:**
- Consumes: `enabled: boolean`
- Consumes: `event: RoomMagicReactionEvent | null`
- Produces: aggregate short-lived overlay on standalone TV and host HDMI mirror.

- [ ] **Step 1: Write failing overlay tests**

Assertions:

- Overlay renders nothing when disabled.
- Overlay renders nothing for `null` event.
- Overlay renders aggregate counts, not one row per tap.
- Overlay removes events after the short display window.
- Overlay does not use sound/audio language.
- Overlay root has `pointer-events: none`.

- [ ] **Step 2: Implement `TVRoomMagicOverlay`**

Component behavior:

- Keep recent reaction counts in local state for roughly 2600ms.
- Aggregate by reaction kind.
- Render compact clustered pills near an edge of the 16:9 stage.
- Avoid the central answer, fact blurb, fastest list, and scoreboard zones.
- Use `aria-hidden="true"` because the TV visual is decorative.
- Use CSS transitions only when reduced motion is false.
- Ignore malformed or stale events.

- [ ] **Step 3: Mount on standalone TV**

In `app/tv/[code]/page.tsx`, read `lastRoomMagicReaction` from `useTVRoom(code)` and render inside `TVStageFrame`:

```tsx
<TVRoomMagicOverlay
  enabled={snapshot.night.roomMagicEnabled}
  event={lastRoomMagicReaction}
/>
```

Place it beside `SectionCompleteOverlay` and `PyrotechnicsBeatConductor`, not inside `TVStateMachine`.

- [ ] **Step 4: Mount on host HDMI mirror**

In `app/host/live/[nightId]/HostLiveConsoleClient.tsx`, pass `room.lastRoomMagicReaction` and `Boolean(room.night?.room_magic_enabled)` into `HostLiveConsole`.

In `components/host/HostLiveConsole.tsx`, render `TVRoomMagicOverlay` in the embedded TV stage layer that already renders `TVStateMachine`.

Do not add a reaction queue, moderation view, or host controls to the live console.

- [ ] **Step 5: Run focused overlay tests**

Run:

```bash
npx vitest run tests/component/TVRoomMagicOverlay.test.tsx tests/component/HostLiveRoomMagicOverlay.test.tsx
```

Expected: PASS.

---

## Task 7: Host Setup Toggle

**Files:**
- Create: `app/api/nights/[id]/room-magic/route.ts`
- Modify: `app/host/setup/[nightId]/page.tsx`
- Modify: `app/host/setup/[nightId]/HostSetupOverviewClient.tsx`
- Test: `tests/unit/api-room-magic-toggle.test.ts`
- Test: `tests/component/HostSetupRoomMagicToggle.test.tsx`

**Interfaces:**
- Consumes: `PATCH /api/nights/:id/room-magic`
- Body: `{ enabled: boolean }`
- Produces: `{ roomMagicEnabled: boolean }`
- UI: night-level setup toggle, default off.

- [ ] **Step 1: Write failing API tests**

Cover:

- Unauthenticated host gets `401`.
- Non-owner host gets `403`.
- Invalid body gets `400`.
- Live game returns `409`.
- Valid owner updates `nights.room_magic_enabled`.

- [ ] **Step 2: Implement the toggle route**

Mirror `app/api/nights/[id]/theme/route.ts`:

- Use `requireOwnedNight(id)`.
- Parse with zod: `{ enabled: z.boolean() }`.
- Query `games` for a live game in the night.
- Return `409` when a live game exists.
- Update `nights.room_magic_enabled`.
- Return `{ roomMagicEnabled: data.room_magic_enabled }`.

- [ ] **Step 3: Add setup UI state**

In `app/host/setup/[nightId]/page.tsx`, pass:

```tsx
initialRoomMagicEnabled={Boolean(night.room_magic_enabled)}
```

to `HostSetupOverviewClient`.

In `HostSetupOverviewClient`:

- Add prop `initialRoomMagicEnabled: boolean`.
- Add state `roomMagicEnabled`.
- Add `savingRoomMagic`.
- Add `handleToggleRoomMagic(next: boolean)` that optimistically updates, PATCHes `/api/nights/${nightId}/room-magic`, and rolls back on failure.
- Disable the toggle when `liveGameExists`.
- Keep the UI compact near the existing fixed theme picker.
- Use short labels only: `Room Magic`, `On`, `Off`.
- Do not add explanatory marketing copy inside the app.

- [ ] **Step 4: Run focused setup tests**

Run:

```bash
npx vitest run tests/unit/api-room-magic-toggle.test.ts tests/component/HostSetupRoomMagicToggle.test.tsx
```

Expected: PASS.

---

## Task 8: End-To-End Safety And Regression Verification

**Files:**
- Test: `tests/e2e/room-magic.spec.ts`
- Possibly modify: `tests/e2e/helpers/host-laptop.ts`
- Possibly modify: `tests/e2e/helpers/player-phone.ts`
- Possibly modify: `app/api/_test/seed-night/route.ts` only if the seed helper needs a test-only `roomMagicEnabled` option.

**Interfaces:**
- Produces: one-host, one-TV, two-player proof of a post-reveal reaction.
- Proves: scoring and Classic flow remain unchanged.

- [ ] **Step 1: Write the E2E test**

Flow:

1. Seed a night with Room Magic disabled.
2. Open host, TV, and two player phones.
3. Start game and reveal/resolve first question.
4. Verify no reaction controls appear when disabled.
5. Enable Room Magic through the host setup API before the next live game moment, or seed a second night with `roomMagicEnabled: true`.
6. Player answers, host resolves, player taps `Wow`.
7. TV shows the aggregate room-magic overlay.
8. Player cannot send a second reaction for the same reveal.
9. Scores and leaderboard values match the same answer flow without Room Magic.

- [ ] **Step 2: Run focused E2E**

Run:

```bash
npm run test:e2e -- tests/e2e/room-magic.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run the existing live sync regression**

Run:

```bash
npm run test:e2e -- tests/e2e/reveal-sync.spec.ts
```

Expected: PASS.

---

## Task 9: Full Verification Gate

- [ ] **Step 1: Run unit/component/integration tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript**

Run:

```bash
npx tsc --noEmit
```

Expected: either PASS or only the known pre-existing `HostHomeClient-founder-build.test.tsx` baseline errors documented in `AGENTS.md`. Any new Room Magic error must be fixed.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Manual preview checks**

On a local or preview environment:

- Room Magic disabled: Classic looks and plays like it did before.
- Room Magic enabled: reveal controls appear only after resolve.
- Reaction tap creates phone confirmation and TV atmosphere.
- Refreshing TV after a reaction does not restore old reaction bursts.
- Network/broadcast failure does not block reveal, score, or next question.
- Reduced-motion mode still shows calm state changes.

---

## Branch And Release Strategy

- Create implementation branch: `staging/room-magic-v1`.
- Keep this docs branch separate or merge the plan first if desired.
- Implement in small commits following the tasks above.
- Open PR into staging for Room Magic implementation.
- Open final PR from staging to main only after the full verification gate passes.
- Production database change file `0017_room_magic_v1.sql` must be reviewed before applying.
- Production release requires a separate founder-approved database apply and deploy step.
- Do not deploy during a live Wednesday show.

## Rollback

- Immediate behavior rollback: set `nights.room_magic_enabled = false` for affected nights.
- App rollback: revert the Room Magic app PR.
- Database rollback is not required for app safety because the migration is additive and default off.
- The `room_magic_reactions` table can remain unused after app rollback without affecting Classic.

## Blast Radius

- Database: one default-off boolean on `nights`, one service-role-only receipt table.
- Server API: two new routes, one player reaction route and one host toggle route.
- Realtime: one new cosmetic event on the existing `room:{code}` channel.
- Player UI: reveal screens and optional lock-in line only.
- TV UI: decorative overlay only.
- Host UI: setup toggle and host-mirrored TV overlay only.
- Not touched: scoring, answer validation, game state machine, existing reveal transport, billing, AI generation, Pexels, Stripe, auth model, production data.

## Completion Criteria

- All planned tests pass or any pre-existing failures are explicitly identified.
- Room Magic off is proven to preserve Classic.
- Room Magic enabled is proven to work across phone, TV, and host mirror.
- Duplicate/spam reactions are blocked server-side.
- No Room Magic failure can block gameplay.
- No production database or deployment action is taken during implementation without explicit approval.
