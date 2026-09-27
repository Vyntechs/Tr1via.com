// PATCH /api/admin/hosts/[id] — founder toggles a host's paywall bypass
// and/or their "Ask to create password" switch.
//
// Body: { isPaywallBypassed?: boolean, passwordPrompt?: "on" | "off" } (at
// least one). Flipping the paywall to true sets comped_at + comped_by;
// flipping to false clears them. passwordPrompt is written to the host's
// auth app_metadata (service role only — hosts can't write it themselves);
// the /host password gate reads it (lib/auth/password-gate.ts).
//
// Order + safety: the hosts row (paywall) is written first, then the auth
// switch. Only the one app_metadata key is sent — GoTrue merges
// app_metadata on an admin update, so nothing else (her password marker,
// a save happening at the same moment) can be undone by a stale copy. If
// the switch write fails, the hosts row is put back the way it was, so a
// request never half-applies.
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
    .select("id, user_id, is_paywall_bypassed, comped_at, comped_by")
    .eq("id", hostId)
    .maybeSingle();
  if (!target) return notFound("host not found");

  // 1. The hosts row (paywall bypass).
  let hostsChanged = false;
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
    hostsChanged = true;
  }

  // 2. The "Ask to create password" switch — only this key.
  if (parsed.data.passwordPrompt !== undefined) {
    const { error: metaErr } = await admin.auth.admin.updateUserById(target.user_id, {
      app_metadata: { [PASSWORD_PROMPT_KEY]: parsed.data.passwordPrompt },
    });
    if (metaErr) {
      if (hostsChanged) {
        // Put the paywall back so the request is all-or-nothing.
        const { error: undoErr } = await admin
          .from("hosts")
          .update({
            is_paywall_bypassed: target.is_paywall_bypassed,
            comped_at: target.comped_at,
            comped_by: target.comped_by,
          })
          .eq("id", hostId);
        if (undoErr) {
          return serverError(
            `password switch not saved (${metaErr.message}); paywall change could not be undone (${undoErr.message})`,
          );
        }
      }
      return serverError(metaErr.message);
    }
  }

  return ok({ updated: true });
}
