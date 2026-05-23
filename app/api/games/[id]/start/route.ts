// POST /api/games/:id/start — host starts a game.
//
// Marks the game state 'live' and stamps started_at. The TV's state
// machine moves from grid → "waiting for first reveal" on this transition.
// The 'state' column has a CHECK constraint that rejects illegal moves
// (e.g. you can't start a 'done' game).

import { ok, forbidden, unauthorized, serverError, notFound, conflict } from "@/lib/api/responses";
import { requireOwnedGame } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

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
  const { data: existing } = await admin
    .from("games")
    .select("state")
    .eq("id", id)
    .single();
  if (!existing) return notFound("game vanished");

  // Idempotent: already-live returns 200 so an accidental double-click of
  // Start is harmless. Done games can't restart — that would clobber
  // history.
  if (existing.state === "live") {
    return ok({ state: "live" });
  }
  if (existing.state === "done") {
    return conflict("game is already done");
  }

  const startedAt = new Date().toISOString();
  const { error } = await admin
    .from("games")
    .update({ state: "live", started_at: startedAt })
    .eq("id", id);
  if (error) return serverError(error.message);
  return ok({ state: "live", startedAt });
}
