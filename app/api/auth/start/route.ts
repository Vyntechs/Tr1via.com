// POST /api/auth/start — step 1 of host sign-in: the email box.
//
// Body: { email }. The server picks the next step and says no more than
// that step needs:
//   - account with a password (app_metadata.password_set_at)
//       → { step: "password" }          (no email is sent)
//   - account with no password yet (every account made before passwords)
//       → emails a 6-digit "login" code → { step: "code", purpose: "login", maskedEmail }
//   - no account
//       → { step: "signup" }            (the page asks for a password, then
//                                         /api/auth/send-code emails a
//                                         "signup" code to prove the email)
//
// Nobody is signed in here. If the code can't be sent (mail not set up,
// codes table missing, hourly limit) the host gets a plain message; on the
// hourly limit she still moves to the code step so she can use the newest
// code she already has.

import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { findAuthUserByEmail } from "@/lib/auth/admin-users";
import { hasPassword } from "@/lib/auth/password-gate";
import { parseEmail, sendCodeTo } from "@/lib/auth/email-code-flow";
import { BAD_EMAIL_MESSAGE, TRY_AGAIN_MESSAGE } from "@/lib/auth/auth-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Room for a user lookup plus a slow SMTP handshake (8s connect timeout).
export const maxDuration = 30;

export async function POST(req: NextRequest) {
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

  const sent = await sendCodeTo(email, "login");
  if (sent.ok) {
    return NextResponse.json({ step: "code", purpose: "login", maskedEmail: sent.maskedEmail });
  }
  if (sent.code === "too_many_codes") {
    return NextResponse.json(
      { step: "code", purpose: "login", maskedEmail: sent.maskedEmail, code: sent.code, error: sent.error },
      { status: sent.status },
    );
  }
  return NextResponse.json({ code: sent.code, error: sent.error }, { status: sent.status });
}
