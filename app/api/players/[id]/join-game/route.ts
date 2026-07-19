// POST /api/players/:id/join-game — player opts into a specific game.
//
// game_participations is per-game opt-in: a player who joined game 1
// doesn't auto-play game 2 (they may have left the bar). The "Join Game 2"
// button between the two halves of the night hits this with gameNo=2.
//
// Idempotent: re-joining the same game returns 200 with the existing
// participation. Race: the unique (game_id, player_id) index protects us
// from double-insert.

import type { NextRequest } from "next/server";
import { JoinGameSchema } from "@/lib/api/schemas";
import { badRequest, ok, serverError, unauthorized, notFound, forbidden } from "@/lib/api/responses";
import { requireOwnedPlayer } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: playerId } = await ctx.params;
  const owned = await requireOwnedPlayer(playerId);
  if (!owned.ok) {
    return owned.status === 401 ? unauthorized(owned.error) : notFound(owned.error);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }
  const parsed = JoinGameSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  const admin = getSupabaseAdmin();

  // Look up the corresponding game in this player's night. Schema constrains
  // game_no to literal 1|2; Zod gives us number, narrow before the .eq.
  const gameNo = parsed.data.gameNo as 1 | 2;
  const { data: game, error: gameError } = await admin
    .from("games")
    .select("id, state")
    .eq("night_id", owned.player.night_id)
    .eq("game_no", gameNo)
    .maybeSingle();
  if (gameError) return serverError();
  if (!game) return notFound("game not found");
  if (game.state === "done") return forbidden("game is over");

  // Insert participation, swallowing the duplicate-key error so callers
  // can call this whether or not they're already in.
  const { error: insertError } = await admin
    .from("game_participations")
    .insert({ game_id: game.id, player_id: playerId });
  if (insertError && insertError.code !== "23505") {
    return serverError();
  }

  return ok({ gameId: game.id });
}
