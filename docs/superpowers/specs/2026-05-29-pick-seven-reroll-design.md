# Pick-your-seven: reroll only the unpicked, no repeats

**Date:** 2026-05-29
**Status:** Approved (design), pending spec review
**Customer trigger:** Host the first host — "lock three of the questions in… I wanted to do another 20 but I don't wanna lose the ones I have."

---

## 1. Background — what the trace found

A 9-agent root-cause trace (adversarially verified) of the real route
`app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient.tsx` established:

- **The "regenerate wipes my picks" bug is already fixed at root.** Picks live in client
  state (`pickedIds` Set, `HostSetupPickClient.tsx:76-78`); `handleRegenerate` never touches
  that Set (`:292-325`); the post-regenerate refetch re-applies picks via
  `mergePickedAfterRefetch` (`:200`) instead of blindly resetting. The server appends and never
  deletes (`app/api/categories/[id]/generate/route.ts:172`, zero `.delete()`), so the picked
  rows persist and the merge keeps them. Confirmed by `tests/unit/mergePickedAfterRefetch.test.ts:26-36`.
  **the first host's literal "keep my 3, do another 20" already works.** No fix needed for that part.

- **The experience around it is the real gap:**
  1. **"Another 20" piles on instead of swapping.** Generate is append-only with no delete and a
     hardcoded `count: 20` (`generate/route.ts:153`, `:172`). Each reroll grows the candidate grid
     (20 → 40 → 60); `refetchQuestions` selects *all* category rows (`HostSetupPickClient.tsx:189`)
     and the grid renders all of them (`HostGenPick.tsx:333`).
  2. **It can repeat questions.** The generator is blind to history — `GenerateQuestionsOptions`
     has no field for existing/picked questions (`lib/ai/generate-questions.ts:101-115`); its only
     caller passes only topic/flavor/difficulty/count/theme (`generate/route.ts:149-155`); neither
     prompt carries an "avoid these" clause (`lib/ai/prompts.ts:30-31` forbids per-call data in the
     cacheable SYSTEM_PROMPT; `userPromptFor` emits only topic/difficulty/count/timer/flavor,
     `:252-267`). Same topic + temperature 0.7 (`generate-questions.ts:263`) ⇒ duplicates.

- **Lock is exactly 7**, enforced in three places (client cap `:256`, client lock gate `:265`,
  server `pick/route.ts:72-76` + schema `.length(7)`). **No partial-save exists** — picks are
  in-memory until a 7-lock; leaving the page loses them.

Notably, `mergePickedAfterRefetch.ts:10-12` already anticipates "a future regenerate that also
deletes the previous batch" — this design fulfills the contract the merge was written for.

## 2. Goal

When a host taps **"Another 20"** on the pick screen with some questions already picked:

1. Her picked questions stay selected. *(already true — must remain true)*
2. The questions she did **not** pick are **removed** and replaced with a **fresh pool** to
   choose from — the grid stays at roughly one screenful, not a growing pile.
3. The fresh pool **never repeats** a question she has already seen or kept in this category.
4. She picks her remaining slots from the fresh pool and locks at exactly 7, as today.

### Out of scope (explicit)
- **Save-for-later** (pick a few, leave, resume) — separate item, deferred per owner.
- **Locking fewer than 7** — stays a hard rule; the 100–700 board needs 7.
- **Cross-session/whole-history dedup** — we avoid repeating the questions currently on screen
  (seen + kept). We do *not* keep a permanent tombstone of every question ever rejected across
  many rerolls. YAGNI; revisit only if the first host reports repeats across multiple rerolls.

## 3. Behavior spec (the first host's flow)

Given a category in `review` with 20 candidates, 3 of which she has picked:

1. She taps **"Another 20"**.
2. Her 3 picked cards stay highlighted; the screen stays on the pick view (existing
   `regenerating` flag, `HostSetupPickClient.tsx:299-302`).
3. The server generates 20 fresh questions, **told not to repeat any of the 20 she just saw**
   (including her 3 kept), inserts them, then **deletes the 17 unpicked** old candidates.
4. The grid refreshes (existing broadcast → refetch path) to show **her 3 + 20 fresh = 23**
   candidates, none repeating what she saw.
5. She picks 4 more and locks at 7.

If she had picked **0**, "Another 20" replaces the whole pool with a fresh, non-repeating 20.

## 4. Technical design — three connected changes

Small, well-bounded units. One new pure helper carries the only non-trivial logic so it can be
unit-tested in isolation.

### 4a. Client sends the kept ids (`HostSetupPickClient.tsx`)
`handleRegenerate` (`:292-325`) already POSTs to `/api/categories/[id]/generate`. Add the kept
ids to the body:

```
body: { flavor, difficulty, keptIds: Array.from(pickedIds) }
```

First-time generation (from `draft`) has no picks and continues to send no `keptIds`.

### 4b. Generate body schema (`lib/api/schemas.ts`)
`GenerateCategoryBodySchema` (`:163-168`) gains an optional, distinct UUID array:

```
keptIds: z.array(UuidSchema).optional()
```

`keptIds` **present** (even empty) signals a reroll with swap semantics. **Absent** preserves
today's append-only behavior (first generation; nothing to delete anyway).

