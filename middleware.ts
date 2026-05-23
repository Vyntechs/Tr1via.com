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

  const { pathname } = request.nextUrl;

  if (!user && isHostPath(pathname)) {
    const redirect = new URL("/login", request.url);
    // Preserve where they were headed so /auth/callback can route them back.
    redirect.searchParams.set("next", pathname);
    return NextResponse.redirect(redirect);
  }

  // Already signed in but visiting /login? Send them home.
  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/host", request.url));
  }

  return response;
}

// Match every page except Next internals, static assets, and the few
// auth-adjacent routes that must always be reachable.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.svg|favicon.ico|api/session/init|auth/callback|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|css|js|woff2?)).*)",
  ],
};
