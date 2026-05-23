// DELETE /api/players/:id — host soft-removes a player mid-night.
//
// Soft delete by stamping `removed_at`. The roster + leaderboard hooks
// filter on `removed_at IS NULL` so the player disappears from the live
// UI on the next realtime tick. Their scores stay in the DB, untouched,
// so audit trails (and the recap if needed) still resolve cleanly.
//
// Host-only — the calling host must own the player's parent night.

import { type NextRequest } from "next/server";
import { requireOwnedNight } from "@/lib/api/auth";
import {
  forbidden,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "@/lib/api/responses";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: playerId } = await ctx.params;

  // Look up the player first so we know which night they belong to. Using
  // the admin client here keeps the failure mode "player not found" vs
  // "you can't see this player" — the latter leaks info.
  const admin = getSupabaseAdmin();
  const { data: player } = await admin
    .from("players")
    .select("id, night_id, removed_at")
    .eq("id", playerId)
    .maybeSingle();
  if (!player) return notFound("player not found");

  const owned = await requireOwnedNight(player.night_id);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }

  // Idempotent: if removed_at is already set, return the existing stamp
  // rather than overwriting (preserves the original removal time).
  if (player.removed_at) {
    return ok({ playerId: player.id, removedAt: player.removed_at });
  }

  const removedAt = new Date().toISOString();
  const { data: updated, error } = await admin
    .from("players")
    .update({ removed_at: removedAt })
    .eq("id", playerId)
    .select("id, removed_at")
    .single();
  if (error || !updated) {
    return serverError(error?.message ?? "could not remove player");
  }
  return ok({ playerId: updated.id, removedAt: updated.removed_at });
}
