# Reset Game to Setup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Reset and edit game" escape hatch to the host dashboard that rolls a stuck/test night back to the setup screen — preserving categories, picked questions, and the people in the room while wiping the playthrough exhaust (reveals, answers, played markers).

**Architecture:** A new Postgres RPC `reset_night_to_setup(p_night_id uuid)` does the atomic wipe (one transaction across `reveals`, `answers`, `questions`, `games`, `nights`). A thin Next.js route handler `POST /api/nights/[id]/reset-to-setup` enforces ownership via `requireOwnedNight` and calls the RPC. The dashboard server page computes a "what would be wiped" preview and passes it to a new `ResetGameConfirmModal` shown when the host clicks a tertiary "Reset and edit game" button — only visible when `nights.opened_at IS NOT NULL`.

**Tech Stack:** Next.js 16 App Router + Server Components, Supabase (Postgres + Auth + Realtime), TypeScript, Vitest + `@testing-library/react`, plpgsql.

**Spec:** `docs/superpowers/specs/2026-05-25-reset-game-to-setup.md`

**Merge authority (this instance only):** Brandon authorized merge-to-main after full validation with zero gaps. Task 8 enforces the gate.

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/0008_reset_night_to_setup.sql` | new | plpgsql RPC, `SECURITY DEFINER`, returns counts as jsonb |
| `app/api/nights/[id]/reset-to-setup/route.ts` | new | POST handler, ownership check, RPC call, JSON response |
| `lib/api/resetNightCounts.ts` | new | Pure server helper — computes preview counts for one night |
| `components/host/ResetGameConfirmModal.tsx` | new | Pure-props modal — counts in/out, confirm/cancel callbacks |
| `components/host/HostDashboard.tsx` | modify | Tertiary button + `onResetGame` prop + `resetPreview` on tonight type |
| `app/host/HostHomeClient.tsx` | modify | `resetNight()` handler, modal mount, success toast |
| `app/host/page.tsx` | modify | Compute `resetPreview` server-side when `opened_at IS NOT NULL`; pass through |
| `components/host/index.ts` | modify | Export `ResetGameConfirmModal` |
| `tests/unit/api-reset-night.test.ts` | new | Endpoint behavior (auth, RPC call, error paths) |
| `tests/component/ResetGameConfirmModal.test.tsx` | new | Modal render, counts, confirm/cancel, disabled-during-submit |

---

## Task 1: Postgres RPC migration

**Files:**
- Create: `supabase/migrations/0008_reset_night_to_setup.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/0008_reset_night_to_setup.sql`:

```sql
-- 0008_reset_night_to_setup.sql
--
-- Adds the RPC backing the "Reset and edit game" dashboard button. Rolls
-- a night back to the setup screen for the host: preserves categories,
-- picked questions, and players; wipes reveals, answers, finished_at +
-- played_at on questions; flips affected games from live/done back to
-- ready; clears nights.opened_at.
--
-- Atomic by virtue of being a single function call — partial failure
-- (e.g. answers deleted but games.state not updated) would leave the
-- game in an unrepresentable state, hence one transaction.
--
-- SECURITY DEFINER because the route handler that calls this has already
-- enforced host ownership via requireOwnedNight. RLS is not the gate
-- here; the route handler is.

set search_path = public, extensions;

