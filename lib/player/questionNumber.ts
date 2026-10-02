import type { CategoryRow, QuestionRow } from "@/lib/supabase/types";

// "QUESTION N" on the phone = the Nth question played in this game, in the
// order the host picked them off the board. The old formula, position*7 +
// value/100, assumed categories were numbered from 0; they're numbered 1-6,
// so the first question read "QUESTION 8" and the last "QUESTION 49" of 42.
export function computeQuestionNumber(
  question: Pick<QuestionRow, "id" | "category_id" | "played_at">,
  categories: Pick<CategoryRow, "id" | "game_id">[],
  allQuestions: Pick<QuestionRow, "id" | "category_id" | "played_at">[],
): number {
  const gameOf = new Map(categories.map((c) => [c.id, c.game_id]));
  const gameId = gameOf.get(question.category_id);
  const playedAt = question.played_at ? Date.parse(question.played_at) : null;
  const playedBefore = allQuestions.filter(
    (q) =>
      q.id !== question.id &&
      q.played_at !== null &&
      gameOf.get(q.category_id) === gameId &&
      (playedAt === null || Date.parse(q.played_at) < playedAt),
  ).length;
  return playedBefore + 1;
}
