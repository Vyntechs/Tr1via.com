# Reset Game to Setup ("Reset and edit game")

**Date:** 2026-05-25
**Author:** Claude (paired with Brandon)
**Ships before:** Heather's go-live, Wednesday 2026-05-27

---

## Problem

When a host starts a game (room opened, Game 1 in `live`) and then realizes they want to start over — whether it's Brandon validating, Heather running a dry run, or Heather accidentally opening too early — there is no escape hatch back to the setup screens.

Today the dashboard's only options are:
- "Resume the live game" (jumps back into the live console — wrong)
- "+ Plan a new night" (creates a *separate* new night; the original night/room code and all its built setup is orphaned)

PR #35 added the second option as an escape hatch from the "no way out of the live state" trap, but it forces hosts to discard all the setup work they did. Brandon hit this directly on Heather's account while validating: the test night YU5JF3 has 6 ready categories, 21 picked questions, 9 played, 18 reveal events, 25 answers across 4 players — and the only way to "redo" it was to throw the whole night away.

## Goal

A third dashboard option: **roll the night back to the setup screen, preserving all the host's setup work (categories, picked questions) and the people in the room, while wiping the playthrough exhaust (reveals, answers, played-question markers).** Same room code, same setup, fresh start.

## Non-goals

- A "pause the live game and resume later" mode. This wipes; it does not pause.
- Per-question undo or per-player point adjustment. (Per-player point adjustments already exist via `AdjustPointsModal`.)
- A bulk "reset all my past nights" admin action.
- Changing what `+ Plan a new night` does. Both escape hatches coexist.
- A typed-confirm pattern. Brandon explicitly rejected this as engineer-culture friction for non-technical hosts; the safety mechanism is a vivid consequence summary in the modal instead.

---

## Design

### Behavior (what the user sees)

1. **A new tertiary button on the dashboard** — "Reset and edit game" — appears in the right-hand column under "+ Plan a new night," only when the dashboard is showing "Resume the live game" (i.e. `nights.opened_at IS NOT NULL`). Smaller and muted (gray border, gray text) so it doesn't compete with the primary CTA.

2. **On tap, a confirmation modal opens.** The modal shows:
    - Header: "Are you sure you want to reset this game?"
    - **Throws away** list with live counts pulled from server-rendered props: N answers from M people, N reveal events, N played-question markers.
    - **Keeps** list: N categories (first 2 names, then "and X more"), N picked questions, M people in the room with a one-line explainer that their phones will refresh to the waiting screen with points reset.
    - One-line tail: "The game will go back to the setup screen so you can finish building it and start fresh."
    - Two buttons at the bottom: gray outline "Cancel" on the left, red filled "Yes, reset this game" on the right.

3. **On confirm:** modal shows a brief inline spinner ("Resetting…"), then closes. The dashboard router refreshes server data; the page re-renders with `tonight.status = 'setup'`, the primary CTA flips to "Continue setup," the tertiary button disappears (no longer relevant).

4. **On success:** small green toast at the top: *"Game rolled back. Wiped 25 answers, kept 6 categories. The 4 people in the room will see the waiting screen."*

5. **On error:** the existing `ErrorToast` in `HostHomeClient` surfaces the failure message; modal stays open so the host can retry or cancel.

### Server-rendered counts

The dashboard page (`app/host/page.tsx`) already does server-side data fetching. Add a small helper that, **only when `tonightRow.opened_at IS NOT NULL`**, computes the "what would be wiped / kept" counts for the tonight night and passes them through `HostDashboardTonight`. Avoids a second round-trip when the modal opens.

```ts
interface ResetPreview {
  answersToWipe: number;
  revealsToWipe: number;
  finishedQuestionsToWipe: number;
  categoriesKept: number;
  pickedQuestionsKept: number;
  playersInRoom: number;
  categoryNamesSample: string[]; // first 2, used in modal body
}
```

Counts are derived from one extra query that joins games → categories → questions → answers/reveals for this single night. Cost is bounded (one night, max 2 games, max ~12 categories, max ~150 questions).

### API surface

**`POST /api/nights/[id]/reset-to-setup`** — new route, mirrors `close/route.ts` shape.

- **Auth:** `requireOwnedNight(id)` — 401/403/404 per existing pattern.
- **Body:** empty.
- **Atomicity:** the route handler calls a single Postgres `rpc` function `reset_night_to_setup(p_night_id uuid)` so the whole operation runs in one DB transaction. The Supabase JS client doesn't expose `BEGIN/COMMIT`, and the existing `close/route.ts` pattern of sequential client updates isn't safe here (a partial failure would leave the game state untyped — `state='ready'` with leftover answer rows). RPC is the right shape.
- **RPC body (Postgres function, plpgsql):**
    1. For each game in the night where `state IN ('live','done')`:
        - `DELETE FROM reveals WHERE game_id = g.id`
        - `DELETE FROM answers WHERE question_id IN (SELECT id FROM questions WHERE category_id IN (SELECT id FROM categories WHERE game_id = g.id))`
        - `UPDATE questions SET finished_at = NULL, played_at = NULL WHERE category_id IN (SELECT id FROM categories WHERE game_id = g.id)`
        - `UPDATE games SET state = 'ready', started_at = NULL, ended_at = NULL WHERE id = g.id`
    2. `UPDATE nights SET opened_at = NULL WHERE id = p_night_id`
    3. Returns counts as JSON: `{wiped: {reveals, answers, finished_questions}, kept: {categories, picked_questions, players}}`. Counts are computed *before* the deletes (one pass of `COUNT(*)` queries) so the response is accurate even though the rows are gone by return time.
