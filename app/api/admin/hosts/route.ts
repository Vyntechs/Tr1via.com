// /api/admin/hosts — founder-only host management.
//
// GET  → list every host in the DB, joined with auth.users for email +
//        sorted newest-first. Used by /host/admin to render the table.
// POST → "comp a host": create their auth.users row (with email_confirm)
//        and their hosts row with is_paywall_bypassed=true + audit fields.
//        The account has no password yet: the founder texts them a
//        sign-in link (grant-magic-link) and they create one on arrival.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireFounder } from "@/lib/api/auth";
import { PASSWORD_SET_AT_KEY, passwordPromptSetting } from "@/lib/auth/password-gate";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { findAuthUserByEmail } from "@/lib/auth/admin-users";
import { loadAdminHostRows, type AdminHostRow } from "@/lib/admin/admin-host-rows";
import {
  badRequest,
  forbidden,
  ok,
  serverError,
  unauthorized,
} from "@/lib/api/responses";

export type { AdminHostRow };

export async function GET() {
  const auth = await requireFounder();
  if (!auth.ok) {
    if (auth.status === 401) return unauthorized(auth.error);
    return forbidden(auth.error);
  }

  const result = await loadAdminHostRows(getSupabaseAdmin());
  if (!result.ok) return serverError(result.error);
  return ok({ hosts: result.rows });
}

const CompSchema = z.object({
  email: z.string().email().max(254),
  displayName: z.string().min(1).max(80),
  defaultVenue: z.string().max(80).optional(),
});

export async function POST(req: NextRequest) {
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
  const parsed = CompSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  const admin = getSupabaseAdmin();

  // 1. Find or create the auth user. email_confirm so the founder's
  //    sign-in link works without a separate confirmation step. The new
  //    account has no password yet: the founder sends a sign-in link from
  //    /host/admin and the host creates her password on arrival.
  const existing = await findAuthUserByEmail(admin, parsed.data.email);
  if (!existing.ok) return serverError("could not look up users");
  const existingUser = existing.user;
  let userId: string;
  let passwordSetAt: string | null = null;
  let passwordPrompt: AdminHostRow["password_prompt"] = null;
  if (existingUser) {
    userId = existingUser.id;
    const setAt = existingUser.app_metadata?.[PASSWORD_SET_AT_KEY];
    passwordSetAt = typeof setAt === "string" && setAt ? setAt : null;
    passwordPrompt = passwordPromptSetting(existingUser.app_metadata);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: parsed.data.email,
      email_confirm: true,
      user_metadata: { display_name: parsed.data.displayName },
    });
    if (error || !data.user) {
      return serverError(error?.message ?? "createUser failed");
    }
    userId = data.user.id;
  }

  // 2. Upsert the hosts row. is_paywall_bypassed=true (this whole route's
  //    purpose is to comp them past the paywall). Capture audit fields.
  const { data: hostRow, error: hostErr } = await admin
    .from("hosts")
    .upsert(
      {
        user_id: userId,
        display_name: parsed.data.displayName,
        default_venue: parsed.data.defaultVenue ?? null,
        role: "host",
        is_paywall_bypassed: true,
        comped_at: new Date().toISOString(),
        comped_by: auth.host.id,
      },
      { onConflict: "user_id" },
    )
    .select("*")
    .single();
  if (hostErr || !hostRow) return serverError(hostErr?.message ?? "hosts upsert failed");

  return ok(
    {
      host: {
        id: hostRow.id,
        user_id: hostRow.user_id,
        email: parsed.data.email,
        display_name: hostRow.display_name,
        default_venue: hostRow.default_venue,
        role: (hostRow.role === "founder" ? "founder" : "host") as "host" | "founder",
        is_paywall_bypassed: hostRow.is_paywall_bypassed,
        comped_at: hostRow.comped_at,
        comped_by: hostRow.comped_by,
        comped_by_name: auth.host.display_name,
        created_at: hostRow.created_at,
        password_set_at: passwordSetAt,
        password_prompt: passwordPrompt,
      } satisfies AdminHostRow,
    },
    201,
  );
}