create or replace function public.reset_night_to_setup(p_night_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reveals_count int := 0;
  v_answers_count int := 0;
  v_finished_count int := 0;
  v_categories_kept int := 0;
  v_picked_kept int := 0;
  v_players_kept int := 0;
begin
  -- Pre-count what's about to be wiped (live/done games only).
  select count(*) into v_reveals_count
  from reveals r
  join games g on g.id = r.game_id
  where g.night_id = p_night_id
    and g.state in ('live', 'done');

  select count(*) into v_answers_count
  from answers a
  join questions q on q.id = a.question_id
  join categories c on c.id = q.category_id
  join games g on g.id = c.game_id
  where g.night_id = p_night_id
    and g.state in ('live', 'done');

  select count(*) into v_finished_count
  from questions q
  join categories c on c.id = q.category_id
  join games g on g.id = c.game_id
  where g.night_id = p_night_id
    and g.state in ('live', 'done')
    and q.finished_at is not null;

  -- Count what's preserved (across all games regardless of state).
  select count(*) into v_categories_kept
  from categories c
  join games g on g.id = c.game_id
  where g.night_id = p_night_id;

  select count(*) into v_picked_kept
  from questions q
  join categories c on c.id = q.category_id
  join games g on g.id = c.game_id
  where g.night_id = p_night_id
    and q.is_picked = true;

  select count(*) into v_players_kept
  from players p
  where p.night_id = p_night_id
    and p.removed_at is null;

  -- The wipes — scoped to games in live/done. Draft/ready games untouched.
  delete from reveals r
  using games g
  where r.game_id = g.id
    and g.night_id = p_night_id
    and g.state in ('live', 'done');

  delete from answers a
  using questions q, categories c, games g
  where a.question_id = q.id
    and q.category_id = c.id
    and c.game_id = g.id
    and g.night_id = p_night_id
    and g.state in ('live', 'done');

  update questions q
  set finished_at = null, played_at = null
  from categories c, games g
  where q.category_id = c.id
    and c.game_id = g.id
    and g.night_id = p_night_id
    and g.state in ('live', 'done');

  update games
  set state = 'ready', started_at = null, ended_at = null
  where night_id = p_night_id
    and state in ('live', 'done');

  update nights
  set opened_at = null
  where id = p_night_id;

  return jsonb_build_object(
    'wiped', jsonb_build_object(
      'reveals', v_reveals_count,
      'answers', v_answers_count,
      'finishedQuestions', v_finished_count
    ),
    'kept', jsonb_build_object(
      'categories', v_categories_kept,
      'pickedQuestions', v_picked_kept,
      'players', v_players_kept
    )
  );
end;
$$;

-- Restrict execution to the service role (admin client). The route
-- handler runs server-side as the service role; client-side calls would
-- fail this grant.
revoke all on function public.reset_night_to_setup(uuid) from public;
revoke all on function public.reset_night_to_setup(uuid) from authenticated, anon;
grant execute on function public.reset_night_to_setup(uuid) to service_role;
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Apply via the Supabase MCP `apply_migration` tool against project `citweuctcnuxmqjxcbiz` with `name: "reset_night_to_setup"` and the SQL body above (minus the leading comment block — `apply_migration` adds its own header).

Expected: success; migration listed in `supabase/migrations` table; function visible in `pg_proc`.

- [ ] **Step 3: Sanity-check the function exists and is callable**

Via Supabase MCP `execute_sql`:

```sql
select proname, prosecdef, proacl
from pg_proc
where proname = 'reset_night_to_setup';
```

Expected: one row, `prosecdef = true`, `proacl` shows execute granted to `service_role` only.

- [ ] **Step 4: Dry-run the function against the known stuck test night**

```sql
-- DO NOT COMMIT THE EFFECT YET. Open a transaction so we can rollback.
begin;
select public.reset_night_to_setup('00000000-0000-0000-0000-000000000000'::uuid);
-- Verify state changes
select id, state, started_at, ended_at from games where night_id = '00000000-0000-0000-0000-000000000000';
select opened_at from nights where id = '00000000-0000-0000-0000-000000000000';
select count(*) from reveals where game_id in (select id from games where night_id = '00000000-0000-0000-0000-000000000000');
select count(*) from answers a join questions q on q.id = a.question_id join categories c on c.id = q.category_id join games g on g.id = c.game_id where g.night_id = '00000000-0000-0000-0000-000000000000';
rollback;
```

Expected return from RPC: jsonb with `wiped.reveals = 18`, `wiped.answers = 25`, `wiped.finishedQuestions = 9`, `kept.categories = 7` (6 from Game 1 + 1 from Game 2 draft), `kept.pickedQuestions = 42`, `kept.players = 4`.
Expected post-RPC state inside the transaction: Game 1 `state='ready'`, Game 2 `state='draft'` (unchanged), `opened_at` NULL, reveals + answers counts 0.
**Critical:** ROLLBACK so prod state is unchanged. We need the test night intact for Task 8 validation.

After the rollback, re-verify the test night is still in its original state:

```sql
select id, state from games where night_id = '00000000-0000-0000-0000-000000000000' order by game_no;
select opened_at from nights where id = '00000000-0000-0000-0000-000000000000';
```

Expected: Game 1 `state='live'`, Game 2 `state='draft'`, `opened_at` is still the original `2026-05-26 00:31` timestamp. If any of these moved, the rollback didn't take — STOP and investigate before proceeding to Task 2 (Task 8's validation depends on this state).

- [ ] **Step 5: Commit the migration**

```bash
git add supabase/migrations/0008_reset_night_to_setup.sql
git commit -m "feat(db): add reset_night_to_setup RPC for game reset

Backs the 'Reset and edit game' dashboard escape hatch. SECURITY DEFINER
because the route handler enforces host ownership; only service_role can
execute. Per-game scoping: only live/done games are touched, so draft/
ready setup work is preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: API endpoint with TDD

**Files:**
- Create: `app/api/nights/[id]/reset-to-setup/route.ts`
- Create: `tests/unit/api-reset-night.test.ts`

- [ ] **Step 1: Write failing tests for the route handler**

Create `tests/unit/api-reset-night.test.ts`:

```typescript
// Route handler test — POST /api/nights/[id]/reset-to-setup.
//
// Mocks the admin client + auth helper at module boundaries. We pin the
// branches: unauth, forbidden, not-found, RPC success, RPC error.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
}));
const authMock = vi.hoisted(() => ({
  requireOwnedNight: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);

const NIGHT_ID = "11111111-1111-1111-1111-111111111111";

function makeRequest() {
  return new NextRequest(`http://test/api/nights/${NIGHT_ID}/reset-to-setup`, {
    method: "POST",
  });
}

function makeCtx() {
  return { params: Promise.resolve({ id: NIGHT_ID }) };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/nights/[id]/reset-to-setup", () => {
  it("returns 401 when unauthenticated", async () => {
    authMock.requireOwnedNight.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: "not signed in",
    });
    const { POST } = await import("@/app/api/nights/[id]/reset-to-setup/route");
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(401);
  });

  it("returns 403 when night is not owned by caller", async () => {
    authMock.requireOwnedNight.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: "not your night",
    });
    const { POST } = await import("@/app/api/nights/[id]/reset-to-setup/route");
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(403);
  });

  it("returns 404 when night does not exist", async () => {
    authMock.requireOwnedNight.mockResolvedValueOnce({
      ok: false,
      status: 404,
      error: "not found",
    });
    const { POST } = await import("@/app/api/nights/[id]/reset-to-setup/route");
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(404);
  });

  it("calls the RPC and returns its jsonb payload on success", async () => {
    authMock.requireOwnedNight.mockResolvedValueOnce({
      ok: true,
      night: { id: NIGHT_ID, opened_at: "2026-05-26T00:31:00Z" },
      host: { id: "h1", is_first_night_complete: true },
    });
    const rpcMock = vi.fn().mockResolvedValueOnce({
      data: {
        wiped: { reveals: 18, answers: 25, finishedQuestions: 9 },
        kept: { categories: 6, pickedQuestions: 21, players: 4 },
      },
      error: null,
    });
    adminMock.getSupabaseAdmin.mockReturnValueOnce({ rpc: rpcMock });

    const { POST } = await import("@/app/api/nights/[id]/reset-to-setup/route");
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(200);

    expect(rpcMock).toHaveBeenCalledWith("reset_night_to_setup", {
      p_night_id: NIGHT_ID,
    });

    const body = await res.json();
    expect(body).toEqual({
      wiped: { reveals: 18, answers: 25, finishedQuestions: 9 },
      kept: { categories: 6, pickedQuestions: 21, players: 4 },
    });
  });

  it("returns 500 when the RPC errors", async () => {
    authMock.requireOwnedNight.mockResolvedValueOnce({
      ok: true,
      night: { id: NIGHT_ID, opened_at: "2026-05-26T00:31:00Z" },
      host: { id: "h1", is_first_night_complete: true },
    });
    const rpcMock = vi.fn().mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    });
    adminMock.getSupabaseAdmin.mockReturnValueOnce({ rpc: rpcMock });

    const { POST } = await import("@/app/api/nights/[id]/reset-to-setup/route");
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run the failing tests to verify they error on missing route**

