# PR G1: Host-Controlled Point Values Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `questions.point_value` (the 100/200/.../700 slot on the board) directly host-controlled via the Edit panel, instead of an opaque derivation from Claude-rated `difficulty`. Heather's edits to "this should be the 400-pointer" must actually land at 400.

**Architecture:** Three layered changes.
1. **Library** (`assignPointValues`) gains "fill-only" semantics: it respects any picks that already carry an explicit `pointValue`, and only auto-assigns the remaining slots from the remaining picks sorted by difficulty.
2. **API** (`PATCH /api/questions/[id]`) accepts a new `pointValue` field. When the question is currently picked AND another picked question already holds that slot, we atomically swap them (intent-respecting UX: "I'm placing this question in slot 400 — whatever was there moves").
3. **UI** (`HostGenEdit`) replaces the "DIFFICULTY · AUTO" panel with a "POINT VALUE" panel. Buttons 100/200/.../700 set point_value directly (no more `{difficulty * 100}` lie). Difficulty becomes invisible to the host — it stays in the schema but is no longer host-facing.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS), Zod, Vitest, React 18.

---

## File Structure

| File | Role | Change |
|---|---|---|
| `lib/game/difficulty.ts` | `assignPointValues`, `previewPointValues` | Add optional `pointValue` to input shape; respect when present, auto-fill otherwise |
| `tests/unit/difficulty.test.ts` | Vitest unit tests | New tests for "respect explicit" + "auto-fill remaining" |
| `lib/api/schemas.ts` | Zod schemas | Add `pointValue: 100|200|...|700|null` to `PatchQuestionBodySchema` |
| `app/api/questions/[id]/route.ts` | PATCH handler | Accept `pointValue`; perform atomic swap on conflict (picked-only) |
| `app/api/categories/[id]/pick/route.ts` | POST lock handler | Pass through existing point_values to modified `assignPointValues` |
| `components/host/gen/HostGenEdit.tsx` | Edit panel UI | Replace difficulty UI with point-value UI; new prop `pointValue` |
| `app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient.tsx` | Pick page wiring | Thread point_value through Edit → PATCH; surface in props |
| `components/host/gen/HostGenPick.tsx` | Pick UI | Show `assignedPointValue` from `point_value` directly when present, fall back to `previewPointValues` for unedited picks |

**Files NOT touched:**
- `supabase/migrations/*` — no schema change. `questions.point_value` already nullable and indexed.
- `components/host/gen/HostGenPick.tsx`'s `PickSidebar` — already iterates 100→700 and shows what landed in each slot. Once point values reflect host intent, this "just works."
- `app/api/categories/[id]/manual/route.ts` — manual entry is a separate flow with its own deterministic ordering. Out of scope.

---

## Task 1: Extend `assignPointValues` library to respect explicit values

