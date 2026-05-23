// PATCH /api/admin/hosts/[id] — founder toggles a host's paywall bypass.
//
// Body: { isPaywallBypassed: boolean }. Flipping to true sets comped_at +
// comped_by; flipping to false clears them. The founder's OWN row can be
// edited (you can demote yourself technically — but the singleton
// hosts_single_founder_idx index ensures another founder can't be promoted
// concurrently, and we refuse role changes through this endpoint).

import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireFounder } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  badRequest,
  forbidden,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "@/lib/api/responses";

const PatchSchema = z.object({
  isPaywallBypassed: z.boolean(),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: hostId } = await ctx.params;

  const auth = await requireFounder();
  if (!auth.ok) {
    if (auth.status === 401) return unauthorized(auth.error);
    return forbidden(auth.error);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  const admin = getSupabaseAdmin();

  const { data: target } = await admin.from("hosts").select("id, is_paywall_bypassed, comped_at").eq("id", hostId).maybeSingle();
  if (!target) return notFound("host not found");

  const flippingOn = parsed.data.isPaywallBypassed && !target.is_paywall_bypassed;
  const flippingOff = !parsed.data.isPaywallBypassed && target.is_paywall_bypassed;

  const patch: {
    is_paywall_bypassed: boolean;
    comped_at?: string | null;
    comped_by?: string | null;
  } = { is_paywall_bypassed: parsed.data.isPaywallBypassed };

  if (flippingOn) {
    patch.comped_at = new Date().toISOString();
    patch.comped_by = auth.host.id;
  } else if (flippingOff) {
    patch.comped_at = null;
    patch.comped_by = null;
  }

  const { error } = await admin.from("hosts").update(patch).eq("id", hostId);
  if (error) return serverError(error.message);

  return ok({ updated: true });
}
