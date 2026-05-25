# PR G3: "Write Your Own" Custom Question on the Pick Screen — Design Spec

> **Author note:** This is a planning artifact on the `docs-spec-g3-custom-question` branch. No code, schema, or tests live here. The implementation plan lands in a follow-up `docs/superpowers/plans/...g3...` doc; the implementation PR comes after that.

## Background

Heather (Wed 2026-05-27 go-live) texted Brandon while sitting on the Pick screen:

> "Also can I make up my own question?"

She has 20 Claude-generated candidates and wants to author her own — either as an extra option among the 20, or to **replace one she dislikes** without losing the rest.

The existing fallback at `/host/setup/[nightId]/pick/[categoryId]/manual` is "wipe all candidates and type all 7 by hand." It cannot be reached from the Pick screen without throwing away the generated 20. That's the gap.

## Goal

From the Pick screen, Heather can add a custom 21st (or 22nd, 23rd…) question candidate alongside the 20 Claude generated, and pick it into her 7-slot board the same way she picks any other candidate.

**Scope is "one custom card at a time."** Not bulk entry. The bulk path already exists and stays put.

## Non-goals

- No "replace candidate N with custom" sugar. The existing pick/unpick toggle handles "I want mine instead of that one": she picks her custom, the board climbs to 8, she unpicks the one she doesn't want, the board falls to 7. One affordance, two outcomes.
- No new schema. `questions.source='host-edit'`, `is_picked=false`, `point_value=null` already covers this row.
- No images on first cut. The custom card gets the same placeholder treatment as a generated card without a Pexels match. She can use the existing Image Swap / Upload panel on it after creating (it lives on the card, same as every other).
- No edit of the custom card via a separate route. The existing Edit panel handles it once the row exists.
- No migration. Existing rows are unaffected.

## Recommended approach

**"Write your own +" card lives as the first card in the candidate grid. Tapping it opens the existing Edit panel in "create mode" (empty fields). Save creates a new `questions` row in the category. The card joins the grid and behaves identically to a generated card from that point forward — pick, edit, swap image, unpick.**

### Approaches considered

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **A. "+" card as first grid cell, reuses Edit panel** | Lives where Heather's eyes already are. Same affordance pattern as every other card. Same Edit UI she already trusts. Zero new component surface. | Pushes the first generated card down a slot. | **CHOSEN.** Minimum new surface, maximum reuse. |
| B. Sidebar button under YOUR BOARD | Always visible while scrolling candidates. | Sidebar is "the board I'm building" — a create button there is the wrong mental model. Far from where she's evaluating candidates. | Rejected. |
| C. Full-screen new-question route | Lots of room for elaborate form. | Re-introduces the "leave the Pick screen and lose context" failure mode that motivated this whole PR. Three more clicks. | Rejected. |
| D. Inline form expanding inside the grid | No modal at all. | The Edit panel already exists, polished, with the POINT VALUE picker she just learned in PR G1. Building a parallel inline form duplicates UI surface and diverges from the edit experience. | Rejected — duplicates work. |
| E. Replace-one-for-one (swap chooser) | "Trash this one and put mine here." | Brandon: "prefer add over swap." Needs a separate target picker. Doesn't compose with the existing pick toggle. | Rejected per directive. |

### What "create mode" of the Edit panel looks like

Same `HostGenEdit` component the host already uses for generated cards. Differences from edit mode:

| Element | Edit mode (today) | Create mode (new) |
|---|---|---|
| Eyebrow | `EDIT QUESTION · 6 OF 20` | `WRITE YOUR OWN · {CATEGORY-NAME}` |
| Shell title | `edit · pixar movies · q6` | `new question · pixar movies` |
| Prompt textarea | Pre-filled | Empty, placeholder: `Type the question players will read off the TV…` |
| Four options | Pre-filled | Four empty inputs, placeholders `Option 1` … `Option 4` |
| Correct-index marker | Pre-marked | None marked. Host must mark one before Save enables. |
| POINT VALUE picker | Pre-set (or null = AUTO) | Defaults to `null` (`AUTO ON LOCK`). Host may place if she wants. |
| Image block | Shows current image + Swap | Shows placeholder; "Add an image after creating" hint. Swap button hidden in create mode. |
| Primary button | `Save · this question` | `Create · add to candidates` |
| Secondary button | `Discard changes` → close | `Cancel` → close |

