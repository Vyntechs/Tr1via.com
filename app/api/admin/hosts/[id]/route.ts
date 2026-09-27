// PATCH /api/admin/hosts/[id] — founder toggles a host's paywall bypass
// and/or their "Ask to create password" switch.
//
// Body: { isPaywallBypassed?: boolean, passwordPrompt?: "on" | "off" } (at
// least one). Flipping the paywall to true sets comped_at + comped_by;
// flipping to false clears them. passwordPrompt is written to the host's
// auth app_metadata (service role only — hosts can't write it themselves);
// the /host password gate reads it (lib/auth/password-gate.ts).
//
// The founder's OWN row can be edited (you can demote yourself technically
// — but the singleton hosts_single_founder_idx index ensures another founder can't be promoted
// concurrently, and we refuse role changes through this endpoint).

import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireFounder } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { PASSWORD_PROMPT_KEY } from "@/lib/auth/password-gate";
import {
  badRequest,
  forbidden,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "@/lib/api/responses";

const PatchSchema = z
  .object({
    isPaywallBypassed: z.boolean().optional(),
    passwordPrompt: z.enum(["on", "off"]).optional(),
  })
  .refine((v) => v.isPaywallBypassed !== undefined || v.passwordPrompt !== undefined, {
    message: "nothing to update",
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

  const { data: target } = await admin
    .from("hosts")
    .select("id, user_id, is_paywall_bypassed, comped_at")
    .eq("id", hostId)
    .maybeSingle();
  if (!target) return notFound("host not found");

  if (parsed.data.passwordPrompt !== undefined) {
    const { data: userData, error: userErr } = await admin.auth.admin.getUserById(
      target.user_id,
    );
    if (userErr || !userData?.user) return serverError("could not load host account");
    const { error: metaErr } = await admin.auth.admin.updateUserById(target.user_id, {
      // Spread existing keys (password_set_at, provider info) so they
      // survive whether GoTrue merges or replaces app_metadata.
      app_metadata: {
        ...(userData.user.app_metadata ?? {}),
        [PASSWORD_PROMPT_KEY]: parsed.data.passwordPrompt,
      },
    });
    if (metaErr) return serverError(metaErr.message);
  }

  if (parsed.data.isPaywallBypassed !== undefined) {
    const nextBypass = parsed.data.isPaywallBypassed;
    const flippingOn = nextBypass && !target.is_paywall_bypassed;
    const flippingOff = !nextBypass && target.is_paywall_bypassed;

    const patch: {
      is_paywall_bypassed: boolean;
      comped_at?: string | null;
      comped_by?: string | null;
    } = { is_paywall_bypassed: nextBypass };

    if (flippingOn) {
      patch.comped_at = new Date().toISOString();
      patch.comped_by = auth.host.id;
    } else if (flippingOff) {
      patch.comped_at = null;
      patch.comped_by = null;
    }

    const { error } = await admin.from("hosts").update(patch).eq("id", hostId);
    if (error) return serverError(error.message);
  }

  return ok({ updated: true });
}
