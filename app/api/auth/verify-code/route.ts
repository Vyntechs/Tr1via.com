// POST /api/auth/verify-code — sign in with an emailed 6-digit code.
//
// Body: { email, purpose: "login" | "reset", code, next? }.
// ("signup" codes are checked by /api/auth/host-access, which creates the
// account in the same request.)
//
// A correct code starts a session the same way /auth/grant does
// (admin generateLink → verifyOtp → session cookies on this response) and
// tells the page where to go:
//   login → "Create your password" (Step 2 of 2), then on to `next`
//   reset → "Choose a new password", then on to `next`
// A login code for an account that already has a password goes straight
// to `next`.

import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { findAuthUserByEmail } from "@/lib/auth/admin-users";
import { SET_PASSWORD_PATH, hasPassword } from "@/lib/auth/password-gate";
import { cleanCode } from "@/lib/auth/email-codes";
import { checkCode, parseEmail, startSessionForEmail } from "@/lib/auth/email-code-flow";
import { hostReturnPath } from "@/lib/host/hostReturnPath";
import {
  BAD_CODE_MESSAGE,
  BAD_EMAIL_MESSAGE,
  NO_ACCOUNT_MESSAGE,
  START_OVER_MESSAGE,
  TRY_AGAIN_MESSAGE,
} from "@/lib/auth/auth-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, code: string, error: string) {
  return NextResponse.json({ code, error }, { status });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { email?: unknown; purpose?: unknown; code?: unknown; next?: unknown }
    | null;
  const email = parseEmail(body?.email);
  if (!email) return fail(400, "bad_email", BAD_EMAIL_MESSAGE);
  const purpose = body?.purpose;
  if (purpose !== "login" && purpose !== "reset") return fail(400, "bad_purpose", START_OVER_MESSAGE);
  const code = cleanCode(body?.code);
  if (!code) return fail(400, "bad_code", BAD_CODE_MESSAGE);
  const next = hostReturnPath(typeof body?.next === "string" ? body.next : null);

  const lookup = await findAuthUserByEmail(getSupabaseAdmin(), email);
  if (!lookup.ok) return fail(500, "lookup_failed", TRY_AGAIN_MESSAGE);
  if (!lookup.user) return fail(404, "no_account", NO_ACCOUNT_MESSAGE);

  const checked = await checkCode(email, purpose, code);
  if (!checked.ok) return fail(checked.status, checked.code, checked.error);

  const session = await startSessionForEmail(req, email);
  if (!session.ok) return fail(500, "sign_in_failed", TRY_AGAIN_MESSAGE);

  let redirect = next;
  if (purpose === "reset") {
    redirect = `${SET_PASSWORD_PATH}?from=reset&next=${encodeURIComponent(next)}`;
  } else if (!hasPassword(session.user.app_metadata)) {
    redirect = `${SET_PASSWORD_PATH}?from=code&next=${encodeURIComponent(next)}`;
  }
  return session.applyCookies(NextResponse.json({ ok: true, redirect }, { status: 200 }));
}
