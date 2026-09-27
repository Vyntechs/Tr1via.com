// GET /auth/password-later?next=/host — "Not now" on "Create your password".
//
// Sets a browser-session cookie (PASSWORD_LATER_COOKIE) that the middleware
// gate honors, then sends her on (default /host; never back to the prompt
// or into a show path through here). Every sign-in clears the cookie, so
// she is asked again the next time she signs in.
//
// Also used by /host/set-password itself when one of her nights is running
// (lib/auth/live-show.ts): the step is skipped and she goes straight in.
//
// Harmless if triggered by someone else: it only postpones a prompt.

import { NextResponse, type NextRequest } from "next/server";
import { PASSWORD_LATER_COOKIE, setPasswordReturnPath } from "@/lib/auth/password-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const target = setPasswordReturnPath(url.searchParams.get("next"));
  const res = NextResponse.redirect(new URL(target, url.origin));
  res.cookies.set({
    name: PASSWORD_LATER_COOKIE,
    value: "1",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    // No maxAge: it lasts until the browser closes or she signs in again.
  });
  return res;
}