- **Migration:** new migration file `supabase/migrations/YYYYMMDD_reset_night_to_setup.sql` defines the function. `SECURITY DEFINER` so the function runs with elevated privileges (the route handler has already enforced `requireOwnedNight`).
- **Untouched:** games in `draft` or `ready`, categories (all columns), questions' `is_picked` flag and content, players (rows in `players`).
- **Idempotent:** if no games in `live`/`done`, returns 200 with zero counts. Second call is a no-op.
- **Response (`ok` helper from `@/lib/api/responses`):**

```json
{
  "ok": true,
  "wiped": { "reveals": 18, "answers": 25, "finishedQuestions": 9 },
  "kept":  { "categories": 6, "pickedQuestions": 21, "players": 4 }
}
```

### Files

| File | Change |
|---|---|
| `supabase/migrations/YYYYMMDD_reset_night_to_setup.sql` | **new** — `reset_night_to_setup(p_night_id uuid)` plpgsql function, `SECURITY DEFINER` |
| `app/api/nights/[id]/reset-to-setup/route.ts` | **new** — POST handler; calls the RPC; returns counts |
| `lib/api/resetNightCounts.ts` | **new** — pure server helper that computes the preview counts for a night id (used by the dashboard page) |
| `components/host/ResetGameConfirmModal.tsx` | **new** — modal component, pure props, no fetches |
| `components/host/HostDashboard.tsx` | add tertiary "Reset and edit game" button; new optional `onResetGame` prop + `resetPreview` prop on `HostDashboardTonight` |
| `app/host/HostHomeClient.tsx` | new `resetNight(nightId)` handler that POSTs the reset endpoint, shows toast, calls `router.refresh()`; mount `ResetGameConfirmModal` |
| `app/host/page.tsx` | compute `resetPreview` server-side when `opened_at IS NOT NULL`; pass through `tonight` |
| `components/host/index.ts` | export `ResetGameConfirmModal` |
| `tests/unit/api-reset-night.test.ts` | **new** — endpoint behavior (auth, idempotent, wipe correctness, preserves draft games) |
| `tests/component/ResetGameConfirmModal.test.tsx` | **new** — render, count strings, confirm/cancel handlers, disabled-during-submit |

---

## Safety

### Why no typing-to-confirm

The vivid consequence summary in the modal *is* the safety mechanism. Specific numbers ("25 answers from 4 people") force the host to read; verb-labeled red button ("Yes, reset this game") prevents the "OK-the-dialog" reflex; Cancel on the left is the natural fall-through.

If Heather ever mis-fires this in practice, the cheapest escalation is a 3-second "hold to confirm" — not a typed word.

### Why per-night, not per-game

For TR1VIA's current shape (1 night = 2 games max), a per-night reset is what hosts mentally want: "reset tonight." A future "multi-game-live" world might want per-game granularity, but that world doesn't exist yet. The `draft` games-are-left-alone rule means per-night is non-destructive to untouched setup work.

### Why a Postgres RPC, not the JS client

Hosts have RLS via `auth.uid()`, but the reset operation spans deletes and updates across four tables. A partial failure mid-sequence (e.g. answers deleted, then a network blip kills the `games.state` update) would leave the game in an unrepresentable state. The Supabase JS client doesn't expose `BEGIN/COMMIT`. RPC is the only clean way to get one atomic chunk.

### What this can't break for Heather

- It can't wipe a different night — `requireOwnedNight` scopes to the signed-in host's nights.
- It can't half-reset — single transaction.
- It can't delete categories or picked questions — the SQL never touches those rows beyond resetting `finished_at`/`played_at` on questions.
- It can't reset a `draft` or `ready` game — those are filtered out server-side, so even if the client were tricked into calling reset before opening, nothing destructive happens.

---

## Edge cases

