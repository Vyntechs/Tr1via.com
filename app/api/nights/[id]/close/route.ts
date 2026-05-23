// POST /api/nights/:id/close — host closes the night.
//
// Stamps `closed_at` (so the room code can be recycled) and, if this is
// the host's first completed night, flips `hosts.is_first_night_complete`.
// That flag drives the onboarding finale at /(host)/onboarding — the
// "you did it" celebration after their first real show.

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

  const admin = getSupabaseAdmin();
  const closedAt = new Date().toISOString();
  const { error } = await admin
    .from("nights")
    .update({ closed_at: closedAt })
    .eq("id", id);
  if (error) return serverError(error.message ?? "could not close night");

  // Flip the first-night-complete flag if this is their first close. Read
  // current state to avoid clobbering true → false on a re-close.
  if (!owned.host.is_first_night_complete) {
    const { error: hostError } = await admin
      .from("hosts")
      .update({ is_first_night_complete: true })
      .eq("id", owned.host.id);
    if (hostError) {
      // The night is closed — that's the source-of-truth state change. Surface
      // a warning about the onboarding flag but don't fail the request.
      return ok({
        closedAt,
        warning: `night closed but first-night flag not set: ${hostError.message}`,
      });
    }
  }

  return ok({ closedAt });
}
