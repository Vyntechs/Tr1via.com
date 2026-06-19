// POST /api/questions/:id/resolve — resolve a question (the T+20 path).
//
// The first phone whose local timer reaches 0 pings this. It's also the
// fallback if the TV's `useTimer` reaches 0 first. Either way, race-safe:
// resolve_question() does a `select … for update` on the questions row, so
// the second caller sees finished_at set and returns no-op.
//
// Authentication: no specific auth required because (a) the proc is
// idempotent and (b) the question's questionId is needed to call this —
// any device that has the questionId already saw the reveal (RLS gates
// the questions read on `played_at IS NOT NULL`). Race callers from
// outside the room would need a guessed UUID; not worth gating further.
//
// On success, we:
//   1. Run the RPC (does is_correct + awarded_points for every answer,
//      stamps finished_at, inserts 'resolve' event).
//   2. Read back the canonical correct_index + the per-player awards.
//   3. Broadcast 'resolve' on room:{code} so phones flip Locked → Reveal
//      simultaneously with the TV (without each waiting for the slower
//      Postgres Changes notification).

import { ok, serverError, notFound } from "@/lib/api/responses";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { broadcastToRoom, broadcastFireworks } from "@/lib/api/broadcast";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: questionId } = await ctx.params;
  const admin = getSupabaseAdmin();

  // Look up question → category → game → night.room_code through three
  // sequential queries. The stub types don't model FK relationships for
  // joined selects, so a single nested-select wouldn't typecheck.
  const { data: q } = await admin
    .from("questions")
    .select("id, category_id, correct_index")
    .eq("id", questionId)
    .maybeSingle();
  if (!q) return notFound("question not found");
  const { data: cat } = await admin
    .from("categories")
    .select("game_id")
    .eq("id", q.category_id)
    .maybeSingle();
  if (!cat) return notFound("category not found");
  const { data: game } = await admin
    .from("games")
    .select("night_id")
    .eq("id", cat.game_id)
    .maybeSingle();
  if (!game) return notFound("game not found");
  const { data: night } = await admin
    .from("nights")
    .select("room_code")
    .eq("id", game.night_id)
    .maybeSingle();
  if (!night) return notFound("night not found");
  const roomCode = night.room_code;

  const { error: rpcError } = await admin.rpc("resolve_question", {
    p_question_id: questionId,
  });
  if (rpcError) return serverError(rpcError.message);

  // Read the awards back for the broadcast payload. Done after the RPC so
  // is_correct/awarded_points are populated.
  const { data: awards } = await admin
    .from("answers")
    .select("player_id, is_correct, awarded_points")
    .eq("question_id", questionId);

  const payload = {
    questionId,
    correctIndex: q.correct_index,
    awards: (awards ?? []).map((a) => ({
      playerId: a.player_id,
      // Coerce to a real boolean: the column is boolean|null (null = no answer),
      // but the broadcast/awards type is `boolean`. null counts as not-correct.
      isCorrect: a.is_correct === true,
      awarded: a.awarded_points ?? 0,
    })),
    serverNow: new Date().toISOString(),
  };

  try {
    await broadcastToRoom(roomCode, "resolve", payload);
  } catch (e) {
    console.warn("broadcast resolve failed", e);
  }

  // Synchronized firework salvo (July) — every July screen ignites the same
  // burst at the same instant as the answer is revealed. Cosmetic + best-effort
  // (a dropped beat never affects scoring); no-op on non-July nights.
  try {
    await broadcastFireworks(roomCode, "salvo", questionId);
  } catch (e) {
    console.warn("broadcast fireworks(salvo) failed", e);
  }

  return ok({
    resolvedAt: new Date().toISOString(),
    awardCount: payload.awards.length,
  });
}
