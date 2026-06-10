// Board reorder write-path. Persists the host's drag-to-reorder of the
// "YOUR BOARD" sidebar by reassigning `questions.point_value` across the
// already-picked questions in a category.
//
// Why this is its own helper (mirroring lib/host/pickQuestions.ts): the
// (category_id, point_value) unique index is `deferrable initially deferred`,
// but supabase-js issues each `.update()` as its own auto-committed
// statement — so a naive A→200 while B still holds 200 trips the constraint
// even though it's deferrable. We use the same clear-first sequence the lock
// path uses: NULL out every row holding a target slot value (NULLs are exempt
// from the unique index, so they coexist freely), THEN set each card to its
// new slot. After the clear no row holds any target value, so the per-row
// sets can never collide.
//
// No migration is added on purpose: order persists via the existing
// point_value column, and a true single-transaction RPC would mean a
// migration this project has to apply by hand on deploy (a known footgun).

import { getSupabaseAdmin } from "@/lib/supabase/admin";

type PointValue = 100 | 200 | 300 | 400 | 500 | 600 | 700;

export type ReorderResult =
  | { ok: true; picked: Array<{ id: string; pointValue: number }> }
  | { ok: false; error: string };

/**
 * Reassign point values across the picked questions of a category to match a
 * new board order. Caller must have already verified ownership + that the
 * category is in 'review'/'ready'.
 *
 * `assignments` must list the cards in their new order with the point values
 * they should hold — the point values must be distinct and drawn from the
 * 100..700 set (enforced by the route's Zod schema). Every id must belong to
 * the category and be currently picked.
 */
export async function reorderBoardQuestions(
  categoryId: string,
  assignments: Array<{ id: string; pointValue: number }>,
): Promise<ReorderResult> {
  const admin = getSupabaseAdmin();
  const ids = assignments.map((a) => a.id);
  const values = assignments.map((a) => a.pointValue);

  // Fetch the FULL set of picked questions in this category and require the
  // reorder to cover exactly that set. The honest client always sends every
  // filled board card, so a request that names a non-picked / foreign id, or
  // is missing a picked card, is a stale or hand-crafted client. Reject it
  // loudly rather than silently orphaning a moved card's old slot to NULL.
  // (Belt-and-braces server validation, like requireOwned* vs RLS.)
  const { data: pickedRows, error: selError } = await admin
    .from("questions")
    .select("id")
    .eq("category_id", categoryId)
    .eq("is_picked", true);
  if (selError) {
    return { ok: false, error: `failed to verify questions: ${selError.message}` };
  }
  const pickedIds = new Set((pickedRows ?? []).map((r) => r.id));
  if (ids.some((id) => !pickedIds.has(id))) {
    return {
      ok: false,
      error: "reorder names a question that isn't picked in this category",
    };
  }
  if (ids.length !== pickedIds.size) {
    return {
      ok: false,
      error: `reorder must cover all ${pickedIds.size} picked questions, got ${ids.length}`,
    };
  }

  // Clear every row currently holding a target slot value (frees the slots so
  // the per-row sets below never transiently collide). This nulls the picked
  // cards being reordered and any stray holder of a target value.
  const { error: clearError } = await admin
    .from("questions")
    .update({ point_value: null })
    .eq("category_id", categoryId)
    .in("point_value", values);
  if (clearError) {
    return { ok: false, error: `failed to clear slots: ${clearError.message}` };
  }

  for (const { id, pointValue } of assignments) {
    const { error } = await admin
      .from("questions")
      .update({ point_value: pointValue as PointValue })
      .eq("id", id);
    if (error) {
      // Best-effort rollback to a collision-free state: null every target
      // value again. The board then re-derives slot order from difficulty on
      // the next refetch — a valid (if not the intended) order, never a
      // constraint-violating one.
      await admin
        .from("questions")
        .update({ point_value: null })
        .eq("category_id", categoryId)
        .in("point_value", values);
      return {
        ok: false,
        error: `failed to set slot ${pointValue}: ${error.message}`,
      };
    }
  }

  return { ok: true, picked: assignments };
}
