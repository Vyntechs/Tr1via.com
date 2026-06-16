import type { AnswerRow } from "@/lib/supabase/types";

/**
 * Sum a player's awarded points for ONE game.
 *
 * The player's `answers` span the WHOLE night (both games — see `useMyAnswers`,
 * which fetches every row for the device). The reveal screens must show only the
 * CURRENT game's running total so the phone matches the TV's per-game leaderboard
 * (`game_scores` is per-game). Summing every answer made Game 2's reveals show
 * Game 1 + Game 2 combined — the visible phone-vs-TV mismatch (#2).
 *
 * `questionGameMap` maps each `question_id` → its `game_id`. We exclude an answer
 * only when we POSITIVELY know it belongs to a different game. An answer whose
 * question isn't in the map yet (a freshly-created question while the map is still
 * loading) is COUNTED — so a new game's total is never briefly dropped to 0, and
 * we never over-exclude. With `gameId === null` the night-wide sum is returned
 * unchanged (the recap/summary path relies on this).
 */
export function sumAwardedForGame(
  answers: AnswerRow[],
  gameId: string | null,
  questionGameMap: ReadonlyMap<string, string>,
): number {
  return answers.reduce((sum, a) => {
    if (gameId !== null) {
      const answerGame = questionGameMap.get(a.question_id);
      if (answerGame !== undefined && answerGame !== gameId) return sum;
    }
    return sum + (a.awarded_points ?? 0);
  }, 0);
}
