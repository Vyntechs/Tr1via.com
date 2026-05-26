// POST /api/nights/:id/reset-to-setup — host rolls a started/finished
// night back to the setup screen.
//
// Ownership enforced via requireOwnedNight (same pattern as /open,
// /close). The actual wipe is one Postgres RPC for atomicity — partial
// failure here would leave the game in an unrepresentable state.
// Idempotent: if no games are in live/done, the RPC returns zero counts
// and nothing changes.

import { forbidden, notFound, ok, serverError, unauthorized } from "@/lib/api/responses";
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

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("reset_night_to_setup", {
    p_night_id: id,
  });
  if (error) return serverError(error.message ?? "could not reset night");

  return ok(data ?? {});
}
