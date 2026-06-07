import type { QuestionRow } from "@/lib/supabase/types";
import type { TVQuestion } from "@/lib/hooks/useTVRoom";

/**
 * The `questions` columns the public TV snapshot selects. Reuses `QuestionRow`'s
 * canonical narrowing (options as a 4-tuple, correct_index as 0|1|2|3, the
 * point_value union) so the DB-shape trust assumption lives in one place
 * instead of being re-asserted with casts here. The snapshot route casts its
 * partial select to this shape at the fetch boundary, matching how `useRoom`
 * casts `as QuestionRow`.
 */
export type TVBoardQuestionRow = Pick<
  QuestionRow,
  | "id"
  | "category_id"
  | "point_value"
  | "prompt"
  | "options"
  | "correct_index"
  | "image_url"
  | "fact_blurb"
  | "played_at"
  | "finished_at"
  | "is_picked"
>;

/**
 * Serialize a question row for the PUBLIC, UNAUTHENTICATED TV snapshot feed
 * (`GET /api/tv/[code]/snapshot` — keyed only on the room code, served via the
 * admin client which bypasses RLS).
 *
 * SECURITY: the correct answer (`correctIndex`) is withheld — emitted as
 * `null` — until the question is RESOLVED (`finished_at` set, i.e. the reveal
 * is on the TV). A LIVE question (played, answer window open, but not yet
 * finished) ALSO withholds it — that live window is the exact exploit window.
 * Emitting it earlier let any player read every upcoming answer off this same
 * public feed and auto-win every question (pentest 2026-06-06, CRITICAL —
 * reproduced live: 39 unplayed answers leaked from one room at once). Resolved
 * questions keep `correctIndex` so the TV reveal screen can highlight the
 * answer.
 *
 * NOTE: this closes the TV-feed leg only. A joined player can still read a live
 * question's `correct_index` directly via the anon Supabase client because the
 * `questions_player_read` RLS policy gates on `played_at`, not `finished_at`
 * (separate fix — see the security plan).
 */
export function serializeBoardQuestion(q: TVBoardQuestionRow): TVQuestion {
  return {
    id: q.id,
    categoryId: q.category_id,
    pointValue: q.point_value,
    prompt: q.prompt,
    options: q.options,
    correctIndex: q.finished_at ? q.correct_index : null,
    imageUrl: q.image_url,
    factBlurb: q.fact_blurb,
    playedAt: q.played_at,
    finishedAt: q.finished_at,
    isPicked: q.is_picked,
  };
}
