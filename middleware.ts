// Root middleware. Two jobs:
//   1. Refresh the Supabase auth cookies on every request (the SSR pattern
//      from supabase.com/docs/guides/auth/server-side/nextjs — keeps the
//      session alive without round-trips to Supabase from Server Components).
//   2. Gate the host surfaces (/host and the (host) route group) behind a
//      signed-in user; bounce anonymous visitors to /login.
//
// Player routes are intentionally untouched — anonymous device sessions are
// handled by /api/session/init + the tr1via_device cookie, not Supabase Auth.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";

interface SetCookieRequest {
  name: string;
  value: string;
  options: CookieOptions;
}

function isHostPath(pathname: string): boolean {
  // /host and any nested route. The (host) group renders at /login, /host,
  // /host/onboarding, etc. — Next strips the group name from the URL.
  if (pathname === "/host") return true;
  if (pathname.startsWith("/host/")) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  // The pattern from the Supabase docs: build the response up front, then
  // let the createServerClient adapter mutate request + response cookies
  // in lockstep so refreshed tokens propagate to both this request (for
  // any downstream `auth.getUser()` call) and the browser (for next time).
  let response = NextResponse.next({ request });

  const { pathname } = request.nextUrl;

  // Route handlers own their authorization boundary. Running Supabase host
  // session refresh in front of every player heartbeat, room snapshot, TV
  // snapshot, and lock-count poll multiplies one venue into thousands of
  // unnecessary Auth requests. When Auth slows, those requests time out in
  // middleware before their already-successful route responses can reach the
  // browser, and every client retries at once. Keep API traffic out of the
  // host-page session gate; authenticated handlers still call requireOwned*
  // or getAuthedHost themselves.
  if (pathname.startsWith("/api/")) {
    return response;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    // Misconfigured — let the request through rather than 500ing on every
    // page hit. Server Components / Route Handlers will throw their own
    // helpful "Missing env" error.
    return response;
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: SetCookieRequest[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Always call getUser() — this is what triggers the cookie refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isHostPath(pathname)) {
    const redirect = new URL("/login", request.url);
    // Preserve where they were headed so /auth/callback can route them back.
    redirect.searchParams.set("next", pathname);
    return NextResponse.redirect(redirect);
  }

  // /login deliberately renders even when the user is already signed in
  // — the page detects the existing session and shows an "ALREADY SIGNED
  // IN AS [email]" banner with a Sign Out option above the form. Without
  // this escape hatch, a visitor who inherited someone else's cookie
  // (shared device, founder-bypass remnant, etc.) had no way to switch
  // accounts. The previous behavior was to redirect authed /login hits
  // to /host, which is exactly how the first host ended up locked into the
  // founder's session.

  return response;
}

// Match every page except Next internals, static assets, and the few
// auth-adjacent routes that must always be reachable.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.svg|favicon.ico|api/session/init|auth/callback|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|css|js|woff2?)).*)",
  ],
};
