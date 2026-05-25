// POST /api/auth/logout — sign the current user out.
//
// Calls supabase.auth.signOut() via the SSR client so the auth cookies on
// the response are cleared. The browser keeps the cookie names but with
// empty values + immediate expiration, so subsequent requests look
// unauthenticated.
//
// Returns 204 No Content on success. The client should redirect to /login
// after (a refresh works too — middleware bounces unauthenticated /host
// requests to /login).
//
// Why this exists: there was no sign-out path anywhere in the app before
// 2026-05-25. A customer who shared a device with the founder (or who
// got handed a magic link from the founder's email) had no way to drop
// the session and use her own email. Now there is.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

interface CookieToSet {
  name: string;
  value: string;
  options?: CookieOptions;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true }, { status: 200 });
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

  // signOut here triggers the SSR client's setAll to write the
  // cookie-clear instructions onto our response.
  await supabase.auth.signOut();

  return response;
}