```bash
npx vitest run tests/unit/api-reset-night.test.ts
```

Expected: all 5 tests fail with "Cannot find module '@/app/api/nights/[id]/reset-to-setup/route'".

- [ ] **Step 3: Create the route handler**

Create `app/api/nights/[id]/reset-to-setup/route.ts`:

```typescript
// POST /api/nights/:id/reset-to-setup — host rolls a started/finished
// night back to the setup screen.
//
// Ownership enforced via requireOwnedNight (same pattern as /open,
// /close). The actual wipe is one Postgres RPC for atomicity — partial
// failure here would leave the game in an unrepresentable state.
// Idempotent: if no games are in live/done, the RPC returns zero counts
// and nothing changes.

import { forbidden, notFound, ok, serverError, unauthorized } from "@/lib/api/responses";
import { requireOwnedNight } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const owned = await requireOwnedNight(id);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("reset_night_to_setup", {
    p_night_id: id,
  });
  if (error) return serverError(error.message ?? "could not reset night");

  return ok(data ?? {});
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
npx vitest run tests/unit/api-reset-night.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean exit. If the RPC name isn't in the generated `Database` types yet, regenerate via Supabase MCP `generate_typescript_types` and update `lib/supabase/types.ts` accordingly; otherwise add a narrow ambient type in the route handler.

- [ ] **Step 6: Commit**

```bash
git add app/api/nights/[id]/reset-to-setup/route.ts tests/unit/api-reset-night.test.ts
git commit -m "feat(api): POST /api/nights/[id]/reset-to-setup

Thin route handler — ownership check then RPC call. Mirrors /open and
/close. Returns the RPC's jsonb counts payload verbatim so the client
can show 'wiped 25, kept 6' in the success toast.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Reset count server helper

**Files:**
- Create: `lib/api/resetNightCounts.ts`

- [ ] **Step 1: Create the helper**

Create `lib/api/resetNightCounts.ts`:

```typescript
// Server-side helper — given a night id, returns the "what would be
// wiped vs kept" preview used by ResetGameConfirmModal. Called from the
// dashboard server page only when nights.opened_at is set (otherwise
// the modal will never open and we skip the work).
//
// Scope mirrors the RPC: wipes count only what's in games in live/done;
// keeps count counts everything (categories + picked questions across
// all games, players in the room).

import { getSupabaseAdmin } from "@/lib/supabase/admin";

export interface ResetPreview {
  revealsToWipe: number;
  answersToWipe: number;
  finishedQuestionsToWipe: number;
  categoriesKept: number;
  pickedQuestionsKept: number;
  playersInRoom: number;
  /** First 2 category names — used by the modal body. */
  categoryNamesSample: string[];
}

export async function fetchResetPreview(nightId: string): Promise<ResetPreview> {
  const admin = getSupabaseAdmin();

  const { data: gameRows } = await admin
    .from("games")
    .select("id, state")
    .eq("night_id", nightId);
  const games = (gameRows ?? []) as Array<{ id: string; state: string }>;
  const liveOrDoneGameIds = games
    .filter((g) => g.state === "live" || g.state === "done")
    .map((g) => g.id);
  const allGameIds = games.map((g) => g.id);

  const { data: catRows } = allGameIds.length
    ? await admin
        .from("categories")
        .select("id, name, game_id, position")
        .in("game_id", allGameIds)
        .order("position")
    : { data: [] };
  const categories = (catRows ?? []) as Array<{
    id: string;
    name: string;
    game_id: string;
    position: number;
  }>;
  const liveOrDoneCategoryIds = categories
    .filter((c) => liveOrDoneGameIds.includes(c.game_id))
    .map((c) => c.id);

  const revealsToWipe = liveOrDoneGameIds.length
    ? (
        await admin
          .from("reveals")
          .select("id", { count: "exact", head: true })
          .in("game_id", liveOrDoneGameIds)
      ).count ?? 0
    : 0;

  const finishedQuestionsToWipe = liveOrDoneCategoryIds.length
    ? (
        await admin
          .from("questions")
          .select("id", { count: "exact", head: true })
          .in("category_id", liveOrDoneCategoryIds)
          .not("finished_at", "is", null)
      ).count ?? 0
    : 0;

  let answersToWipe = 0;
  if (liveOrDoneCategoryIds.length) {
    const { data: qRows } = await admin
      .from("questions")
      .select("id")
      .in("category_id", liveOrDoneCategoryIds);
    const qIds = (qRows ?? []).map((q) => (q as { id: string }).id);
    if (qIds.length) {
      const { count } = await admin
        .from("answers")
        .select("id", { count: "exact", head: true })
        .in("question_id", qIds);
      answersToWipe = count ?? 0;
    }
  }

  const allCategoryIds = categories.map((c) => c.id);
  const pickedQuestionsKept = allCategoryIds.length
    ? (
        await admin
          .from("questions")
          .select("id", { count: "exact", head: true })
          .in("category_id", allCategoryIds)
          .eq("is_picked", true)
      ).count ?? 0
    : 0;

  const playersInRoom =
    (
      await admin
        .from("players")
        .select("id", { count: "exact", head: true })
        .eq("night_id", nightId)
        .is("removed_at", null)
    ).count ?? 0;

  return {
    revealsToWipe,
    answersToWipe,
    finishedQuestionsToWipe,
    categoriesKept: categories.length,
    pickedQuestionsKept,
    playersInRoom,
    categoryNamesSample: categories.slice(0, 2).map((c) => c.name),
  };
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/api/resetNightCounts.ts
git commit -m "feat(host): server-side reset preview counts

Wraps the 'wipe vs keep' counts the modal needs into one query batch
called from the dashboard server page. Avoids a client round-trip when
the modal opens.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire counts into dashboard data fetch

**Files:**
- Modify: `app/host/page.tsx` (around lines 89–115 where `tonight` is built)
- Modify: `components/host/HostDashboard.tsx` (extend `HostDashboardTonight` interface)

- [ ] **Step 1: Add `resetPreview` to the `HostDashboardTonight` interface**

In `components/host/HostDashboard.tsx`, find the `HostDashboardTonight` interface (lines 28–43) and add an optional `resetPreview` field. Replace the interface with:

```typescript
export interface HostDashboardTonight {
  nightId: string;
  venue: string;
  date: string;
  dateLong?: string;
  roomCode: string;
  themeKey: ThemeKey;
  status: "setup" | "live" | "done";
  /** Counts surfaced into ResetGameConfirmModal. Populated server-side
   *  only when the night is in 'live' status; null otherwise. */
  resetPreview?: ResetPreview | null;
}
```

Add the import near the top of `HostDashboard.tsx`:

```typescript
import type { ResetPreview } from "@/lib/api/resetNightCounts";
```

- [ ] **Step 2: Compute the preview in `app/host/page.tsx`**

In `app/host/page.tsx`, add an import at the top:

```typescript
import { fetchResetPreview } from "@/lib/api/resetNightCounts";
```

Then, between line 87 (`const lifetime = await fetchLifetimeTotals(host.id);`) and the `const tonight = tonightRow ? ...` block (line 89), insert:

```typescript
  const resetPreview =
    tonightRow && tonightRow.opened_at
      ? await fetchResetPreview(tonightRow.id)
      : null;
