// POST /api/auth/start — step 1 of host sign-in: the email box.
//
// Body: { email }. The server picks the next step and says no more than
// that step needs:
//   - account with a password (app_metadata.password_set_at)
//       → { step: "password" }          (no email is sent)
//   - account with no password yet (every account made before passwords)
//       → emails a 6-digit "login" code → { step: "code", purpose: "login", maskedEmail, passwordNext }
//         passwordNext: "Create your password" really comes after the code
//         (same rule as /api/auth/verify-code), so the page's "What's new"
//         pop-up only promises a password step she'll actually get
//   - no account
//       → { step: "signup" }            (the page asks for a password, then
//                                         /api/auth/send-code emails a
//                                         "signup" code to prove the email)
//
// Nobody is signed in here. If the code can't be sent the host gets a plain
// message and stays on the email box. The one exception is her OWN email's
// hourly limit (too_many_codes): she already has recent codes, so she moves
// to the code step to use the newest one. When no code went out for any
// other reason (this network's hourly code limit, mail or database trouble)
// she is never shown the code screen.

import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { findAuthUserByEmail } from "@/lib/auth/admin-users";
import { hasPassword, walkToPasswordAfterSignIn } from "@/lib/auth/password-gate";
import { hostHasRunningShow } from "@/lib/auth/live-show";
import { parseEmail, sendCodeTo } from "@/lib/auth/email-code-flow";
import { clientIp, hitIpLimit } from "@/lib/auth/rate-limits";
import { BAD_EMAIL_MESSAGE, TOO_MANY_TRIES_MESSAGE, TRY_AGAIN_MESSAGE } from "@/lib/auth/auth-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Room for a user lookup plus a slow SMTP handshake (8s connect timeout).
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  // Per-IP cap (lib/auth/rate-limits.ts) — this door looks up emails.
  if (await hitIpLimit("ip:start", req)) {
    return NextResponse.json({ code: "too_many_tries", error: TOO_MANY_TRIES_MESSAGE }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = parseEmail(body?.email);
  if (!email) {
    return NextResponse.json({ code: "bad_email", error: BAD_EMAIL_MESSAGE }, { status: 400 });
  }

  const lookup = await findAuthUserByEmail(getSupabaseAdmin(), email);
  if (!lookup.ok) {
    return NextResponse.json({ code: "lookup_failed", error: TRY_AGAIN_MESSAGE }, { status: 500 });
  }
  const user = lookup.user;

  if (!user) return NextResponse.json({ step: "signup" });
  if (hasPassword(user.app_metadata)) return NextResponse.json({ step: "password" });

  const sent = await sendCodeTo(email, "login", clientIp(req));
  if (sent.ok) {
    // Not while one of her nights is running (null = couldn't tell → no promise).
    const passwordNext =
      walkToPasswordAfterSignIn(user.app_metadata) &&
      (await hostHasRunningShow(getSupabaseAdmin(), user.id)) === false;
    return NextResponse.json({ step: "code", purpose: "login", maskedEmail: sent.maskedEmail, passwordNext });
  }
  if (sent.code === "too_many_codes") {
    return NextResponse.json(
      { step: "code", purpose: "login", maskedEmail: sent.maskedEmail, code: sent.code, error: sent.error },
      { status: sent.status },
    );
  }
  return NextResponse.json({ code: sent.code, error: sent.error }, { status: sent.status });
}
