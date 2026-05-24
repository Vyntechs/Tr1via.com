// POST /api/games/:id/end — host ends a game.
//
// Stamps ended_at and moves state → 'done'. The TV's state machine moves
// from "leaderboard" → "intermission" (game 1) or "finale winner card"
// (game 2). After this call, no new answers can be inserted (RLS on
// answers requires `questions.finished_at IS NULL` for the parent
// question, and a done game's live question — if any — should've been
// resolved before End).

import { ok, forbidden, unauthorized, serverError, notFound } from "@/lib/api/responses";
import { requireOwnedGame } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { broadcastGameEnded } from "@/lib/api/broadcast";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const owned = await requireOwnedGame(id);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }

  const admin = getSupabaseAdmin();
  const endedAt = new Date().toISOString();
  const { data, error } = await admin
    .from("games")
    .update({ state: "done", ended_at: endedAt })
    .eq("id", id)
    .select("state, ended_at")
    .single();
  if (error || !data) return serverError(error?.message ?? "could not end game");

  // Broadcast the state flip so phones + TV refresh without waiting on
  // postgres_changes. Phones flip to PlayerJoinGame2 (if game 1 ended) or
  // out of the live screen entirely; the TV moves to intermission/finale.
  try {
    await broadcastGameEnded(owned.night.room_code, id);
  } catch (e) {
    console.warn("broadcast game-ended failed", e);
  }

  return ok({ state: data.state, endedAt: data.ended_at });
}