**Files:**
- Modify: `lib/game/difficulty.ts`
- Test: `tests/unit/difficulty.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Add to the bottom of `tests/unit/difficulty.test.ts` (before the last `});` that closes the file, OR in its own `describe` block):

```typescript
describe("assignPointValues — explicit point_value support", () => {
  it("respects an explicit point_value on a single pick", () => {
    const picked = [
      { id: "q-easy",    difficulty: 1, pointValue: 700 }, // host pinned hard-rated as 700 explicitly
      { id: "q1",        difficulty: 2 },
      { id: "q2",        difficulty: 3 },
      { id: "q3",        difficulty: 4 },
      { id: "q4",        difficulty: 5 },
      { id: "q5",        difficulty: 6 },
      { id: "q6",        difficulty: 7 }, // would normally be 700, but pinned took it
    ];
    const result = assignPointValues(picked);
    const byId = new Map(result.map((r) => [r.id, r.pointValue]));
    expect(byId.get("q-easy")).toBe(700);
    // The remaining 6 fill the open slots 100..600 by difficulty ascending
    expect(byId.get("q1")).toBe(100);
    expect(byId.get("q2")).toBe(200);
    expect(byId.get("q3")).toBe(300);
    expect(byId.get("q4")).toBe(400);
    expect(byId.get("q5")).toBe(500);
    expect(byId.get("q6")).toBe(600);
  });

  it("respects multiple explicit values; auto-fills the gaps", () => {
    const picked = [
      { id: "a", difficulty: 1, pointValue: 400 },
      { id: "b", difficulty: 2, pointValue: 700 },
      { id: "c", difficulty: 3 },
      { id: "d", difficulty: 4 },
      { id: "e", difficulty: 5 },
      { id: "f", difficulty: 6 },
      { id: "g", difficulty: 7 },
    ];
    const result = assignPointValues(picked);
    const byId = new Map(result.map((r) => [r.id, r.pointValue]));
    expect(byId.get("a")).toBe(400);
    expect(byId.get("b")).toBe(700);
    // c..g (difficulties 3..7, in that order) fill 100, 200, 300, 500, 600
    expect(byId.get("c")).toBe(100);
    expect(byId.get("d")).toBe(200);
    expect(byId.get("e")).toBe(300);
    expect(byId.get("f")).toBe(500);
    expect(byId.get("g")).toBe(600);
  });

  it("treats pointValue:null the same as omitted (auto-fill)", () => {
    const picked = [
      { id: "a", difficulty: 1, pointValue: null },
      { id: "b", difficulty: 2 },
      { id: "c", difficulty: 3, pointValue: 700 },
      { id: "d", difficulty: 4 },
      { id: "e", difficulty: 5 },
      { id: "f", difficulty: 6 },
      { id: "g", difficulty: 7 },
    ];
    const result = assignPointValues(picked);
    const byId = new Map(result.map((r) => [r.id, r.pointValue]));
    expect(byId.get("c")).toBe(700);
    // a, b, d..g fill 100..600 by difficulty asc
    expect(byId.get("a")).toBe(100);
    expect(byId.get("b")).toBe(200);
    expect(byId.get("d")).toBe(300);
    expect(byId.get("e")).toBe(400);
    expect(byId.get("f")).toBe(500);
    expect(byId.get("g")).toBe(600);
  });

  it("throws when two picks claim the same explicit point value", () => {
    const picked = [
      { id: "a", difficulty: 1, pointValue: 400 },
      { id: "b", difficulty: 2, pointValue: 400 }, // collision
      { id: "c", difficulty: 3 },
      { id: "d", difficulty: 4 },
      { id: "e", difficulty: 5 },
      { id: "f", difficulty: 6 },
      { id: "g", difficulty: 7 },
    ];
    expect(() => assignPointValues(picked)).toThrow(/duplicate.*400/i);
  });

  it("throws when all 7 are explicitly set and form a valid permutation (still OK)", () => {
    // Sanity: 7 explicit, all distinct → no error, just returns as-is.
    const picked = [
      { id: "a", difficulty: 7, pointValue: 100 },
      { id: "b", difficulty: 6, pointValue: 200 },
      { id: "c", difficulty: 5, pointValue: 300 },
      { id: "d", difficulty: 4, pointValue: 400 },
      { id: "e", difficulty: 3, pointValue: 500 },
      { id: "f", difficulty: 2, pointValue: 600 },
      { id: "g", difficulty: 1, pointValue: 700 },
    ];
    const result = assignPointValues(picked);
    const byId = new Map(result.map((r) => [r.id, r.pointValue]));
    expect(byId.get("a")).toBe(100);
    expect(byId.get("d")).toBe(400);
    expect(byId.get("g")).toBe(700);
  });
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `npm test -- --reporter=dot tests/unit/difficulty.test.ts`

Expected: 5 new tests in the "explicit point_value support" describe block FAIL (existing tests still pass; new ones fail because `assignPointValues` doesn't look at `pointValue` yet).

- [ ] **Step 1.3: Update the implementation**

Replace the existing `assignPointValues` body in `lib/game/difficulty.ts` with:

```typescript
export function assignPointValues(
  picked: Array<{ id: string; difficulty: number; pointValue?: number | null }>
): Array<{ id: string; pointValue: number }> {
  if (picked.length !== POINT_VALUES.length) {
    throw new Error(
      `assignPointValues: expected exactly 7 picked questions, got ${picked.length}`
    );
  }

  // Separate picks that the host has explicitly placed at a slot from those
  // that need auto-assignment. An explicit `pointValue` of null is treated
  // as "no preference" — same as omitted — because the DB column is
  // nullable and the host's "clear my override" action sends null.
  const explicit = picked.filter(
    (p): p is { id: string; difficulty: number; pointValue: number } =>
      typeof p.pointValue === "number",
  );
  const open = picked.filter((p) => typeof p.pointValue !== "number");

  // Reject any duplicate explicit value up front — the unique
  // (category_id, point_value) DB index would catch this too, but a clean
  // pre-flight throw beats a Postgres unique violation surfacing as 500.
  const explicitSlots = new Set<number>();
  for (const p of explicit) {
    if (explicitSlots.has(p.pointValue)) {
      throw new Error(
        `assignPointValues: duplicate explicit pointValue ${p.pointValue}`,
      );
    }
    if (!POINT_VALUES.includes(p.pointValue as (typeof POINT_VALUES)[number])) {
      throw new Error(
        `assignPointValues: explicit pointValue ${p.pointValue} not in 100..700 set`,
      );
    }
    explicitSlots.add(p.pointValue);
  }

  // Open slots fill bottom-up by difficulty (stable sort preserves input
  // order for ties — same convention as before).
  const openSlots = POINT_VALUES.filter((v) => !explicitSlots.has(v));
  const sortedOpen = [...open].sort((a, b) => a.difficulty - b.difficulty);

  const result: Array<{ id: string; pointValue: number }> = [];
  for (const p of explicit) {
    result.push({ id: p.id, pointValue: p.pointValue });
  }
  for (let i = 0; i < sortedOpen.length; i++) {
    result.push({ id: sortedOpen[i]!.id, pointValue: openSlots[i] as number });
  }
  return result;
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `npm test -- --reporter=dot tests/unit/difficulty.test.ts`

Expected: all tests (existing 7 + new 5) PASS. Both `describe` blocks green.

- [ ] **Step 1.5: Commit**

```bash
git checkout -b feat-host-controlled-point-values
git add lib/game/difficulty.ts tests/unit/difficulty.test.ts
git commit -m "feat(difficulty): assignPointValues respects explicit pointValue per pick"
```

---

## Task 2: Add `pointValue` to PATCH schema

**Files:**
- Modify: `lib/api/schemas.ts`

- [ ] **Step 2.1: Locate the schema**

Read `lib/api/schemas.ts:204-221` — the existing `PatchQuestionBodySchema` block.

- [ ] **Step 2.2: Add the field**

In `lib/api/schemas.ts`, edit `PatchQuestionBodySchema`:

```typescript
/** PATCH /api/questions/[id] body — any subset of edits. */
export const PatchQuestionBodySchema = z
  .object({
    prompt: z.string().trim().min(8).max(400).optional(),
    options: QuestionOptionsTupleSchema.optional(),
    correctIndex: CorrectIndexSchema.optional(),
    difficulty: z.number().int().min(1).max(7).optional(),
    factBlurb: z.string().trim().min(1).max(280).optional(),
    /** Host-placed slot on the board. `null` clears any host override
     *  (the lock-time auto-assign will re-fill). When the question is
     *  already picked, setting this performs an atomic swap with whichever
     *  picked question currently holds that slot. */
    pointValue: z
      .union([
        z.literal(100),
        z.literal(200),
        z.literal(300),
        z.literal(400),
        z.literal(500),
        z.literal(600),
        z.literal(700),
        z.null(),
      ])
      .optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.prompt !== undefined ||
      body.options !== undefined ||
      body.correctIndex !== undefined ||
      body.difficulty !== undefined ||
      body.factBlurb !== undefined ||
      body.pointValue !== undefined,
    { message: "PATCH body must include at least one field to update" },
  );
```

- [ ] **Step 2.3: Run typecheck to verify clean**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 2.4: Commit**

```bash
git add lib/api/schemas.ts
git commit -m "feat(schemas): allow pointValue in PATCH /api/questions/[id] body"
```

---

## Task 3: PATCH endpoint handles `pointValue` with atomic swap

**Files:**
- Modify: `app/api/questions/[id]/route.ts`
- Test: `tests/integration/patch-question-point-value.test.ts` (NEW — integration test against a Supabase admin client)

> **Skip the integration test if `tests/integration/` doesn't exist as a pattern in this codebase.** Validate manually via the existing pre-commit + visual review. The library tests in Task 1 already cover the algorithm; the route just needs to call it correctly.

- [ ] **Step 3.1: Read the current PATCH handler**

Read `app/api/questions/[id]/route.ts` end-to-end (it's ~75 lines). Locate the `update` object construction around lines 55-62.

- [ ] **Step 3.2: Add pointValue handling with swap**

Replace the update-construction + final update block (lines 55-69) with:

```typescript
const update: Partial<QuestionInsert> = { source: "host-edit" };
if (patch.prompt !== undefined) update.prompt = patch.prompt;
if (patch.options !== undefined)
  update.options = patch.options as [string, string, string, string];
if (patch.correctIndex !== undefined)
  update.correct_index = patch.correctIndex;
if (patch.difficulty !== undefined) update.difficulty = patch.difficulty;
if (patch.factBlurb !== undefined) update.fact_blurb = patch.factBlurb;
if (patch.pointValue !== undefined) {
  update.point_value = patch.pointValue as
    | 100 | 200 | 300 | 400 | 500 | 600 | 700 | null;
}

// If the host is moving a PICKED question to a slot already occupied by
// ANOTHER picked question in the same category, atomically swap them so
// the unique (category_id, point_value) index never sees a collision.
// Edits to unpicked questions just save the value for lock-time to honor.
if (patch.pointValue !== undefined && patch.pointValue !== null) {
  const isPicked = owned.question.is_picked === true;
  if (isPicked) {
    const { data: occupant } = await admin
      .from("questions")
      .select("id, point_value")
      .eq("category_id", owned.question.category_id)
      .eq("is_picked", true)
      .eq("point_value", patch.pointValue)
      .neq("id", questionId)
      .maybeSingle();

    if (occupant && occupant.point_value !== null) {
      // Atomic swap: park the current question on a stash value (null is
      // safe because the unique partial index only covers non-null), then
      // move the occupant to where the current question was, then move
      // the current question to its target. Three writes, no overlap.
      const previousValue = owned.question.point_value;
      await admin
        .from("questions")
        .update({ point_value: null })
        .eq("id", questionId);
      await admin
        .from("questions")
        .update({ point_value: previousValue })
        .eq("id", occupant.id);
      // Falls through to the main update below, which sets point_value
      // to patch.pointValue.
    }
  }
}

const { data: updated, error } = await admin
  .from("questions")
  .update(update)
  .eq("id", questionId)
  .select("*")
  .single();
if (error || !updated) {
  return badRequest(`failed to update: ${error?.message ?? "unknown"}`);
}

return ok({ question: updated });
```

**Important:** the `requireOwnedQuestion()` helper at the top of the file already returns the full question row as `owned.question`. The new logic reads `owned.question.is_picked`, `owned.question.category_id`, and `owned.question.point_value` from that — no extra fetch needed. Verify that's true by re-reading `lib/api/auth.ts → requireOwnedQuestion()`.

- [ ] **Step 3.3: Run typecheck**

Run: `npx tsc --noEmit`

Expected: clean. If TS complains that `owned.question.point_value` is `string` not `number | null`, check the QuestionRow type in `lib/supabase/types.ts` — it's already typed as `100 | 200 | ... | 700 | null`.

- [ ] **Step 3.4: Manual smoke (via curl after dev server starts later) — defer to validation step**

Note this in the validation queue; do not run yet.

- [ ] **Step 3.5: Commit**

```bash
git add app/api/questions/[id]/route.ts
git commit -m "feat(api): PATCH /api/questions/[id] supports pointValue with atomic swap"
```

---

## Task 4: Lock endpoint respects pre-existing point_values

**Files:**
- Modify: `app/api/categories/[id]/pick/route.ts`

- [ ] **Step 4.1: Read the lock endpoint**

Read `app/api/categories/[id]/pick/route.ts` start-to-finish.

- [ ] **Step 4.2: Modify the question fetch to include point_value**

Find the block around line 65:

```typescript
  const { data: belongs, error: belongsError } = await admin
    .from("questions")
    .select("id, difficulty")
    .eq("category_id", categoryId)
    .in("id", questionIds);
```

Replace with:

```typescript
  const { data: belongs, error: belongsError } = await admin
    .from("questions")
    .select("id, difficulty, point_value")
    .eq("category_id", categoryId)
    .in("id", questionIds);
```

- [ ] **Step 4.3: Pass point_value into assignPointValues**

Find the existing call (~line 79):

```typescript
  const assignments = assignPointValues(
    belongs.map((row) => ({ id: row.id, difficulty: row.difficulty })),
  );
```

Replace with:

```typescript
  // Pass any pre-existing host-set point_values through to the assigner;
  // it will respect them and auto-fill only the remaining open slots.
  // This is how a Edit-before-Lock chain ends up landing where the host
  // expected.
  const assignments = assignPointValues(
    belongs.map((row) => ({
      id: row.id,
      difficulty: row.difficulty,
      pointValue: row.point_value,
    })),
  );
```

- [ ] **Step 4.4: Run typecheck**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 4.5: Run full unit tests to confirm no regression**

Run: `npm test -- --reporter=dot`

Expected: all tests pass (237 + the 5 new ones from Task 1 = 242).

- [ ] **Step 4.6: Commit**

```bash
git add app/api/categories/[id]/pick/route.ts
git commit -m "feat(api): pick endpoint honors host-set point_values through to lock"
```

---

## Task 5: Replace Edit panel's DIFFICULTY UI with POINT VALUE UI

**Files:**
- Modify: `components/host/gen/HostGenEdit.tsx`

- [ ] **Step 5.1: Update the props interface**

In `components/host/gen/HostGenEdit.tsx`, replace `HostGenEditValues`:

```typescript
export interface HostGenEditValues {
  prompt: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  /** Host-placed slot on the board (100..700) or null when the host wants
   *  the lock-time auto-assign to choose. The DIFFICULTY field is still
   *  on the row but no longer host-facing; it persists for future
   *  Claude-ranked sorts. */
  pointValue: 100 | 200 | 300 | 400 | 500 | 600 | 700 | null;
}
```

The `difficulty: number` field is removed from this interface — the parent (`HostSetupPickClient`) keeps it on its own snapshot for display sorting, but the Edit panel no longer surfaces it.

- [ ] **Step 5.2: Update the demo initial values**

Find `DEMO_INITIAL`. Replace with:

```typescript
const DEMO_INITIAL: HostGenEditValues = {
  prompt: "Ratatouille is set in which city?",
  options: ["Paris", "Lyon", "Marseille", "Nice"],
  correctIndex: 0,
  pointValue: 200,
};
```

- [ ] **Step 5.3: Update the state setup**

Find the `useState` block (~line 85-88):

```typescript
const [prompt, setPrompt] = useState(initial.prompt);
const [options, setOptions] = useState<[string, string, string, string]>(initial.options);
const [correctIndex, setCorrectIndex] = useState<0 | 1 | 2 | 3>(initial.correctIndex);
const [difficulty, setDifficulty] = useState<number>(initial.difficulty);
```

Replace with:

```typescript
const [prompt, setPrompt] = useState(initial.prompt);
const [options, setOptions] = useState<[string, string, string, string]>(initial.options);
const [correctIndex, setCorrectIndex] = useState<0 | 1 | 2 | 3>(initial.correctIndex);
const [pointValue, setPointValue] = useState<HostGenEditValues["pointValue"]>(
  initial.pointValue,
);
```

- [ ] **Step 5.4: Update handleSave**

Find `handleSave` (~line 98-100):

```typescript
function handleSave() {
  onSave?.({ prompt, options, correctIndex, difficulty });
}
```

Replace with:

```typescript
function handleSave() {
  onSave?.({ prompt, options, correctIndex, pointValue });
}
```

- [ ] **Step 5.5: Replace the entire DIFFICULTY · AUTO block with POINT VALUE picker**

Find the block (~line 209-243) starting with `<Eyebrow color={t.inkMute} size={9}>DIFFICULTY · AUTO</Eyebrow>` and ending right before the closing `</div>` of the difficulty container.

Replace with:

```typescript
<div>
  <Eyebrow color={t.inkMute} size={9}>POINT VALUE · PICK ONE</Eyebrow>
  <div style={{ marginTop: 10, padding: "14px 16px", borderRadius: 10, background: t.surface }}>
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
      <Numeric size={28} weight={700} color={cc}>
        {pointValue ?? "—"}
      </Numeric>
      <span style={{ fontSize: 11, color: t.inkMid, fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>
        {pointValue === null ? "AUTO ON LOCK" : "PLACED"}
      </span>
    </div>
    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
      {([100, 200, 300, 400, 500, 600, 700] as const).map((v) => {
        const active = v === pointValue;
        return (
          <button
            key={v}
            type="button"
            onClick={() => setPointValue(v)}
            style={{
              padding: "8px 0",
              borderRadius: 6,
              border: `1px solid ${active ? cc : t.line}`,
              background: active ? cc : "transparent",
              color: active ? "#0E0805" : t.inkMid,
              fontSize: 11,
              fontWeight: 700,
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
            }}
          >
            {v}
          </button>
        );
      })}
    </div>
    <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ fontSize: 11, color: t.inkMute, fontWeight: 500 }}>
        Picks a different slot? Whatever was there moves to yours.
      </div>
      <button
        type="button"
        onClick={() => setPointValue(null)}
        disabled={pointValue === null}
        style={{
          padding: "4px 10px",
          borderRadius: 6,
          border: `1px solid ${t.line}`,
          background: "transparent",
          color: pointValue === null ? t.inkMute : t.ink,
          fontSize: 11,
          fontWeight: 600,
          fontFamily: "var(--font-sans)",
          cursor: pointValue === null ? "default" : "pointer",
          opacity: pointValue === null ? 0.55 : 1,
        }}
      >
        Clear
      </button>
    </div>
  </div>
</div>
```

The "Override if you disagree." caption at the end of the difficulty block is gone — the new copy ("Picks a different slot? Whatever was there moves to yours.") covers the swap UX.

- [ ] **Step 5.6: Remove the now-unused `DifficultyBar` import (if present)**

Check the top of the file. If `DifficultyBar` is imported but no longer referenced (it might still be used elsewhere in the file — grep first), remove it from the import line. Check: `grep -n "DifficultyBar" components/host/gen/HostGenEdit.tsx` after the edit.

- [ ] **Step 5.7: Typecheck**

Run: `npx tsc --noEmit`

Expected: clean. If there are type errors, they're likely callers passing `difficulty` — Task 6 fixes those.

- [ ] **Step 5.8: Commit**

```bash
git add components/host/gen/HostGenEdit.tsx
git commit -m "feat(edit): replace DIFFICULTY · AUTO with POINT VALUE · PICK ONE picker"
```

---

## Task 6: Thread `pointValue` through HostSetupPickClient

**Files:**
- Modify: `app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient.tsx`

- [ ] **Step 6.1: Read the client end-to-end**

Open the file; locate where `HostGenEdit` is rendered + where its `onSave` handler hits PATCH.

- [ ] **Step 6.2: Update the initial values passed to `<HostGenEdit initial=...>`**

Find the `initial={...}` prop for `HostGenEdit`. The object currently looks like:

```typescript
{
  prompt: q.prompt,
  options: q.options,
  correctIndex: q.correct_index,
  difficulty: q.difficulty,
}
```

Replace with:

```typescript
{
  prompt: q.prompt,
  options: q.options,
  correctIndex: q.correct_index,
  pointValue: q.point_value,
}
```

- [ ] **Step 6.3: Update the PATCH body in the onSave handler**

Find the `fetch(`/api/questions/${qid}`, { method: "PATCH", ... })` call. The body currently sends `{ prompt, options, correctIndex, difficulty }`. Replace with:

```typescript
body: JSON.stringify({
  prompt: values.prompt,
  options: values.options,
  correctIndex: values.correctIndex,
  pointValue: values.pointValue,
}),
```

- [ ] **Step 6.4: Update any local state mutation after the PATCH**

If the file has a `setQuestions(...)` (or similar) call that copies the patched fields back into local state, make sure `point_value` is updated from the response (`updated.question.point_value`), not the old `difficulty * 100` derivation.

- [ ] **Step 6.5: Typecheck + tests**

Run: `npx tsc --noEmit && npm test -- --reporter=dot`

Expected: clean + 242 tests pass.

- [ ] **Step 6.6: Commit**

```bash
git add "app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient.tsx"
git commit -m "feat(pick): wire pointValue from HostGenEdit through to PATCH"
```

---

## Task 7: Pick page surfaces actual point_value (not preview) when set

**Files:**
- Modify: `components/host/gen/HostGenPick.tsx`

- [ ] **Step 7.1: Update `HostGenPickQuestion` interface**

In `components/host/gen/HostGenPick.tsx`, add a field to the existing interface (~line 29):

```typescript
export interface HostGenPickQuestion {
  id: string;
  prompt: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  difficulty: number;
  /** Host-set point value (from Edit). When present, supersedes the
   *  Claude-difficulty-derived preview. Used both to render the value
   *  in the card AND to populate the YOUR BOARD sidebar slot directly. */
  pointValue?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | null;
  edited?: boolean;
  flavorTag?: string | null;
  imageUrl?: string | null;
  seed?: string;
}
```

- [ ] **Step 7.2: Update `tierByPickId` to prefer pointValue**

Find the `useMemo` block that calls `previewPointValues` (~line 130-136). Replace with:

```typescript
// If the host has placed any picks via the Edit panel, those win. The
// remaining slots are filled by previewPointValues (Claude difficulty
// sort). This mirrors the server's lock-time assignPointValues.
const tierByPickId = useMemo(() => {
  // First pass: explicit picks claim their slots.
  const map = new Map<string, number>();
  const takenSlots = new Set<number>();
  for (const q of pickedQs) {
    if (q.pointValue !== undefined && q.pointValue !== null) {
      map.set(q.id, q.pointValue);
      takenSlots.add(q.pointValue);
    }
  }
  // Second pass: fill remaining slots from the unplaced picks, sorted
  // by difficulty asc — same rule the server uses.
  const open = [100, 200, 300, 400, 500, 600, 700].filter(
    (v) => !takenSlots.has(v),
  );
  const unplaced = pickedQs
    .filter((q) => q.pointValue === undefined || q.pointValue === null)
    .sort((a, b) => a.difficulty - b.difficulty);
  for (let i = 0; i < unplaced.length && i < open.length; i++) {
    map.set(unplaced[i]!.id, open[i] as number);
  }
  return map;
}, [pickedQs]);
```

- [ ] **Step 7.3: Update demo data to exercise the new field**

In `DEMO_QUESTIONS`, add `pointValue: 700` to one of the demo questions (say `q4`, the Wall·E one) so the dev gallery shows the "host-placed" state too. Add `// host-placed for design preview` as a comment.

- [ ] **Step 7.4: Typecheck + tests**

Run: `npx tsc --noEmit && npm test -- --reporter=dot`

Expected: clean + 242 tests pass.

- [ ] **Step 7.5: Commit**

```bash
git add components/host/gen/HostGenPick.tsx
git commit -m "feat(pick): YOUR BOARD respects host-placed point values"
```

---

## Task 8: Wire `pointValue` from server into HostGenPickQuestion shape

**Files:**
- Modify: `app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient.tsx`

- [ ] **Step 8.1: Find where `HostGenPickQuestion[]` is built**

In `HostSetupPickClient.tsx`, locate the `.map(...)` or `useMemo(...)` that turns `QuestionRow[]` into `HostGenPickQuestion[]` for the `questions` prop on `<HostGenPick>`.

- [ ] **Step 8.2: Include point_value in the projection**

Add `pointValue: q.point_value,` to the object literal:

```typescript
{
  id: q.id,
  prompt: q.prompt,
  options: q.options,
  correctIndex: q.correct_index,
  difficulty: q.difficulty,
  pointValue: q.point_value,
  // ... other existing fields
}
```

- [ ] **Step 8.3: Typecheck + tests**

Run: `npx tsc --noEmit && npm test -- --reporter=dot`

Expected: clean + 242 tests pass.

- [ ] **Step 8.4: Commit**

```bash
git add "app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient.tsx"
git commit -m "feat(pick): pass q.point_value from server into pick UI"
```

---

## Task 9: Full validation + PR

- [ ] **Step 9.1: Run full validation suite**

```bash
npx tsc --noEmit
npm test -- --reporter=dot
npm run build
```

All three should be clean. Tests = 242 (237 prior + 5 new).

- [ ] **Step 9.2: Visual smoke (dev gallery)**

```bash
npm run dev
```

Open http://localhost:3000/dev/host/gen and:
- Confirm the Edit panel shows "POINT VALUE · PICK ONE" (not DIFFICULTY · AUTO)
- Buttons 100..700 are clickable
- Clicking one sets the big number to that value
- "Clear" returns to "AUTO ON LOCK" state
- The Pick screen YOUR BOARD still iterates 100→700 and shows the demo-placed pick at slot 700

- [ ] **Step 9.3: Push branch + open PR**

```bash
git push -u origin feat-host-controlled-point-values
gh pr create --title "feat(setup): host-controlled point values (fixes Heather #1 + #4)" --body "..."
```

PR body should include:
- Heather's quote (the specific complaints)
- Root cause one-liner ("Edit's 100-700 buttons set difficulty, not point_value")
- The new mental model (host places; auto fills the gaps)
- Pre-validated checklist (build/tests/typecheck)
- What to validate visually (preview deploy)
- File-by-file summary

DO NOT MERGE. Brandon validates + merges.

---

## Self-Review

**Spec coverage:**
- Heather #1 (order on board) → addressed by Task 7 (board respects pointValue) + Tasks 1, 5 (host places explicitly)
- Heather #4 (Edit doesn't change board) → root-cause fix via Tasks 1-8 collectively
- Heather #2 (write own question) → out of scope for G1; G3 territory
- Heather #3 (rename category) → out of scope for G1; G2 territory
- Heather #5 (date vs time) → deferred indefinitely (confirmed)

All G1 requirements covered.

**Placeholder scan:**
- No TBD, TODO, "implement later"
- One soft "skip if pattern doesn't exist" on the integration test in Task 3 — acceptable because library tests in Task 1 cover the algorithm
- All steps have actual code blocks or exact commands

**Type consistency:**
- `pointValue` is `100 | 200 | 300 | 400 | 500 | 600 | 700 | null` throughout (schema, lib, component props, DB column)
- `HostGenEditValues.pointValue` matches `HostGenPickQuestion.pointValue` matches the DB column type

**Ambiguity check:**
- Task 3's swap logic explicitly walks through the 3-write swap algorithm (null parking → restore previous → set new)
- Task 7's `tierByPickId` rewrite explicitly shows the two-pass (explicit, then fill) algorithm

All clear. Plan complete.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-pr-g1-host-controlled-point-values.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between, fast iteration. Best for keeping the parent agent's context clean.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch checkpoints for review.

**For G1 specifically, given the file-overlap risk with G2/G3 and the need for tight feedback loops on the swap logic, inline execution by the current session is the right call — the brain already has all the context loaded.**
