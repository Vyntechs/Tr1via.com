# PR G2 — Rename a locked category

**Date:** 2026-05-25
**Owner:** Brandon (Vyntechs / TR1VIA)
**Status:** Spec — not yet implemented
**Target ship:** Tuesday 2026-05-26 (the day before Heather's first paid Wednesday night, 2026-05-27)
**Branch (for this spec):** `docs-spec-g2-rename-category`

---

## 1. Problem (verbatim from the customer)

Heather, in a text to Brandon:

> "How do I change the name of the category after I locked it in? I just want it to say skirts"

She had typed `types of skirts through the years`, generated questions, then locked the category (the irreversible "Lock the category" button on the Pick screen that flips `categories.state` from `review` → `ready` and freezes the 7 questions). She now wants the display label to read `skirts`.

There is no UI affordance for this anywhere in the host app. There is also no API endpoint — `app/api/categories/[id]/route.ts` does not exist. Both layers have to be built.

## 2. Goals & non-goals

### Goals

1. Heather can rename a category at any point in its lifecycle: `draft`, `generating`, `review`, or `ready` (locked).
2. The rename takes effect everywhere the category name shows up — Pick screen header, modal shell titles, Setup Overview slot card, breadcrumbs.
3. The rename never affects generation. The Claude prompt has already used the original `topic`; we don't re-generate, re-photo, or invalidate any of the 20 candidates / 7 picks.
4. Ships behind one PR titled `feat(category): host can rename a category at any state`.
5. Brandon can spot-check on the preview deploy from a "what to validate (human eyes)" section in the PR description.

### Non-goals

- No rename-from-Setup-Overview affordance. The slot card on the overview is a button that opens the Pick screen — adding rename there would compete with the open-on-click action. If Heather asks for it after Wednesday, follow-up PR.
- No editing the `topic` (the Claude prompt). See §3 for why.
- No history / audit of rename events. The before-value is gone; we have one `name` column.
- No realtime broadcast of the rename to a parallel TV or player. The rename only matters to the host on her laptop; players never see the category name until reveal time, which always renders from a fresh server query.
- No rename during a live game (`/host/live/[nightId]`). Locked + game open = label is on the TV. Out of scope for this PR; revisit if asked.

## 3. Product decision: rename `name`, not `topic`

`categories` has two text columns:

| Column | Set at creation to | Used by | User-facing? |
|---|---|---|---|
| `name` | the topic string | Pick header, modal eyebrows, Setup Overview slot, slot color hash (`categoryColor(c.name, ...)`) | **Yes — everywhere visible** |
| `topic` | the topic string | `POST /api/categories/[id]/generate` Claude prompt, Pexels image fallback in `lib/ai/auto-attach-photo.ts`, `imageSeed` fallback in the Edit modal | **No — backend only** |

Confirmed by reading:

- `app/host/setup/[nightId]/topic/HostSetupTopicClient.tsx:45-50` — both columns get `input.topic` at creation. They start identical.
- `app/host/setup/[nightId]/HostSetupOverviewClient.tsx:226,231,238,240` — slot card reads `cat.name`.
- `app/host/setup/[nightId]/pick/[categoryId]/page.tsx:49-50` — passes both to the client; only `name` is rendered in headers.
- `components/host/gen/HostGenPick.tsx:163-167` — header `topic` prop (badly named) renders `name`.
- `app/api/categories/[id]/generate/route.ts:91` — passes `category.topic` to the Claude generator.

**Decision:** rename mutates `name` only. `topic` stays as the original generation prompt — that's the historical "what was this category about for Claude's purposes" record. The host has no reason to edit it after generation has run.

If Heather later wants to re-generate against a new topic, that's a different feature (regenerate-with-new-prompt) and out of scope.

## 4. Design

### 4.1 Pick screen header — inline rename

Today the Pick screen header (`components/host/gen/HostGenPick.tsx:158-222`) renders:

```
●  PIXAR MOVIES · 20 PULLED · PHOTOS MATCHED
   Pick your seven.                                   [flavor pills...]
```

The `PIXAR MOVIES` text comes from `topic.toUpperCase()` in the `Eyebrow` row at line 165-167. That's the label Heather wants to change.

**New affordance:** a small pencil button (12px SVG, `t.inkMid` stroke) appears immediately after the eyebrow text. Click → the eyebrow row replaces itself with a single-line text input pre-filled with `name`, plus a save button (✓) and cancel button (✕).

- Enter or click ✓ → save.
- Escape or click ✕ → discard.
- Blur with a changed value but no explicit action → save (matches the "auto-save on blur" precedent in `HostGenEdit` Q-text fields).
- Empty value or only whitespace → trim, validate, refuse with a small inline error in the row (no toast).
- Length cap at 80 chars (mirrors `CreateCategoryBodySchema.name.max(80)`).

While the save POST is in flight, the input shows a `Saving…` micro-label and is disabled. On success the input collapses back to the eyebrow + pencil with the new label. On failure the input stays open, an inline error message renders under it, the value is preserved, and Brandon's standard error toast appears at the bottom-right (reuses the same toast the file already renders).

### 4.2 No rename surface on the Setup Overview

The slot cards in `HostGenOverview` are buttons that route to the Pick screen on click. Adding a rename affordance there would conflict with the open-on-click pattern (we'd need to make the title region a separate hit-target with stopPropagation, or open a modal). Defer to a follow-up PR if Heather asks.

### 4.3 Why pencil-inline over a modal

Three options considered:

| Approach | Pros | Cons |
|---|---|---|
| **A. Pencil → inline input** (chosen) | One click to start typing. Stays in the surface the host was already on. Smallest implementation. Matches the lightweight feel of the Edit / Image side panels. | Less affordance for "hey there's a rename here" than a modal. Pencil icon needs a tooltip / aria-label. |
| B. Pencil → "Rename category" modal | Familiar pattern. Easy to add help text ("This only changes the label, not the generated questions"). | Two extra clicks (open + dismiss). New ModalOverlay surface to design + theme. Heavier than the change deserves. |
| C. Inline auto-save input on BOTH Pick + Overview | Rename from wherever you are. | Doubles UI surface, doubles state-sync (overview client doesn't currently round-trip the renamed category back to its category list). Conflicts with overview's open-on-click. |

**Picked A.** Scope-appropriate, no new modal chrome, ships on Tuesday.

### 4.4 Visual sketch (Pick header before / during / after)

```
BEFORE (read state)
●  TYPES OF SKIRTS THROUGH THE YEARS · 20 PULLED · PHOTOS MATCHED  ✎
   Pick your seven.

DURING (edit state)
●  [types of skirts through the years________________________]  ✓  ✕
   Pick your seven.

AFTER (read state, after save)
●  SKIRTS · 20 PULLED · PHOTOS MATCHED  ✎
   Pick your seven.
```

The `Pick your seven.` headline below the eyebrow is unchanged — it's a literal string, not the topic.

### 4.5 Server-side surfaces that auto-update

Because the Pick page is a Server Component (`page.tsx:46-55`) that passes `categoryName={owned.category.name}` to the client, a hard reload after rename will render the new label everywhere. The client wrapper just needs to keep the in-page state in sync so the host doesn't have to reload.

- `HostSetupPickClient` currently treats `categoryName` as a prop and never restates it. **Change:** lift it into `useState<string>`, initialized from the prop. The header gets `topic={categoryName}`; the four modal shell titles and the breadcrumb-shaped eyebrows all already read from `categoryName`. Every dependent re-renders for free.
- `HostSetupOverviewClient` reads `cat.name` from a SSR-fetched `categories` array. It doesn't auto-refresh from realtime; today it relies on Next.js navigation re-fetching. **Change:** none required for this PR — when the host navigates back to overview from Pick, the page re-renders server-side and picks up the new name. (Optional improvement noted in §8.)

## 5. API design

### 5.1 New route: `PATCH /api/categories/[id]`

**File:** `app/api/categories/[id]/route.ts` (new file; no existing handler there).

**Template:** `app/api/nights/[id]/theme/route.ts` (PATCH-on-a-single-field, same shape).

**Body schema** (new export in `lib/api/schemas.ts`):

```ts
/** PATCH /api/categories/[id] body — rename the display label. */
export const PatchCategoryBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
  })
  .strict();
export type PatchCategoryInput = z.infer<typeof PatchCategoryBodySchema>;
```

**Handler shape:**

1. Parse + validate body. 400 on bad JSON / Zod failure.
2. `requireOwnedCategory(categoryId)` — gives 401 / 403 / 404 in the same style as every other category-keyed route.
3. `admin.from("categories").update({ name }).eq("id", id).select("id, name").single()`.
4. Return `ok({ category: data })`. The client only needs the new `name` back; we send the id too for safety.

Allowed in any `state` — `draft`, `generating`, `review`, `ready`. No state-machine guard. The only invariant the rename can violate is the schema's length/trim rules, which Zod enforces.

**Not part of this route:**

- No `topic` field accepted. If a future request needs `topic` editing, add it to the same schema then; for now, `.strict()` ensures any `topic` payload is rejected with a clear "Unrecognized key" error.
- No `position`, `state`, `color`, `flavor` mutation. Those have their own well-defined flows.

### 5.2 Wire the client call

In `HostSetupPickClient`:

```ts
async function handleRename(nextName: string) {
  const trimmed = nextName.trim();
  if (trimmed === categoryName) return; // no-op
  setSavingName(true);
  setError(null);
  try {
    const res = await fetch(`/api/categories/${categoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "could not rename");
    }
    const { category } = (await res.json()) as { category: { id: string; name: string } };
    setCategoryName(category.name);
  } catch (err) {
    setError(err instanceof Error ? err.message : "Could not rename.");
    throw err; // let the inline rename UI keep the editor open
  } finally {
    setSavingName(false);
  }
}
```

Three new pieces of state in the client wrapper:

- `categoryName: string` (was prop, now state)
- `savingName: boolean`
- The header subcomponent owns its own `isEditing` local state — no need to lift.

## 6. Component plumbing

`HostGenPick` needs a new prop set:

```ts
interface HostGenPickProps {
  // ... existing props ...
  /** Called when the host saves a renamed label. Returns a promise so the
   *  inline editor can keep the input open on failure. */
  onRename?: (next: string) => Promise<void>;
  /** True while the rename POST is in flight. Disables the inline input. */
  isRenaming?: boolean;
}
```

Default behavior when `onRename` is omitted: render the pencil button but make the rename a no-op (so the design gallery at `/dev/host/gen` keeps rendering without surfacing a half-broken affordance). Actually simpler: render the pencil only when `onRename` is a function. Gallery stays clean, prod surfaces it.

The pencil + input UI is a small inline subcomponent in `HostGenPick.tsx`, named `EditableTopicEyebrow`. Lives next to `QuestionCard` and `PickSidebar`. Owns its local `isEditing`, `draftValue`, and `inlineError`. Receives `value`, `onSave`, `isSaving` from the parent.

Why colocate vs extract to `components/system/`: this is one-off chrome for the Pick screen. If a second surface (Setup Overview, manual entry) needs the same affordance, extract then.

## 7. Testing plan

### 7.1 Unit (Vitest)

New file: `tests/unit/api-category-rename.test.ts`. Mirrors `tests/unit/api-category-manual.test.ts` style — mocks `@/lib/api/auth` and `@/lib/supabase/admin`, asserts:

1. **Happy path** — valid `{ name: "skirts" }` returns 200, calls `from("categories").update({ name: "skirts" })`, returns `{ category: { id, name } }`.
2. **Trims whitespace** — `{ name: "  skirts  " }` writes `"skirts"`.
3. **Empty rejected** — `{ name: "   " }` → 400.
4. **Over 80 chars rejected** → 400.
5. **Missing name rejected** → 400.
6. **Extra field rejected** — `{ name: "skirts", topic: "x" }` → 400 (Zod `.strict()`).
7. **Unauthed** — `requireOwnedCategory` returns 401 → 401.
8. **Wrong host** — returns 403 → 403.
9. **Unknown category** — returns 404 → 404.
10. **DB error** — Supabase update returns `error` → 500.
11. **Rename of a `ready` (locked) category** — succeeds; the rename is state-agnostic.

### 7.2 Manual smoke (preview deploy)

Documented in the PR body's "What to validate (human eyes)" section. See §10.

### 7.3 No new E2E

`tests/e2e/full-game.spec.ts` is a 300s end-to-end through prod; adding a rename step there would slow every CI run with no proportional benefit. The unit tests + manual smoke cover this PR.

## 8. Out-of-scope but worth noting

- **Setup Overview rename.** Same approach (pencil on hover over the slot card title) would work but requires solving the open-on-click conflict — wrap the title in a separate hit-target with `e.stopPropagation()`. Defer.
- **Realtime sync to a parallel host tab.** If the host has the Pick screen open on two devices simultaneously and renames on one, the other won't see the change until reload. Heather doesn't do this; ignore.
- **Audit log of rename events.** No table; the column overwrites. If a future PR wants undo, add a `category_renames` table.
- **Editing `topic`.** If the host wants Claude to re-generate against a new prompt, that's a separate "regenerate with new topic" feature: bigger blast radius (wipes questions, restarts generation, costs Anthropic credit).

## 9. File map

### New files

- `app/api/categories/[id]/route.ts` — `PATCH` handler. ~50 lines.
- `tests/unit/api-category-rename.test.ts` — 11 cases. ~200 lines.

### Edited files

- `lib/api/schemas.ts` — add `PatchCategoryBodySchema` + inferred type. ~10 lines added.
- `components/host/gen/HostGenPick.tsx` — add `onRename` / `isRenaming` props, swap the static eyebrow for `EditableTopicEyebrow`. ~80 lines net added.
- `app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient.tsx` — lift `categoryName` to state, add `handleRename` + `savingName`, pass to `HostGenPick`. ~30 lines net added.

### Untouched

- `app/host/setup/[nightId]/pick/[categoryId]/page.tsx` — already passes `owned.category.name`; that's still the initial value.
- `app/host/setup/[nightId]/HostSetupOverviewClient.tsx` — no change this PR.
- `supabase/migrations/*` — no schema change.
- Everything in `app/host/live/` — out of scope.

## 10. PR description scaffold — "What to validate (human eyes)"

The PR description must include:

```markdown
## What to validate (human eyes)

On the preview deploy URL (printed by Vercel in the PR check):

1. Sign in as founder at `/login` (`brandon@vyntechs.com`).
2. Create or open a night with at least one category. If you need a fresh
   one, run `scripts/full-flow-prod.mjs` from a separate shell and stop it
   after the "category locked" line.
3. Navigate to `/host/setup/<nightId>/pick/<categoryId>` for any category
   that's in `review` (20 questions ready to pick).
4. Confirm the pencil icon appears immediately after the category name in
   the header.
5. Click the pencil. The eyebrow becomes a text input. Type a new name.
   Press Enter.
6. Confirm: the eyebrow collapses back, the new name shows in uppercase,
   no error toast.
7. Reload the page. Confirm the new name persists (SSR re-fetched from DB).
8. Repeat for a category in state `ready` (already locked).
9. Lock a category and confirm rename still works after lock.
10. Click the pencil, clear the input completely, press Enter. Confirm
    inline error and the input stays open with the old value.
11. Click the pencil and press Escape. Confirm no save, eyebrow returns
    with the original value.
12. Click back to the Setup Overview. Confirm the slot card shows the new
    name.
```

## 11. Approval

This spec was written under Brandon's standing directive — "build without asking when spec + design exist; ask only on product/intent ambiguities" — by an agent during session 11 with full codebase context. The one product ambiguity (`name` vs `topic`) was resolved in §3 by tracing what each column actually drives in the live code.

If anything in §3 (column choice), §4.2 (no overview rename), or §4.3 (pencil-inline pick) is wrong for Heather, flag here before implementation begins.
