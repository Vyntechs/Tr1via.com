// POST /api/auth/verify-code — sign in with an emailed 6-digit code.
//
// Body: { email, purpose: "login" | "reset", code, next? }.
// ("signup" codes are checked by /api/auth/host-access, which creates the
// account in the same request.)
//
// A correct code starts a session the same way /auth/grant does
// (admin generateLink → verifyOtp → session cookies on this response) and
// tells the page where to go:
//   login → "Create your password" (Step 2 of 2), then on to `next` — the
//           same rule as /auth/grant: skipped when the founder switched
//           this host's prompt explicitly "off" (then straight to `next`)
//   reset → "Choose a new password", then on to `next` (she asked to
//           change it, so the switch doesn't apply)
// A login code for an account that already has a password goes straight
// to `next`, and so does ANY code when `next` is an in-show page
// (/host/live, /host/phone): the password step never runs mid-show.
//
// The account lookup is NOT redundant: generateLink creates a brand-new
// account for an unknown email, so we must confirm the account exists
// before starting a session. It runs after the code check (one indexed
// row, lib/auth/admin-users.ts), so wrong guesses never reach it.

import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { findAuthUserByEmail } from "@/lib/auth/admin-users";
import { SET_PASSWORD_PATH, isInShowPath, walkToPasswordAfterSignIn } from "@/lib/auth/password-gate";
import { markFounderIfNeeded } from "@/lib/auth/founder-flag";
import { cleanCode } from "@/lib/auth/email-codes";
import { checkCode, parseEmail, startSessionForEmail } from "@/lib/auth/email-code-flow";
import { hitIpLimit } from "@/lib/auth/rate-limits";
import { hostReturnPath } from "@/lib/host/hostReturnPath";
import {
  BAD_CODE_MESSAGE,
  BAD_EMAIL_MESSAGE,
  NO_ACCOUNT_MESSAGE,
  START_OVER_MESSAGE,
  TOO_MANY_TRIES_MESSAGE,
  TRY_AGAIN_MESSAGE,
} from "@/lib/auth/auth-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, code: string, error: string) {
  return NextResponse.json({ code, error }, { status });
}

export async function POST(req: NextRequest) {
  // Per-IP cap on code checks (lib/auth/rate-limits.ts).
  if (await hitIpLimit("ip:verify-code", req)) return fail(429, "too_many_tries", TOO_MANY_TRIES_MESSAGE);
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

  const checked = await checkCode(email, purpose, code);
  if (!checked.ok) return fail(checked.status, checked.code, checked.error);

  const lookup = await findAuthUserByEmail(getSupabaseAdmin(), email);
  if (!lookup.ok) return fail(500, "lookup_failed", TRY_AGAIN_MESSAGE);
  if (!lookup.user) return fail(404, "no_account", NO_ACCOUNT_MESSAGE);

  const session = await startSessionForEmail(req, email);
  if (!session.ok) return fail(500, "sign_in_failed", TRY_AGAIN_MESSAGE);

  let redirect = next;
  if (isInShowPath(next.split("?")[0])) {
    // She was sent to /login from a running show (/host/live, /host/phone).
    // Put her straight back in the show; saving a password now would sign
    // her other devices (the laptop on the TV) out mid-show. The password
    // step waits until she next opens TR1VIA outside a show.
  } else if (purpose === "reset") {
    redirect = `${SET_PASSWORD_PATH}?from=reset&next=${encodeURIComponent(next)}`;
  } else if (walkToPasswordAfterSignIn(session.user.app_metadata)) {
    redirect = `${SET_PASSWORD_PATH}?from=code&next=${encodeURIComponent(next)}`;
  }
  await markFounderIfNeeded(session.user);
  return session.applyCookies(NextResponse.json({ ok: true, redirect }, { status: 200 }));
}
