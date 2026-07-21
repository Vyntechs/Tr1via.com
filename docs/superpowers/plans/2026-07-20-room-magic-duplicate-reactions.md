# Room Magic Duplicate Reactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repeated Room Magic reaction requests a successful no-op without ever attempting a duplicate insert.

**Architecture:** Keep the database's existing unique `(question_id, player_id, moment)` invariant. Replace the route's plain insert with a conflict-targeted `upsert(..., { ignoreDuplicates: true })`; a returned row is the winning reaction and no returned row is an already-sent no-op. Only the winning request broadcasts.

**Tech Stack:** Next.js route handler, Supabase JavaScript client, Vitest.

## Global Constraints

- Do not alter production data or the `room_magic_reactions` schema.
- Preserve one reaction per player per reveal moment.
- A duplicate must return `200 { accepted: false, reason: "already_sent" }` and must not broadcast.

---

### Task 1: Route-level idempotent write regression

**Files:**
- Modify: `tests/unit/api-room-magic-reactions.test.ts`
- Modify: `app/api/room-magic/reactions/route.ts`

**Interfaces:**
- Consumes: `POST /api/room-magic/reactions` and the `room_magic_reactions` unique key.
- Produces: a 200 no-op response for duplicate requests, with no database constraint error and no extra broadcast.

- [x] **Step 1: Write the failing test**

Extend the fake `room_magic_reactions` builder with `upsert`, then assert that a no-row result returns the duplicate no-op response and that the write uses the unique conflict target:

```ts
expect(admin.upsertReaction).toHaveBeenCalledWith(
  expect.objectContaining({ question_id: QUESTION_ID, player_id: PLAYER_ID }),
  { onConflict: "question_id,player_id,moment", ignoreDuplicates: true },
);
expect(await res.json()).toEqual({ accepted: false, reason: "already_sent" });
expect(broadcastMock.broadcastRoomMagicReaction).not.toHaveBeenCalled();
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/api-room-magic-reactions.test.ts`

Expected: the new assertion fails because the route calls `insert`, which still lets PostgreSQL raise `23505`.

- [x] **Step 3: Write minimal implementation**

Replace the reaction write with:

```ts
const { data: insertedReaction, error: insertError } = await admin
  .from("room_magic_reactions")
  .upsert(row, { onConflict: "question_id,player_id,moment", ignoreDuplicates: true })
  .select("id, created_at")
  .maybeSingle();

if (!insertedReaction) return ok({ accepted: false, reason: "already_sent" as const });
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/api-room-magic-reactions.test.ts`

Expected: all route tests pass.

- [x] **Step 5: Verify the complete change**

Run: `npm test -- tests/unit/api-room-magic-reactions.test.ts tests/integration/room-magic-schema.test.ts && npx tsc --noEmit && npm run build`

Expected: targeted route and schema tests, type-check (except documented baseline if unchanged), and production build pass.