After Create succeeds, the panel closes, the new card appears in the grid (first position after the "+" card), is **not auto-picked**, and the host can pick it the same way as any other card. Picking it past 7 is still blocked by the existing 7-cap (`togglePick` in `HostSetupPickClient`).

### Validation in create mode (client + server)

Same constraints already enforced for manual entries / PATCH edits, applied here:

- `prompt`: trimmed, 4–400 chars.
- `options`: 4 strings, each trimmed 1–160 chars, all four distinct (case-insensitive).
- `correctIndex`: required, 0–3.
- `pointValue`: optional. If present, one of `100,200,300,400,500,600,700`. Otherwise `null`.
- `imageUrl`: not accepted in v1 (post-create flow via existing Image Swap/Upload panel on the new card).

Save button stays disabled until all four are valid AND `correctIndex` is marked.

## API contract

### New endpoint: `POST /api/categories/[id]/questions`

Creates a single host-authored candidate question in a category.

**Auth:** Host-only, must own the category (`requireOwnedCategory`).

**Category state preconditions:**
- Refuses `'generating'` with 409 (would race the broadcast loop).
- Refuses `'draft'` with 409 (no candidates yet — host should run generation or use the manual fallback first).
- Accepts `'review'` and `'ready'` (mirrors `POST /api/categories/[id]/pick`).

**Request body** (new Zod schema `CreateQuestionBodySchema` in `lib/api/schemas.ts`):

```ts
{
  prompt: string,                        // trimmed, 4..400
  options: [string, string, string, string], // each 1..160, four distinct
  correctIndex: 0 | 1 | 2 | 3,
  pointValue?: 100|200|300|400|500|600|700 | null  // optional, default null
}
```

**Response 201:**

```json
{ "question": { /* full QuestionRow */ } }
```

**Behaviour:**
1. Validate body via Zod.
2. Insert a new `questions` row with:
   - `category_id` = path param.
   - `prompt`, `options`, `correct_index`, `point_value` from body.
   - `difficulty = 4` (mid-rated — placeholder, no Claude evaluation runs for host-authored rows).
   - `source = 'host-edit'`.
   - `is_picked = false`.
   - `image_url = null`, `image_source = null`, `image_attribution = null`.
3. Return the inserted row.

**Why a new endpoint instead of extending PATCH:**
- PATCH semantics are "edit existing"; create requires no `id`.
- Keeps the PATCH schema and atomic-swap logic (recently extended for `pointValue`) focused on its single job.
- Easier to test, audit, and reason about ownership/state gates separately.

**Why we don't change `is_picked` here:** The host explicitly picks afterward via the existing toggle. Auto-picking would be surprising at 7 picks (would push her over) and inconsistent with how the generated 20 land in the grid (also unpicked).

## UI changes

### `components/host/gen/HostGenPick.tsx`

1. **New first-cell "+" card.** Same dimensions as a `QuestionCard`, dashed border in `t.line`, centered:
   - Eyebrow line `NEW QUESTION`.
   - Large `+`.
   - Subtitle `Write your own — adds a candidate to this grid.`
   - Clickable; calls new prop `onCreate?: () => void`.

2. **No change to the existing 20-card layout below the "+" card** — still `repeat(2, 1fr)` grid. The "+" card occupies the first cell; the 20 generated flow after it. Grid grows to 21 cells.

3. **New prop:** `onCreate?: () => void` (purely UI plumbing; the handler lives in `HostSetupPickClient`).

4. **Demo default** for the gallery (`/dev/host/gen`): the "+" card is always rendered; clicking it in the gallery does nothing (no handler wired). Keeps the gallery render honest.

### `components/host/gen/HostGenEdit.tsx`

Add an optional `mode` discriminator (default `'edit'`):

```ts
interface HostGenEditProps {
  // ...existing props
  mode?: 'edit' | 'create';
}
```

