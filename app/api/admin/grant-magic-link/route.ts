// POST /api/admin/grant-magic-link — founder-only.
//
// Generates a one-click sign-in URL for any host on demand. The founder
// shares this URL with the host (text, AirDrop, in-person handoff) and
// the host visits it to land on `/host` already signed in. No email
// round-trip, no Supabase OTP rate limit (which is what the first host hit on
// 2026-05-25 — clicking "Send sign-in link" five times burned through
// the per-email cap).
//
// Body: { email }. The route:
//   1. Verifies the caller is signed in AS founder (requireFounder).
//   2. Looks up the auth.users row by email. 404 if the email isn't
//      already a registered host — we don't want this to be a back door
//      for creating fresh accounts.
//   3. Calls admin.auth.admin.generateLink with redirectTo /auth/callback.
//      Supabase mints a short-lived (~1hr) verify token. The
//      action_link URL embeds that token and the redirect.
//   4. Returns { url, email, displayName } so the UI can render a Copy
//      button + a "Text this to Linda" hint.
//
// The returned URL contains a single-use token. Once the host clicks it,
// the token is consumed; subsequent clicks fail. So leaking the URL is
// limited blast radius.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  badRequest,
  forbidden,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "@/lib/api/responses";
import { requireFounder } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    email: z.string().trim().toLowerCase().email().max(200),
  })
  .strict();

function siteUrl(req: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return new URL(req.url).origin;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireFounder();
  if (!auth.ok) {
    if (auth.status === 401) return unauthorized(auth.error);
    return forbidden(auth.error);
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) return badRequest(err);
    return badRequest(err instanceof Error ? err.message : "invalid body");
  }

  const admin = getSupabaseAdmin();

  // Look up the target user. auth.users isn't directly queryable from
  // the JS client; listUsers is the documented path. We have <20 hosts
  // so a single page covers everyone.
  const { data: usersList, error: listErr } = await admin.auth.admin.listUsers({
    perPage: 200,
  });
  if (listErr) return serverError("could not look up users");
  const target = usersList?.users.find(
    (u) => u.email?.toLowerCase() === parsed.email,
  );
  if (!target) {
    return notFound(`no host with email ${parsed.email}`);
  }

  // Optional: surface the display name in the response so the UI can
  // render "Text this to the first host" instead of "Text this to the email".
  const { data: hostRow } = await admin
    .from("hosts")
    .select("display_name")
    .eq("user_id", target.id)
    .maybeSingle();

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: parsed.email,
    options: { redirectTo: `${siteUrl(req)}/auth/callback` },
  });
  if (linkErr || !linkData?.properties?.action_link) {
    return serverError(linkErr?.message ?? "generateLink failed");
  }

  return ok({
    url: linkData.properties.action_link,
    email: parsed.email,
    displayName: hostRow?.display_name ?? null,
  });
}