```

Then, inside the `tonight = tonightRow ? { ... }` object (after the `status` field around line 113), add:

```typescript
        resetPreview,
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/host/page.tsx components/host/HostDashboard.tsx
git commit -m "feat(host): compute reset preview counts server-side

Dashboard page now fetches the wipe/keep counts for tonight when the
night is open. Passed through the tonight prop so the modal renders
with real numbers and no client round-trip.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: ResetGameConfirmModal component with TDD

**Files:**
- Create: `components/host/ResetGameConfirmModal.tsx`
- Create: `tests/component/ResetGameConfirmModal.test.tsx`
- Modify: `components/host/index.ts`

- [ ] **Step 1: Write failing component tests**

Create `tests/component/ResetGameConfirmModal.test.tsx`:

```tsx
// Component tests for ResetGameConfirmModal.
//
// Pure-props modal. We verify: render with counts; Cancel calls onCancel
// and not onConfirm; Confirm calls onConfirm; isSubmitting disables
// both buttons.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResetGameConfirmModal } from "@/components/host/ResetGameConfirmModal";

const PREVIEW = {
  revealsToWipe: 18,
  answersToWipe: 25,
  finishedQuestionsToWipe: 9,
  categoriesKept: 6,
  pickedQuestionsKept: 21,
  playersInRoom: 4,
  categoryNamesSample: ["Karate", "Skirts"],
};

function renderModal(overrides: Partial<React.ComponentProps<typeof ResetGameConfirmModal>> = {}) {
  const props = {
    open: true,
    venueName: "Soul Fire Pizza",
    preview: PREVIEW,
    isSubmitting: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<ResetGameConfirmModal {...props} />);
  return props;
}

describe("ResetGameConfirmModal", () => {
  it("does not render when closed", () => {
    render(
      <ResetGameConfirmModal
        open={false}
        venueName="Soul Fire Pizza"
        preview={PREVIEW}
        isSubmitting={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText(/are you sure/i)).toBeNull();
  });

  it("shows the venue name in the header", () => {
    renderModal();
    expect(screen.getByText(/Soul Fire Pizza/)).toBeInTheDocument();
  });

  it("shows the wipe counts plainly", () => {
    renderModal();
    expect(screen.getByText(/25 answers/i)).toBeInTheDocument();
    expect(screen.getByText(/18 reveal events/i)).toBeInTheDocument();
    expect(screen.getByText(/9 played-question markers/i)).toBeInTheDocument();
    expect(screen.getByText(/4 people in the room/i)).toBeInTheDocument();
  });

  it("shows the keep counts plainly", () => {
    renderModal();
    expect(screen.getByText(/6 categories/i)).toBeInTheDocument();
    expect(screen.getByText(/21 picked questions/i)).toBeInTheDocument();
    expect(screen.getByText(/Karate/)).toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked", () => {
    const props = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it("calls onConfirm when the red 'Yes, reset this game' is clicked", () => {
    const props = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /yes, reset this game/i }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("disables both buttons while isSubmitting", () => {
    renderModal({ isSubmitting: true });
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /resetting|yes, reset this game/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail on missing component**

```bash
npx vitest run tests/component/ResetGameConfirmModal.test.tsx
```

Expected: all 7 tests fail — `Cannot find module '@/components/host/ResetGameConfirmModal'`.

- [ ] **Step 3: Create the modal component**

Create `components/host/ResetGameConfirmModal.tsx`:

```tsx
// "Reset and edit game" confirmation popup. Pure props; HostHomeClient
// owns open/close state and the network call. Vivid plain-English copy
// is the safety mechanism — no typed-confirm pattern (Brandon rejected
// that as engineer-culture friction for non-technical hosts).

