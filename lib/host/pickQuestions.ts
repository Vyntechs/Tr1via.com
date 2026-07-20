// Shared question-pick write-path. Extracted from POST /api/categories/[id]/pick
// so the founder "build a full game" auto-pick uses the EXACT same logic as a
// human pick — assign point values 100..700, atomically clear + set is_picked,
// flip the category to 'ready'.

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
 * Assign point values to exactly 7 picked questions and flip the category to
 * 'ready'. Caller must have already verified ownership + that the category is
 * in 'review'/'ready'. Same write sequence as the /pick route (clear-first,
 * per-row set, then mark ready) to stay safe against the
 * (category_id, point_value) unique index.
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
  questionIds: string[],
): Promise<PickResult> {
  const admin = getSupabaseAdmin();
  const prepared = await prepareQuestionAssignmentsForCategory(
    categoryId,
    questionIds,
  );
  if (!prepared.ok) return prepared;
  const assignments = prepared.picked;

  const { error: clearError } = await admin
    .from("questions")
    .update({ is_picked: false, point_value: null })
    .eq("category_id", categoryId);
  if (clearError) {
    return { ok: false, error: `failed to clear picks: ${clearError.message}` };
  }

  for (const { id, pointValue } of assignments) {
    const { error } = await admin
      .from("questions")
      .update({
        is_picked: true,
        point_value: pointValue as 100 | 200 | 300 | 400 | 500 | 600 | 700,
      })
      .eq("id", id);
    if (error) {
      await admin
        .from("questions")
        .update({ is_picked: false, point_value: null })
        .eq("category_id", categoryId);
      return { ok: false, error: `failed to pick question ${id}: ${error.message}` };
    }
  }

  const { error: stateError } = await admin
    .from("categories")
    .update({ state: "ready" })
    .eq("id", categoryId);
  if (stateError) {
    return { ok: false, error: `failed to mark ready: ${stateError.message}` };
  }

  return { ok: true, picked: assignments };
}
