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
 * Assign point values to exactly 7 picked questions and flip the category to
 * 'ready'. Caller must have already verified ownership + that the category is
 * in 'review'/'ready'. The database persists the clear, seven assignments,
 * and ready state as one fenced transaction.
 */
export async function prepareQuestionAssignmentsForCategory(
  categoryId: string,
  questionIds: string[],
  options: { honorPointOverrides?: boolean } = {},
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
      // Auto-build owns its difficulty ladder; manual picks keep host overrides.
      pointValue: options.honorPointOverrides === false ? null : row.point_value,
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