"use client";

import type { ResetPreview } from "@/lib/api/resetNightCounts";

export interface ResetGameConfirmModalProps {
  open: boolean;
  venueName: string;
  preview: ResetPreview;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ResetGameConfirmModal({
  open,
  venueName,
  preview,
  isSubmitting,
  onConfirm,
  onCancel,
}: ResetGameConfirmModalProps) {
  if (!open) return null;

  const categoriesLabel = formatCategories(preview);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reset game confirmation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(0,0,0,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          background: "var(--paper, #F7F2E5)",
          color: "var(--ink, #15140F)",
          maxWidth: 540,
          width: "100%",
          borderRadius: 14,
          padding: "28px 32px",
          fontFamily: "var(--font-sans)",
          boxShadow: "0 24px 64px -16px rgba(0,0,0,.6)",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.015em",
            lineHeight: 1.2,
          }}
        >
          Are you sure you want to reset {venueName}?
        </h2>

        <Section title="This will throw away — permanently:">
          <BulletLine>
            <strong>{preview.answersToWipe} answers</strong> the {preview.playersInRoom} people in the room sent in
          </BulletLine>
          <BulletLine>
            <strong>{preview.finishedQuestionsToWipe} played-question markers</strong> — questions you already played will count as "not played yet"
          </BulletLine>
          <BulletLine>
            <strong>{preview.revealsToWipe} reveal events</strong> — the TV will forget what's been shown
          </BulletLine>
        </Section>

        <Section title="You'll keep:">
          <BulletLine>
            Your <strong>{preview.categoriesKept} categories</strong>
            {categoriesLabel ? ` (${categoriesLabel})` : null}
          </BulletLine>
          <BulletLine>
            The <strong>{preview.pickedQuestionsKept} picked questions</strong>
          </BulletLine>
          <BulletLine>
            The <strong>{preview.playersInRoom} people in the room</strong> — their phones will switch to "waiting for host to start," with points back to zero
          </BulletLine>
        </Section>

        <p style={{ marginTop: 20, fontSize: 14, lineHeight: 1.45, color: "var(--ink-mid, #4A4639)" }}>
          The game will go back to the setup screen so you can finish building it and start fresh.
        </p>

