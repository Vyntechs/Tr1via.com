// POST /api/adjustments — host hand-adjusts a player's score in a game.
//
// Used for: suspected cheating (negative delta), bonus from a paper round,
// or correcting a buggy award. Lives in its own table so the original
// answers data is never mutated — the game_scores view sums answers +
// adjustments to compute final score. Audit trail intact.

import type { NextRequest } from "next/server";
import { AdjustmentSchema } from "@/lib/api/schemas";
import { badRequest, ok, forbidden, unauthorized, serverError, notFound } from "@/lib/api/responses";
import { requireOwnedGame } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }
  const parsed = AdjustmentSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  // Ownership: the host must own the game's parent night. requireOwnedGame
  // also confirms the game exists.
  const owned = await requireOwnedGame(parsed.data.gameId);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }

  const admin = getSupabaseAdmin();

  // Cross-check that the player is in the host's night (not just any
  // playerId from another night). game_participations is the connecting
  // table.
  const { data: participation } = await admin
    .from("game_participations")
    .select("id")
    .eq("game_id", parsed.data.gameId)
    .eq("player_id", parsed.data.playerId)
    .maybeSingle();
  if (!participation) return forbidden("player is not in this game");

  const { data, error } = await admin
    .from("adjustments")
    .insert({
      player_id: parsed.data.playerId,
      game_id: parsed.data.gameId,
      delta: parsed.data.delta,
      reason: parsed.data.reason ?? null,
    })
    .select("id, delta")
    .single();
  if (error || !data) return serverError(error?.message ?? "could not adjust");
  return ok({ adjustmentId: data.id, delta: data.delta }, 201);
}