### 4c. New pure helper — `lib/host/rerollPlan.ts`
Computes the swap plan from the current rows + kept ids. No I/O, fully unit-testable.

```
rerollPlan(
  existing: ReadonlyArray<{ id: string; prompt: string; is_picked: boolean }>,
  keptIds: ReadonlyArray<string>,
): { keepIds: string[]; deleteIds: string[]; avoidPrompts: string[] }
```

- `keepIds` = ids in `existing` that are in `keptIds` **or** `is_picked` (defensive union).
- `deleteIds` = ids in `existing` **not** in `keepIds` (the unpicked candidates to remove).
- `avoidPrompts` = prompts of **all** `existing` rows (everything she has already seen).

### 4d. Generate route — generate-first, then delete (`app/api/categories/[id]/generate/route.ts`)
Inside the background `after()` job, when `keptIds` is present:

1. Fetch existing category rows (`id, prompt, is_picked`).
2. `const { deleteIds, avoidPrompts } = rerollPlan(existing, keptIds)`.
3. `generateQuestions({ …, count: 20, avoidPrompts })`.
4. **Insert** the fresh 20 (unchanged path, `:172`).
5. **Only after a successful insert**, `delete().in('id', deleteIds)` (scoped to this category).
   Ordering matters: if generation/insert fails, **nothing is deleted** — she keeps her full
   screen and gets the existing error toast. Never leave her with an empty pool.
6. Photo attach + `done` broadcast as today. The existing `done` → `refetchQuestions` makes the
   deleted rows disappear from the grid (no new "removed" broadcast needed; the refetch re-reads
   all rows). `mergePickedAfterRefetch` keeps her picks because their rows were spared (`:200`,
   merge keeps ids whose rows still exist).

### 4e. Generator exclusion (`lib/ai/generate-questions.ts` + `lib/ai/prompts.ts`)
- `GenerateQuestionsOptions` (`:101-115`) gains `avoidPrompts?: string[]`.
- `userPromptFor` (`prompts.ts:239-269`) gains the same param and, when non-empty, appends a
  clear instruction to the **user** prompt (not SYSTEM_PROMPT, which must stay cacheable per
  `:30-31`): e.g. *"Do not repeat or closely paraphrase any of these already-shown questions:"*
  followed by the list. Temperature and tool-choice unchanged.

## 5. Failure modes considered
- **Generation fails mid-reroll** → delete never runs (step 5 gated on insert success); host keeps
  her existing pool + picks + error toast. No data loss.
- **Stale `keptId`** (id not in the category) → ignored: `rerollPlan` only keeps ids present in
  `existing`; ownership is already gated by `requireOwnedCategory`.
- **Concurrent rerolls** → category state guard already 409s while `generating`
  (`generate/route.ts:58-64`), so a second reroll can't interleave.
- **Pool size after reroll** ≈ kept (≤7) + 20 ≈ 23 cards — within today's grid behavior; no new
  scaling concern, and strictly smaller than the unbounded 40/60 it replaces.
- **Unique `(category_id, point_value)`** constraint (`0001_init.sql:105`) is safe: pre-lock all
  `point_value` are NULL and Postgres treats NULLs as distinct.

## 6. Testing plan
- **Unit (TDD, red → green):**
  - `tests/unit/rerollPlan.test.ts` — kept survive; unpicked go to `deleteIds`; `avoidPrompts`
    covers all seen; empty `keptIds` deletes all; defensive `is_picked` union.
  - `lib/ai/prompts` — `userPromptFor` includes the avoid list when provided, omits it when not.
  - Confirm `mergePickedAfterRefetch` still keeps picks when unpicked rows are absent
    (existing drop-orphans case `:53-61` already covers the shape).
- **Full-flow gate (required, game-state):** extend `scripts/full-flow-prod.mjs` (or a sibling
  script) to: build a category, pick 3, reroll, then assert against prod Supabase — the 3 kept
  ids survive, the prior unpicked ids are gone, the new prompts don't duplicate the kept/seen
  prompts, and the pool is kept + ~20.
- **Real-route browser pass (not the dev gallery):** drive `/host/setup/.../pick/...`, pick 3,
  "Another 20", screenshot that the 3 stay and the pile doesn't grow.

## 7. Files touched
| File | Change |
|------|--------|
| `app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient.tsx` | send `keptIds` in reroll POST |
| `lib/api/schemas.ts` | optional `keptIds` on `GenerateCategoryBodySchema` |
| `lib/host/rerollPlan.ts` | **new** pure helper (keep/delete/avoid) |
| `app/api/categories/[id]/generate/route.ts` | generate-first-then-delete reroll path |
| `lib/ai/generate-questions.ts` | `avoidPrompts` option |
| `lib/ai/prompts.ts` | `userPromptFor` emits the avoid list |
| `tests/unit/rerollPlan.test.ts` | **new** |
| `scripts/full-flow-prod.mjs` (or sibling) | reroll assertion in the gate |

## 8. Constraints honored
- PR-first; Brandon validates + merges. No push to `main`.
- Game-state change ⇒ `scripts/full-flow-prod.mjs` green before PR is ready.
- Verify on the **real** route, never the `/dev` gallery (it has no state owner).