        <div
          style={{
            marginTop: 24,
            display: "flex",
            gap: 12,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            style={{
              background: "transparent",
              color: "var(--ink, #15140F)",
              border: "1px solid var(--line, #D8D2C0)",
              padding: "10px 18px",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
              cursor: isSubmitting ? "default" : "pointer",
              opacity: isSubmitting ? 0.55 : 1,
              fontFamily: "var(--font-sans)",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            style={{
              background: "#9C2F2F",
              color: "#FFF",
              border: "none",
              padding: "10px 18px",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: isSubmitting ? "default" : "pointer",
              opacity: isSubmitting ? 0.7 : 1,
              fontFamily: "var(--font-sans)",
              boxShadow: "0 10px 22px -10px rgba(156,47,47,.6)",
            }}
          >
            {isSubmitting ? "Resetting…" : "Yes, reset this game"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--ink-mute, #6B6553)",
        }}
      >
        {title}
      </div>
      <ul style={{ margin: "8px 0 0 0", padding: 0, listStyle: "none" }}>
        {children}
      </ul>
    </div>
  );
}

function BulletLine({ children }: { children: React.ReactNode }) {
  return (
    <li
      style={{
        fontSize: 14,
        lineHeight: 1.5,
        paddingLeft: 16,
        position: "relative",
        marginTop: 4,
      }}
    >
      <span style={{ position: "absolute", left: 0, top: 0 }}>·</span>
      {children}
    </li>
  );
}

function formatCategories(preview: ResetPreview): string {
  const sample = preview.categoryNamesSample;
  if (sample.length === 0) return "";
  if (sample.length === 1 || preview.categoriesKept <= 2) return sample.join(", ");
  const remaining = preview.categoriesKept - sample.length;
  return `${sample.join(", ")} and ${remaining} more`;
}
```

- [ ] **Step 4: Export the modal from `components/host/index.ts`**

Read `components/host/index.ts` first; then add an export line:

```typescript
export { ResetGameConfirmModal } from "./ResetGameConfirmModal";
export type { ResetGameConfirmModalProps } from "./ResetGameConfirmModal";
```

- [ ] **Step 5: Run tests to verify all pass**

```bash
npx vitest run tests/component/ResetGameConfirmModal.test.tsx
```

Expected: 7 passed.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add components/host/ResetGameConfirmModal.tsx components/host/index.ts tests/component/ResetGameConfirmModal.test.tsx
git commit -m "feat(host): ResetGameConfirmModal — vivid 'are you sure' popup

Pure-props modal showing exact counts of what gets thrown away vs kept.
Verb-labeled red 'Yes, reset this game' button + gray Cancel on the
left. The vivid numbers are the safety mechanism — typed-confirm pattern
was explicitly rejected as engineer-culture friction for non-technical
hosts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Tertiary dashboard button

**Files:**
- Modify: `components/host/HostDashboard.tsx`

- [ ] **Step 1: Add the `onResetGame` prop to `HostDashboardProps`**

In `components/host/HostDashboard.tsx`, replace the `HostDashboardProps` interface (around lines 45–61) with:

```typescript
export interface HostDashboardProps {
  themeKey?: ThemeKey;
  hostName?: string;
  hostSubtitle?: string;
  weeks?: HostDashboardPastNight[];
  lifetime?: { nights: number; questions: number };
  tonight?: HostDashboardTonight | null;
  onSetupTonight?: () => void;
  onResume?: (nightId: string) => void;
  /** Called when the host taps "Reset and edit game". Only meaningful
   *  when tonight.status === 'live' and tonight.resetPreview is set. */
  onResetGame?: () => void;
}
```

And propagate `onResetGame` into `HostDashboardInner`:

```typescript
function HostDashboardInner({
  hostName = "Linda Petrov",
  hostSubtitle = "Independent · 4 venues",
  weeks = DEMO_WEEKS,
  lifetime,
  tonight = null,
  onSetupTonight,
  onResume,
  onResetGame,
}: Omit<HostDashboardProps, "themeKey">) {
```

- [ ] **Step 2: Render the tertiary button when `tonight.status === 'live'`**

In `HostDashboardInner`, find the existing `{tonight && (...)}` block that renders "+ Plan a new night" (around lines 252–275). Immediately after the closing `)}` of that block, add:

```tsx
              {tonight && tonight.status === "live" && tonight.resetPreview && (
                <button
                  type="button"
                  onClick={() => onResetGame?.()}
                  data-testid="host-reset-game-btn"
                  style={{
                    background: "transparent",
                    color: t.inkMid,
                    border: `1px solid ${t.line}`,
                    borderRadius: 10,
                    padding: "7px 14px",
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: "var(--font-sans)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    opacity: 0.85,
                  }}
                >
                  Reset and edit game
                </button>
              )}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Run unit + component tests to confirm no regressions**

```bash
npx vitest run
```

Expected: 254 (pre-PR baseline) + 5 (Task 2) + 7 (Task 5) = 266 passed.

- [ ] **Step 5: Commit**

```bash
git add components/host/HostDashboard.tsx
git commit -m "feat(host): tertiary 'Reset and edit game' button on dashboard

Only renders when tonight is open (status === 'live') and resetPreview
counts have been computed. Sits under '+ Plan a new night,' smaller +
muted so it doesn't compete with the primary Resume CTA.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: HostHomeClient wiring

**Files:**
- Modify: `app/host/HostHomeClient.tsx`

- [ ] **Step 1: Add modal state, reset handler, and success toast**

Replace the imports section (lines 1–11) of `app/host/HostHomeClient.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  HostDashboard,
  ResetGameConfirmModal,
  type HostDashboardPastNight,
  type HostDashboardTonight,
} from "@/components/host";
import { OnboardingFirstDashboard } from "@/components/onboarding";
```

Then, inside `HostHomeClient`, replace the body after the existing `goToTonight` function (around line 67) and before the `if (!isFirstNightComplete)` check (line 68) with:

```typescript
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function resetTonight() {
    if (!tonight) return;
    setResetting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/nights/${tonight.nightId}/reset-to-setup`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `reset failed (${res.status})`);
      }
      const data = (await res.json()) as {
        wiped?: { reveals?: number; answers?: number; finishedQuestions?: number };
        kept?: { categories?: number; players?: number };
      };
      const wipedAnswers = data.wiped?.answers ?? 0;
      const keptCategories = data.kept?.categories ?? 0;
      const keptPlayers = data.kept?.players ?? 0;
      setSuccessMessage(
        `Game rolled back. Wiped ${wipedAnswers} answers, kept ${keptCategories} categories. The ${keptPlayers} people in the room will see the waiting screen.`,
      );
      setResetOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset the game.");
    } finally {
      setResetting(false);
    }
  }
```

- [ ] **Step 2: Pass `onResetGame` to `HostDashboard` and mount the modal + toast**

Replace the JSX return of the second branch (the `return (<><HostDashboard ... />...</>)` around lines 82–96) with:

```tsx
  return (
    <>
      <HostDashboard
        hostName={hostName}
        hostSubtitle={hostSubtitle}
        weeks={weeks}
        lifetime={lifetime}
        tonight={tonight}
        onSetupTonight={createNightAndGo}
        onResume={goToTonight}
        onResetGame={() => setResetOpen(true)}
      />
      {tonight && tonight.resetPreview && (
        <ResetGameConfirmModal
          open={resetOpen}
          venueName={tonight.venue}
          preview={tonight.resetPreview}
          isSubmitting={resetting}
          onConfirm={resetTonight}
          onCancel={() => setResetOpen(false)}
        />
      )}
      {isFounder && <FounderChip />}
      {error && <ErrorToast message={error} onDismiss={() => setError(null)} />}
      {successMessage && (
        <SuccessToast
          message={successMessage}
          onDismiss={() => setSuccessMessage(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Add a `SuccessToast` component below `ErrorToast`**

At the bottom of `app/host/HostHomeClient.tsx`, after the closing brace of `ErrorToast`, add:

```tsx
function SuccessToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        right: 20,
        top: 20,
        zIndex: 50,
        padding: "12px 16px",
        borderRadius: 10,
        background: "rgba(60,128,60,.95)",
        color: "#FFF",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        fontWeight: 500,
        boxShadow: "0 12px 32px -8px rgba(0,0,0,.5)",
        display: "flex",
        gap: 14,
        alignItems: "center",
        maxWidth: 480,
      }}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          background: "transparent",
          color: "#FFF",
          border: "1px solid rgba(255,255,255,.4)",
          padding: "4px 10px",
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Run all tests**

```bash
npx vitest run
```

Expected: full suite green, no regressions.

- [ ] **Step 6: Commit**

