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
// to /host as a normal authenticated user.
//
// Security: the hashed_token is single-use, scoped to one email, and
// expires after ~1 hour. Leaking the URL gives someone exactly one
// sign-in attempt within the window; once consumed it's dead. The
// founder is the only role that can mint these (gated by
// requireFounder() on the generator endpoint).

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CookieToSet {
  name: string;
  value: string;
  options?: CookieOptions;
}

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

  const response = NextResponse.redirect(new URL("/host", url.origin));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () =>
          req.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
        setAll: (toSet: CookieToSet[]) => {
          for (const { name, value, options } of toSet) {
            response.cookies.set({ name, value, ...options });
          }
        },
      },
    },
  );

  const { error } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: token,
  });
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin),
    );
  }

  // verifyOtp wrote the auth cookies onto `response` via the SSR client's
  // setAll callback. The browser will carry them on the next request.
  return response;
}
