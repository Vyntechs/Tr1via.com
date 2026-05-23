// POST /api/games/:id/undo — host hits Undo within 2s of a reveal.
//
// The host hit Reveal by accident (wrong question, fat-finger). We:
//   1. Confirm the most recent reveals row is < 2s old (server clock).
//   2. Insert an 'undo' event (audit trail).
//   3. Delete any answers that came in during that 2s window.
//   4. Clear played_at on the question — restoring "unrevealed" state so
//      the host can try the right one.
//   5. Broadcast 'undo' so phones bail their "reveal/answer" UI and the
//      TV returns to grid.
//
// Beyond the 2s window: refuse with 409. This is a tiny, deliberate
// surface; we don't want host palpitations about "did I just lose 30
// answers?" Once people have answered, you're committed.

import { ok, forbidden, unauthorized, serverError, notFound, conflict } from "@/lib/api/responses";
import { requireOwnedGame } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { broadcastToRoom } from "@/lib/api/broadcast";

const UNDO_WINDOW_MS = 2_000;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await ctx.params;
  const owned = await requireOwnedGame(gameId);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }

  const admin = getSupabaseAdmin();

  // Find the most recent reveal event in this game.
  const { data: latest } = await admin
    .from("reveals")
    .select("id, question_id, occurred_at, event")
    .eq("game_id", gameId)
    .eq("event", "reveal")
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return conflict("no reveal to undo");

  const ageMs = Date.now() - new Date(latest.occurred_at).getTime();
  if (ageMs > UNDO_WINDOW_MS) {
    return conflict(`undo window expired (${Math.round(ageMs)}ms)`);
  }

  // Sequence: undo-log first, then wipe answers, then clear played_at.
  // The reveals row is append-only audit; we don't delete the original
  // 'reveal' event.
  const { error: undoEventError } = await admin
    .from("reveals")
    .insert({
      game_id: gameId,
      question_id: latest.question_id,
      event: "undo",
      metadata: { undone_reveal_id: latest.id },
    });
  if (undoEventError) return serverError(undoEventError.message);

  const { error: deleteAnswersError } = await admin
    .from("answers")
    .delete()
    .eq("question_id", latest.question_id);
  if (deleteAnswersError) return serverError(deleteAnswersError.message);

  const { error: clearPlayedError } = await admin
    .from("questions")
    .update({ played_at: null, finished_at: null })
    .eq("id", latest.question_id);
  if (clearPlayedError) return serverError(clearPlayedError.message);

  try {
    await broadcastToRoom(owned.night.room_code, "undo", {
      questionId: latest.question_id,
      serverNow: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("broadcast undo failed", e);
  }

  return ok({ undoneQuestionId: latest.question_id });
}
