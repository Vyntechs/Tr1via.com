// Shared board-assignment helpers. Auto-pick derives slots from difficulty;
// human lock validates category membership and preserves the exact assignments
// already displayed to the host. Both feed the same atomic database function.

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { assignPointValues } from "@/lib/game/difficulty";

export type PickResult =
  | { ok: true; picked: Array<{ id: string; pointValue: number }> }
  | { ok: false; error: string };

/**
 * Choose `count` question ids spread across difficulty so an auto-built board
 * spans easy→hard. Sorts ascending by difficulty (stable) and takes evenly
 * spaced indices. Pure + deterministic.
 */
export function selectSpreadQuestionIds(
  questions: Array<{ id: string; difficulty: number }>,
  count: number,
): string[] {
  if (questions.length < count) {
    throw new Error(
      `selectSpreadQuestionIds: need ${count}, have ${questions.length}`,
    );
  }
  const sorted = [...questions].sort((a, b) => a.difficulty - b.difficulty);
  if (questions.length === count) return sorted.map((q) => q.id);
  const chosen = new Set<string>();
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i * (sorted.length - 1)) / (count - 1));
    chosen.add(sorted[idx].id);
  }
  // Even-spacing can collide on rounding; backfill from the sorted pool.
  for (const q of sorted) {
    if (chosen.size === count) break;
    chosen.add(q.id);
  }
  return [...chosen];
}

/**
 * Derive point values for founder auto-pick. Human lock must not use this:
 * its displayed id-to-slot assignments are already authoritative.
 */
export async function prepareQuestionAssignmentsForCategory(
  categoryId: string,
  questionIds: string[],
): Promise<PickResult> {
  const admin = getSupabaseAdmin();

  const { data: belongs, error: belongsError } = await admin
    .from("questions")
    .select("id, difficulty, point_value")
    .eq("category_id", categoryId)
    .in("id", questionIds);
  if (belongsError) {
    return { ok: false, error: `failed to verify questions: ${belongsError.message}` };
  }
  if (!belongs || belongs.length !== 7) {
    return {
      ok: false,
      error: `expected 7 questions in this category, found ${belongs?.length ?? 0}`,
    };
  }

  const assignments = assignPointValues(
    belongs.map((row) => ({
      id: row.id,
      difficulty: row.difficulty,
      pointValue: row.point_value,
    })),
  );
  return { ok: true, picked: assignments };
}

export async function pickQuestionsForCategory(
  categoryId: string,
  assignments: Array<{ id: string; pointValue: number }>,
): Promise<PickResult> {
  const admin = getSupabaseAdmin();
  const questionIds = assignments.map((assignment) => assignment.id);
  const { data: belongs, error: belongsError } = await admin
    .from("questions")
    .select("id")
    .eq("category_id", categoryId)
    .in("id", questionIds);
  if (belongsError) {
    return {
      ok: false,
      error: `failed to verify questions: ${belongsError.message}`,
    };
  }
  const belongingIds = new Set((belongs ?? []).map((row) => row.id));
  if (
    belongingIds.size !== 7 ||
    questionIds.some((questionId) => !belongingIds.has(questionId))
  ) {
    return {
      ok: false,
      error: `expected 7 questions in this category, found ${belongingIds.size}`,
    };
  }

  const { error } = await (admin.rpc as unknown as (
    name: "apply_category_picks",
    args: {
      p_category_id: string;
      p_assignments: Array<{ id: string; pointValue: number }>;
    },
  ) => PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>)("apply_category_picks", {
    p_category_id: categoryId,
    p_assignments: assignments,
  });
  if (error) {
    return {
      ok: false,
      error: error.message ?? "failed to save picked questions",
    };
  }

  return { ok: true, picked: assignments };
}
