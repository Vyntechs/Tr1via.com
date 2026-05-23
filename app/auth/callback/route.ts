// GET /auth/callback — the redirect target for Supabase magic-link emails.
// Exchanges the `code` query param for a session (which the @supabase/ssr
// server client writes as cookies), then routes the host:
//   * If they already have a hosts row → /host
//   * Otherwise (first sign-in) → /host/onboarding
//
// Uses the SERVER Supabase client so the user's auth.uid() is set when
// querying hosts (RLS allows the user to read their own row only).

import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");
  const origin = requestUrl.origin;

  if (!code) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent("missing-code")}`, origin),
    );
  }

  const supabase = await getSupabaseServer();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent(exchangeError.message)}`,
        origin,
      ),
    );
  }

  // After exchange the cookies carry the session. Re-grab the user.
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent("no-user")}`, origin),
    );
  }

  // If a redirect target was passed through, honor it (but only if it's a
  // same-origin path — never trust an absolute URL from a query string).
  if (next && next.startsWith("/")) {
    return NextResponse.redirect(new URL(next, origin));
  }

  // Look up the host row. RLS allows the signed-in user to see their own.
  const { data: host, error: hostError } = await supabase
    .from("hosts")
    .select("id")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (hostError) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(hostError.message)}`, origin),
    );
  }

  if (!host) {
    return NextResponse.redirect(new URL("/host/onboarding", origin));
  }
  return NextResponse.redirect(new URL("/host", origin));
}