When `mode === 'create'`:
- Eyebrow text overridden by parent via existing `eyebrow` prop (no change to component default — parent sets it).
- Primary button label: `Create · add to candidates`.
- Secondary button label: `Cancel`.
- Image side: hide the `Swap image` button; show a small hint `Add an image after creating.` instead of the placeholder caption.
- Create button is disabled until prompt + four options + a marked `correctIndex` all validate.
- Create button is also disabled while the POST is in flight (mirrors existing `isSaving` plumbing).
- `correctIndex` starts unmarked — internal state is `0 | 1 | 2 | 3 | undefined`. The component never invokes `onSave` while `correctIndex === undefined`. Edit mode is unchanged (always starts pre-marked, internal state stays strict).

### `app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient.tsx`

1. **Extend `ModalState`** with a new variant:
   ```ts
   | { kind: "create" }
   ```

2. **New handler `handleCreate(values)`:** POSTs `/api/categories/[categoryId]/questions` with the form payload. On 201, appends the new `QuestionRow` to local `questions` state. New row is unpicked by default. Closes the modal. On error, surfaces in the existing toast.

3. **Wire `onCreate={() => setModal({ kind: "create" })}`** on the `HostGenPick`.

4. **Render `<HostGenEdit mode="create" initial={EMPTY_INITIAL} ... onSave={handleCreate} />`** under the existing ModalOverlay when `modal.kind === "create"`. Reuses the `ModalOverlay` already in the file.

`EMPTY_INITIAL`:
```ts
{
  prompt: "",
  options: ["", "", "", ""],
  correctIndex: undefined, // unmarked — host must mark before Create enables
  pointValue: null,
}
```

The contract change: `HostGenEditProps.initial.correctIndex` accepts `0 | 1 | 2 | 3 | undefined` (was `0 | 1 | 2 | 3`). The `HostGenEditValues` emitted to `onSave` keeps the strict `0 | 1 | 2 | 3` — the component only fires `onSave` once the host has marked one. Edit-mode callers continue to pass a strict `0 | 1 | 2 | 3` and see no change.

## File touch list

| File | Role | Change |
|---|---|---|
| `lib/api/schemas.ts` | Zod schemas | **Add** `CreateQuestionBodySchema` |
| `app/api/categories/[id]/questions/route.ts` | **New** route handler | POST → insert + return new row |
| `components/host/gen/HostGenPick.tsx` | Grid UI | Add "+" card as first grid cell + `onCreate` prop |
| `components/host/gen/HostGenEdit.tsx` | Edit panel | Add `mode: 'edit' \| 'create'` + sentinel `correctIndex` + button label switch |
| `app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient.tsx` | Page wrapper | `ModalState` "create" variant + `handleCreate` + wire `onCreate` |
| `tests/unit/api/schemas.test.ts` (if it exists) or new colocated test | Zod schema test | Cover the new schema's accept / reject cases |
| `tests/integration/api-categories-questions.test.ts` | **New** integration test | POST happy path + state gate + ownership |

