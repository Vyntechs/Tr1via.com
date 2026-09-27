// GET /auth/grant?t=<hashed_token> — server-side magic-link redemption.
//
// Why this route exists: admin-generated magic links (see
// /api/admin/grant-magic-link) hand the host a Supabase verify URL that
// uses the IMPLICIT flow — Supabase redirects the user to
// `<site>/#access_token=…` with the session in the URL hash. That works
// in pure-SPA clients with detectSessionInUrl, but in TR1VIA the
// authoritative session is server-side cookies set by the @supabase/ssr
// client. The hash is invisible to the server, so SSR can't see it.
//
// Worse: Supabase's GoTrue enforces its own redirect-URL allowlist on the
// `redirect_to` param. The allowlist for this project is bare `tr1via.com`,
// so any custom redirect we'd pass gets stripped.
//
// The clean way out: don't redirect through Supabase at all. We embed
// the `hashed_token` from generateLink directly into our own URL.
// When the host clicks it, this route receives the token, calls
// `verifyOtp` server-side (the same SSR exchange the founder bypass
// uses), and the response carries the auth cookies. We then redirect
// to /host as a normal authenticated user — or, for an account with no
// password yet, to /host/set-password first.
//
// Security: the hashed_token is single-use, scoped to one email, and
// expires after ~1 hour. Leaking the URL gives someone exactly one
// sign-in attempt within the window; once consumed it's dead. The
// founder is the only role that can mint these (gated by
// requireFounder() on the generator endpoint).

import { NextResponse, type NextRequest } from "next/server";
import { createSessionCookieClient } from "@/lib/auth/session-cookies";
import {
  SET_PASSWORD_PATH,
  hasPassword,
  passwordPromptSetting,
} from "@/lib/auth/password-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  // Single-letter query key keeps the URL short enough to fit in an iMessage
  // bubble without wrapping.
  const token = url.searchParams.get("t");
  if (!token || token.length < 20 || token.length > 200) {
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent("missing or malformed grant token")}`,
        url.origin,
      ),
    );
  }

  const { supabase, applyCookies } = createSessionCookieClient(req);

  const { data, error } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: token,
  });
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin),
    );
  }

  // The founder's link is the way back in for an account with no password
  // yet. Land that host on "Create your password" so she won't need another
  // link next time — unless the founder switched her prompt explicitly off.
  const appMetadata = data.user?.app_metadata;
  const destination =
    !hasPassword(appMetadata) && passwordPromptSetting(appMetadata) !== "off"
      ? `${SET_PASSWORD_PATH}?next=${encodeURIComponent("/host")}`
      : "/host";

  // verifyOtp handed the session cookies to createSessionCookieClient; they
  // ride on this redirect so the browser carries them on the next request.
  return applyCookies(NextResponse.redirect(new URL(destination, url.origin)));
}