```bash
git add app/host/HostHomeClient.tsx
git commit -m "feat(host): wire ResetGameConfirmModal into the dashboard

HostHomeClient owns the open/close state, the POST to the new endpoint,
and the green success toast that surfaces the wipe/keep counts. After a
successful reset, router.refresh() pulls fresh server data so the
dashboard flips to 'Continue setup' automatically.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Full validation — zero-gap gate before merge

**Goal:** Brandon authorized merge-to-main only after full validation with zero gaps. This task is the gate.

**Pre-conditions:** Tasks 1–7 complete, all tests green, type-check clean, branch pushed to origin and a Vercel preview deploy is live.

- [ ] **Step 1: Push the branch to origin**

```bash
git push -u origin feat-reset-game-to-setup
```

Wait for Vercel preview URL to appear (the `Vercel` GitHub check). Capture the preview URL — call it `$PREVIEW`.

- [ ] **Step 2: Run the full test suite and type-check on the branch tip one more time**

```bash
npx vitest run && npx tsc --noEmit
```

Expected: all tests pass; type-check clean. Record exact numbers in the validation log (Step 9).

- [ ] **Step 3: Confirm the migration is live on prod Supabase**

Already applied in Task 1 via Supabase MCP. Reconfirm:

```sql
select proname, prosecdef from pg_proc where proname = 'reset_night_to_setup';
```

Expected: 1 row, `prosecdef = true`.

- [ ] **Step 4: Drive the happy-path manual smoke on the preview**

Use Playwright MCP against `$PREVIEW`. The test night is `00000000-0000-0000-0000-000000000000` (the first host's `XXXXXX`). Sign in as the first host (`host@example.com`) using `/auth/grant?t=` (founder-grant from Brandon's account if needed; see `project_auth_model_type_email_in.md`).

Execute and verify each:

1. Dashboard loads → shows "Resume the live game" + "+ Plan a new night" + **"Reset and edit game"** (new). Capture screenshot `validate-01-dashboard.png`.
2. Tap "Reset and edit game" → modal opens. Verify exact text: "Are you sure you want to reset Soul Fire Pizza?" Header. Verify counts: "25 answers," "18 reveal events," "9 played-question markers," "6 categories," "21 picked questions," "4 people in the room." Capture `validate-02-modal-open.png`.
3. Tap Cancel → modal closes, dashboard unchanged. Verify SQL: `select opened_at, closed_at from nights where id = '00000000-...'` → `opened_at` still set, `closed_at` still null. Capture `validate-03-cancel.png`.
4. Tap "Reset and edit game" again → modal reopens with same counts.
5. Tap "Yes, reset this game" → button shows "Resetting…", then closes. Green success toast appears top-right with: "Game rolled back. Wiped 25 answers, kept 6 categories. The 4 people in the room will see the waiting screen." Capture `validate-04-success-toast.png`.
6. Dashboard re-renders → primary CTA flips to **"Continue setup"**. Tertiary "Reset and edit game" button disappears. Capture `validate-05-after-reset.png`.

- [ ] **Step 5: Verify post-reset DB state via Supabase MCP**

```sql
select id, state, started_at, ended_at from games where night_id = '00000000-0000-0000-0000-000000000000' order by game_no;
select opened_at, closed_at from nights where id = '00000000-0000-0000-0000-000000000000';
select count(*) from reveals where game_id in (select id from games where night_id = '00000000-0000-0000-0000-000000000000');
select count(*) from answers a join questions q on q.id = a.question_id join categories c on c.id = q.category_id join games g on g.id = c.game_id where g.night_id = '00000000-0000-0000-0000-000000000000';
select count(*) from questions q join categories c on c.id = q.category_id join games g on g.id = c.game_id where g.night_id = '00000000-0000-0000-0000-000000000000' and q.finished_at is not null;
select count(*) from categories c join games g on g.id = c.game_id where g.night_id = '00000000-0000-0000-0000-000000000000';
select count(*) from questions q join categories c on c.id = q.category_id join games g on g.id = c.game_id where g.night_id = '00000000-0000-0000-0000-000000000000' and q.is_picked = true;
select count(*) from players where night_id = '00000000-0000-0000-0000-000000000000' and removed_at is null;
```

Expected:
- Game 1 (`481db005-...`): `state='ready'`, `started_at=NULL`, `ended_at=NULL`
- Game 2 (`142a9594-...`): `state='draft'` (UNTOUCHED, draft games are left alone), `started_at=NULL`, `ended_at=NULL`
- `nights.opened_at=NULL`, `closed_at=NULL`
- `reveals` count = 0
- `answers` count = 0
- finished questions count = 0
- categories count = **unchanged from pre-reset** (7: 6 in Game 1 + 1 in Game 2 draft)
- picked questions count = unchanged (42)
- players count = 4 (unchanged)

Any mismatch = STOP, do not merge. Investigate and re-run.

- [ ] **Step 6: Test idempotency via direct RPC call**

The route handler is a thin pass-through to the RPC (covered by Task 2 unit tests). Verify idempotency at the RPC layer via Supabase MCP `execute_sql`:

```sql
select public.reset_night_to_setup('00000000-0000-0000-0000-000000000000'::uuid);
```

Expected jsonb: `{"wiped":{"reveals":0,"answers":0,"finishedQuestions":0},"kept":{"categories":7,"pickedQuestions":42,"players":4}}` — all wipes are zero on the second call.

Also separately verify the UI no-op: after the success toast clears and dashboard refreshes, the "Reset and edit game" button is GONE (since `opened_at` is now null, `tonight.status` is `'setup'`). The user-visible idempotency is "the button isn't there to press."

- [ ] **Step 7: Walk through "Continue setup" → confirm host can finish building the game**

From the dashboard after reset, tap "Continue setup" → land in `/host/setup/00000000-...`. Verify the existing setup UI loads with the original 6 Game 1 categories visible and editable.

- [ ] **Step 8: Verify player phone sees the reset (Realtime)**

In a second browser tab, open `$PREVIEW/r/XXXXXX` as a player (use one of the 4 existing test players' device id from the players table). Verify the phone shows the lobby/waiting screen, not the live game state. If any of the 4 players are still showing live state, that's a Realtime regression and we STOP.

Capture `validate-08-player-lobby.png`.

- [ ] **Step 9: Write the validation log**

Create a temporary local file `_VALIDATION_LOG.md` (gitignored — do not commit) with:

```markdown
# Reset-to-setup validation log — feat-reset-game-to-setup

