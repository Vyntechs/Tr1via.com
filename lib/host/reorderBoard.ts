// Board reorder write-path. The complete permutation is sent to one database
// transaction so Start can never observe the old clear-then-set middle.

import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type ReorderResult =
  | { ok: true; picked: Array<{ id: string; pointValue: number }> }
  | { ok: false; error: string };

/**
 * Reassign point values across the picked questions of a category to match a
 * new board order. The route verifies ownership for friendly errors; the
 * database independently verifies membership, completeness, distinct slots,
 * and that the game has not started.
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
  const { error } = await (admin.rpc as unknown as (
    name: "reorder_category_board",
    args: {
      p_category_id: string;
      p_assignments: Array<{ id: string; pointValue: number }>;
    },
  ) => PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>)("reorder_category_board", {
    p_category_id: categoryId,
    p_assignments: assignments,
  });
  if (error) {
    return {
      ok: false,
      error: error.message ?? "failed to reorder the board",
    };
  }

  return { ok: true, picked: assignments };
}