**Files NOT touched:**
- `supabase/migrations/*` — no schema change.
- `app/api/questions/[id]/route.ts` — PATCH stays as-is.
- `app/api/categories/[id]/manual/route.ts` — bulk manual stays as-is.
- `app/api/categories/[id]/pick/route.ts` — pick stays as-is; it already handles a category with > 20 questions (it enforces `questionIds.length === 7`, doesn't care about candidate count).
- `lib/game/difficulty.ts` — `assignPointValues` already handles arbitrary picked counts. A host-authored row with `difficulty: 4` is treated identically to a Claude-rated 4 by `assignPointValues` (sorted by difficulty asc, ties broken by id).

## Edge cases and error handling

- **Picking the custom card pushes total to 8:** existing 7-cap blocks it. Host must unpick another first. Same UX as today.
- **Host creates 5 customs and never picks them:** harmless. The category has 25 candidates, picks 7, locks. Unpicked rows stay in the DB (matches existing behaviour for the 13 unpicked generated rows).
- **Host creates a custom then regenerates the 20:** the regenerate route does NOT delete prior `questions` rows (confirmed in `app/api/categories/[id]/generate/route.ts` — `runGenerationJob` inserts a fresh 20 alongside whatever exists). Host-authored customs survive a regenerate; the grid grows (20 → up to 41 etc.). The "+" card still works during `'review'` after a regenerate.
- **Host hits Create on the same payload twice quickly:** the Create button disables on first click (same `isSaving` gate as Edit). Mis-click during the in-flight window is blocked. If two browsers fire concurrently it would create two rows; acceptable, she can ignore the extra in the candidate pool.
- **Category state flips to `'generating'` mid-edit:** the route returns 409. Toast surfaces the error. Modal stays open with her input intact so she doesn't lose work; on dismissal, her input is dropped (matches existing Edit-panel discard behaviour).
- **Duplicate option strings:** Zod rejects (existing `QuestionOptionsTupleSchema` already enforces case-insensitive distinct). Save button disabled client-side first.

## Realtime

No new broadcast events. The host's own client mutates local state on the 201 response. Other host devices (none expected — single host per night) would not see the new card live, but TR1VIA is a single-host app and this matches the existing PATCH / manual-entry behaviour. Out of scope to broadcast.

## Telemetry / audit

`source='host-edit'` on the new row makes "how often does the host author her own?" reportable from the existing audit field. No new columns needed.

## Time pressure / scope discipline

- **Smaller scope to ship before Wednesday:** images-after-create (not in-create), no swap UX, no preserve-on-regenerate. Each is a clean follow-up PR.
- **Reuses the Edit panel** instead of building a parallel create form — biggest single time-saver.
- **No schema change** — biggest risk eliminator.

## What to validate (human eyes)

For the PR description of the implementation PR:

1. **Heather flow, happy path:** From the Pick screen with 20 candidates, tap "+" → write a prompt → fill 4 options → mark one correct → leave POINT VALUE as AUTO → Create. The new card appears as a 21st cell. Pick it (board climbs to 7 or 8 depending on prior state). Unpick a generated card if needed. Lock. The custom question lands on the board with `source='host-edit'` and either an auto-assigned tier or her placed tier.

2. **Heather flow, replace mentality:** With 7 already picked, create a custom, pick it (8/7 = blocked toggle), unpick the one she dislikes (7/7), lock.

3. **State gates (verify the asserted behaviour):**
   - During `'generating'`: `HostGenLoading` renders instead of `HostGenPick`, so the "+" card is not on screen and unreachable.
   - In `'draft'` after a generation failure: `HostGenError` renders, "+" card is not on screen and unreachable.
   - In `'ready'` (already locked, 7 picked): "+" card IS reachable. Creating still works — the new card joins the grid unpicked. Heather can unpick something and pick her custom to swap into the locked board (the lock endpoint's accepted-states include `'ready'`, so re-locking works).

4. **POINT VALUE behaviour for a created+placed custom:** Create with `pointValue: 400` and existing pick already at 400. Edit-panel atomic-swap logic does NOT apply here (this is a fresh `is_picked: false` row — it doesn't have a slot to swap). The placement only matters at lock time, which `assignPointValues` already handles (custom claims 400, displaced generated pick fills next open slot).

5. **Validation messages:** Create with empty prompt → button disabled, no toast. Submit with duplicate options → 400 from API surfaces in toast.

6. **Reload mid-create:** Refresh the page with the modal open. The unsaved draft is dropped (existing modal behaviour). The previously-created customs persist (they're real DB rows).

## Out of scope (explicit follow-ups)

- Image attach during create. v1 ships placeholder; host uses existing Image Swap/Upload after.
- Preserve-on-regenerate for host-authored rows: already true by virtue of the existing generate route not deleting prior questions. No work needed.
- Bulk-add multiple customs in one panel. The single-question flow scales by repeated taps; bulk is the existing manual-entry route.
- Replace-in-place sugar ("delete THIS card, add mine"). The pick-then-unpick flow covers this without new UI.

## Open product questions (none blocking)

None. Brandon directive covers add-vs-swap, the panel reuse is unambiguous from the codebase, and all data shapes already exist.
