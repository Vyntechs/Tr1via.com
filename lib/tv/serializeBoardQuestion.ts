import type { TVQuestion } from "@/lib/hooks/useTVRoom";

/**
 * Raw `questions` columns the public TV snapshot selects. Looser than
 * `QuestionRow` — the snapshot route reads straight from the stub-typed
 * Supabase client (options: Json, correct_index: number).
 */
export interface TVBoardQuestionRow {
  id: string;
  category_id: string;
  point_value: number | null;
  prompt: string;
  options: unknown;
  correct_index: number;
  image_url: string | null;
  fact_blurb: string | null;
  played_at: string | null;
  finished_at: string | null;
  is_picked: boolean;
}

/**
 * Serialize a question row for the PUBLIC, UNAUTHENTICATED TV snapshot feed
 * (`GET /api/tv/[code]/snapshot` — keyed only on the room code, served via the
 * admin client which bypasses RLS).
 *
 * SECURITY: the correct answer (`correctIndex`) is withheld — emitted as
 * `null` — until the question is RESOLVED (`finished_at` set, i.e. the reveal
 * is on the TV). Emitting it earlier let any player read every upcoming
 * answer off this same public feed and auto-win every question (pentest
 * 2026-06-06, CRITICAL — reproduced live: 39 unplayed answers leaked at once).
 * Resolved questions keep `correctIndex` so the TV reveal screen can highlight
 * the answer.
 */
export function serializeBoardQuestion(q: TVBoardQuestionRow): TVQuestion {
  return {
    id: q.id,
    categoryId: q.category_id,
    pointValue: q.point_value as TVQuestion["pointValue"],
    prompt: q.prompt,
    options: q.options as [string, string, string, string],
    correctIndex: q.finished_at ? (q.correct_index as 0 | 1 | 2 | 3) : null,
    imageUrl: q.image_url,
    factBlurb: q.fact_blurb,
    playedAt: q.played_at,
    finishedAt: q.finished_at,
    isPicked: q.is_picked,
  };
}