| Case | Behavior |
|---|---|
| Host calls reset twice in a row | Second call: idempotent no-op (no games in live/done after first call), zero counts returned. |
| Game 1 live, Game 2 in draft (Heather's current state) | Game 1 resets to `ready`; Game 2 left alone with its 1 in-progress category. |
| Game 1 done, Game 2 live | Both reset to `ready`; both games' answers/reveals wiped. |
| Game 1 done, Game 2 done | Both reset to `ready`. Edge case: night is "finished" but not `closed_at`. Reset succeeds; dashboard goes back to "Continue setup." |
| Reset called while a player is mid-answer-submit | Player's `POST /api/answers` may land just before the DELETE; the DELETE removes it. Player's phone re-bootstraps on `visibilitychange`/`online` (PR #36) and sees lobby state. Acceptable — they're mid-test, not paying patrons. |
| Reset called on a night with 0 answers/reveals | Modal still opens with "0 answers, 0 reveals" counts. Host can still confirm; endpoint returns zero counts. UX preserves consistency. |
| Host on stale dashboard tab (clicked reset, then page was reset elsewhere) | Endpoint returns idempotent zero-counts; toast says "Game rolled back. Wiped 0 answers." Slightly confusing but harmless; `router.refresh()` brings state back into sync. |
| RLS race: host loses ownership mid-reset | `requireOwnedNight` returns 403 before any writes. Modal surfaces error toast. |
| Realtime: players still connected when reset hits | Existing `useRoom` Realtime subscriptions on `games`, `nights`, `reveals`, `answers`, `questions` fire on the changes — phones naturally update to lobby state without any extra broadcast. |

---

## Testing

### Unit / integration

`tests/unit/api-reset-night.test.ts` (new):
- POST succeeds; returns expected counts after seeding a live night.
- Idempotent: second POST returns zero counts.
- Preserves `draft` and `ready` games (their state, started_at, reveals, answers untouched).
- Preserves categories (rows + columns) and questions' `is_picked` + content.
- Preserves players.
- 401 unauthenticated.
- 403 if signed in as a different host.
- 404 if night doesn't exist.

`tests/component/ResetGameConfirmModal.test.tsx` (new):
- Renders the count strings exactly as supplied via props.
- Cancel calls `onCancel`, doesn't call `onConfirm`.
- Confirm calls `onConfirm`; button is disabled during the async resolution.
- "Reset" button is red; "Cancel" is the gray outline.

### Manual smoke (Brandon, on a preview deploy)

1. Sign in as Heather (or grant-link to Heather's account).
2. Confirm dashboard shows "Resume the live game" + the new "Reset and edit game" button.
3. Click "Reset and edit game" → modal opens with non-zero counts.
4. Click Cancel → modal closes, no DB change.
5. Click "Reset and edit game" again → modal → "Yes, reset this game."
6. Toast appears with counts. Dashboard re-renders to "Continue setup."
7. SQL check: `games` state for Game 1 = `ready`, `nights.opened_at IS NULL`, `reveals` for both games = 0 rows, `answers` for relevant questions = 0 rows, `questions.finished_at` all null for affected categories. Categories + picked-question content unchanged. Players unchanged.
8. Click "Continue setup" → land in the existing setup flow with the original categories visible and editable.
9. Open a fresh browser tab as a player to YU5JF3 → confirm phone shows lobby (waiting for host to start), zero points.
10. Start Game 1 again → confirm normal play resumes from scratch.

### Founder / Brandon validation reuse

After ship, this becomes part of the validation toolkit: instead of writing one-shot SQL or "+ Plan a new night" between every iteration, Brandon can hit reset and re-run the flow with the same room code, same friends already joined.

---

## Build order

1. Migration: `reset_night_to_setup` plpgsql function. Apply via Supabase MCP `apply_migration` to project `citweuctcnuxmqjxcbiz`. Verify in SQL editor that it runs against a seeded test night.
2. `app/api/nights/[id]/reset-to-setup/route.ts` — POST handler that calls the RPC. Unit tests as TDD.
3. `lib/api/resetNightCounts.ts` — count helper. Used by the dashboard page.
4. `components/host/ResetGameConfirmModal.tsx` — pure-props modal. Component tests as TDD.
5. Wire counts into `HostDashboardTonight` shape (add `resetPreview` field) + `app/host/page.tsx` (compute when `opened_at IS NOT NULL`).
6. Add tertiary button + `onResetGame` prop to `HostDashboard`.
7. `HostHomeClient` handler + modal mount + success toast.
8. Manual smoke on preview per the script above. Capture screenshots: dashboard with button, modal open with counts, success toast, dashboard after reset. Attach to PR.
9. PR: open against `main`, brief description in plain English, Brandon clicks merge.

Estimated focused time: ~6–8 hours. Wednesday go-live is ~46 hours away — comfortable.

---

## Out of scope, but flagged

- "Pause game" mode (preserve play state for later resume) — not requested, separate spec if it ever is.
- Per-question undo — covered by future spec if Heather asks.
- Hiding the button behind a "..." overflow menu — premature; revisit only if Heather reports clutter.
- Persisting "reset history" for audit (who reset what, when) — TR1VIA has one host per account and isn't multi-tenant; not needed.
- Re-using PR #35's `+ Plan a new night` button to *also* offer a "wipe this one and start fresh" sub-action — keeping the two as distinct, separately-labeled buttons is clearer than a dropdown.