**Preview URL:** $PREVIEW
**Validated against:** night 00000000-0000-0000-0000-000000000000 (XXXXXX)
**Validated by:** Claude
**Date:** 2026-05-26 (or whenever)

## Tests
- Unit + component: <N> passed, 0 failed
- Type-check: clean

## Manual smoke results
- Dashboard renders new button: ✓ (validate-01)
- Modal opens with correct counts: ✓ (validate-02)
- Cancel works, no DB change: ✓ (validate-03)
- Confirm fires reset, success toast: ✓ (validate-04)
- Dashboard flips to Continue setup: ✓ (validate-05)
- Post-reset SQL state matches spec: ✓ (all 8 queries)
- Idempotent second call: ✓ (zero counts returned)
- Continue setup loads with categories intact: ✓
- Player phone sees lobby state: ✓ (validate-08)

## Gaps found
NONE / <list with severity>

## Verdict
GO / NO-GO for merge.
```

If gaps were found and not fixed, stop. Fix them via more commits to the branch, then re-run steps 4–9. Do NOT merge with any gap unaddressed.

- [ ] **Step 10: Decision point — merge or hold**

- If validation log says **GO**: proceed to Task 9.
- If **NO-GO**: stop, list the gaps to Brandon in plain English, ask for direction.

---

## Task 9: Open PR and merge

**Pre-conditions:** Task 8 completed with `GO` verdict.

- [ ] **Step 1: Open the PR**

```bash
gh pr create --base main --head feat-reset-game-to-setup --title "feat(host): 'Reset and edit game' escape hatch" --body "$(cat <<'EOF'
## What this does

Adds a third button to the host dashboard — **"Reset and edit game"** — that rolls a stuck or test night back to the setup screen. Keeps your categories, the questions you picked, and the people in the room. Throws away the playthrough exhaust: answers, reveal events, played-question markers.

Triggered by Brandon hitting this exact trap on the first host's account the night before her go-live: 6 ready categories, 21 picked questions, 9 played, 25 answers from 4 friends — and the only way to "redo" was throw the whole night away.

## How a host uses it

1. Dashboard shows "Resume the live game." A third smaller button "Reset and edit game" sits under "+ Plan a new night."
2. Tap it → popup says exactly what gets thrown away and what stays.
3. Tap "Yes, reset this game" (or Cancel).
4. Game flips back to setup. Toast confirms: "Wiped 25 answers, kept 6 categories. The 4 people in the room will see the waiting screen."

No typed-confirm pattern — the vivid numbers in the popup are the safety mechanism.

## Safety

- **One indivisible chunk.** A new Postgres function does the wipe in one transaction. Can't half-finish.
- **Owner-only.** Same ownership check as `/open` and `/close`. the first host can't reset Brandon's nights.
- **Draft games untouched.** Only games that have been started or finished get reset. If the first host has Game 2 half-built, it stays half-built.
- **Players stay in the room.** Their phones automatically refresh to the waiting screen — no extra action needed from the host.

## Validation

Full preview validation run before merge (logged separately). Spec: `docs/superpowers/specs/2026-05-25-reset-game-to-setup.md`.

## Test plan

- [x] Unit: route handler (5 cases) + modal component (7 cases) green
- [x] Type-check clean
- [x] Manual smoke on preview against the real stuck test night
- [x] DB state verified via SQL after reset
- [x] Idempotent second call returns zero counts
- [x] Continue setup works after reset
- [x] Player phone refreshes to lobby via Realtime

[See validation log for screenshots + SQL output.]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Capture PR number — call it `$PR_NUM`.

- [ ] **Step 2: Wait for GitHub checks to go green**

```bash
gh pr checks $PR_NUM --watch
```

Expected: all checks pass (CI tests, type-check, Vercel preview, etc.).

- [ ] **Step 3: Merge — Brandon authorized this for this instance only**

```bash
gh pr merge $PR_NUM --squash --delete-branch
```

If any check is red or the merge fails, STOP and report to Brandon. Do NOT use `--admin` or any force flag.

- [ ] **Step 4: Verify the merge landed on main**

```bash
git checkout main && git pull --ff-only origin main && git log --oneline -3
```

Expected: most recent commit on main is the squashed reset-game-to-setup PR.

- [ ] **Step 5: Verify the feature works on prod**

Wait ~1–2 min for Vercel prod deploy. Then sign in as the first host on `tr1via.com` and confirm the "Reset and edit game" button is visible on her dashboard (the test night is now in setup state from Task 8's validation; the button will be hidden until the first host opens a new night, but the dashboard layout should otherwise be normal).

If the button shows when it shouldn't (no open night) or doesn't show when it should, STOP — that's a regression introduced between preview and prod somehow.

- [ ] **Step 6: Report back to Brandon in plain English**

```
Done. The Reset and edit game button is live on tr1via.com. the first host can use it. Full validation log + screenshots saved locally (not committed). Wednesday go-live is ~XYZ hours out — feature shipped, no gaps.
```

---

## Out of scope (do not implement)

- "Pause game" — preserve play state for later resume. Separate spec if requested.
- Per-question undo or per-player point edit (already exists via AdjustPointsModal).
- Audit log of who reset what. TR1VIA is single-host-per-account; not needed.
- Hiding the button behind a "..." overflow menu. Premature; revisit only if the first host complains about clutter.
