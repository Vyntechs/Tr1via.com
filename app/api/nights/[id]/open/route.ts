// POST /api/nights/:id/open — host opens the room to players.
//
// Stamps `opened_at` so the lobby screen knows the room is "live for join."
// Idempotent: re-opening a night that's already open is a no-op (we don't
// bump opened_at, so leaderboard "joined at" deltas stay stable).

import { ok, forbidden, unauthorized, serverError, notFound } from "@/lib/api/responses";
import { requireOwnedNight } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const owned = await requireOwnedNight(id);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }

  if (owned.night.opened_at) {
    // Already open — surface the existing timestamp without overwriting.
    return ok({ openedAt: owned.night.opened_at });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("nights")
    .update({ opened_at: new Date().toISOString() })
    .eq("id", id)
    .select("opened_at")
    .single();
  if (error || !data) return serverError(error?.message ?? "could not open night");
  return ok({ openedAt: data.opened_at });
}
