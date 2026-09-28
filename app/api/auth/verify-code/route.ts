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
//           this host's prompt explicitly "off" (then straight to `next`);
//           the screen has a "Not now" link
//   reset → "Choose a new password", then on to `next` (she asked to
//           change it, so the switch doesn't apply)
// A login code for an account that already has a password goes straight
// to `next`, and so does ANY code when `next` is an in-show page
// (/host/live, /host/phone) or one of her nights is running right now
// (lib/auth/live-show.ts): saving a password signs her other devices out,
// so the password step never runs during a show. She's asked next time.
//
// The code is checked first but only USED UP after her session has
// started, so a hiccup starting the session can be retried with the same
// code. If two requests race with one code, only the one that uses it up
// gets the session cookies; a session started for a code that then can't
// be used up is signed out again (that session only).
//
// The account lookup is NOT redundant: generateLink creates a brand-new
// account for an unknown email, so we must confirm the account exists
// before starting a session. It runs after the code check (one row,
// lib/auth/admin-users.ts), so wrong guesses never reach it.

import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { findAuthUserByEmail } from "@/lib/auth/admin-users";
import {
  SET_PASSWORD_PATH,
  forgetPasswordLater,
  isInShowPath,
  walkToPasswordAfterSignIn,
} from "@/lib/auth/password-gate";
import { markFounderIfNeeded } from "@/lib/auth/founder-flag";
import { hostHasRunningShow } from "@/lib/auth/live-show";
import { cleanCode } from "@/lib/auth/email-codes";
import { checkCode, parseEmail, startSessionForEmail, spendCode } from "@/lib/auth/email-code-flow";
import { clientIp, hitIpLimit } from "@/lib/auth/rate-limits";
import { hostReturnPath } from "@/lib/host/hostReturnPath";
import {
  BAD_CODE_MESSAGE,
  BAD_EMAIL_MESSAGE,
  CODE_USED_MESSAGE,
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

  // consume:false — used up only once her session has started (header).
  const checked = await checkCode(email, purpose, code, { ip: clientIp(req), consume: false });
  if (!checked.ok) return fail(checked.status, checked.code, checked.error);

  const admin = getSupabaseAdmin();
  const lookup = await findAuthUserByEmail(admin, email);
  if (!lookup.ok) return fail(500, "lookup_failed", TRY_AGAIN_MESSAGE);
  if (!lookup.user) return fail(404, "no_account", NO_ACCOUNT_MESSAGE);

  const session = await startSessionForEmail(req, email);
  if (!session.ok) return fail(500, "sign_in_failed", TRY_AGAIN_MESSAGE);

  const used = await spendCode({ codeId: checked.codeId, email, purpose });
  if (used !== "used") {
    // The session just started goes unused: end it (this session only —
    // her other devices stay signed in) before sending no cookies.
    await session.endSession();
    // Another request used this code first: that one gets the session.
    if (used === "already_used") return fail(400, "code_used", CODE_USED_MESSAGE);
    // Couldn't mark it used: the same code still works.
    return fail(500, "try_again", TRY_AGAIN_MESSAGE);
  }

  let redirect = next;
  if (isInShowPath(next.split("?")[0])) {
    // She was sent to /login from a running show (/host/live, /host/phone).
    // Put her straight back in the show; saving a password now would sign
    // her other devices (the laptop on the TV) out mid-show. The password
    // step waits until she next signs in outside a show.
  } else if (purpose === "reset" || walkToPasswordAfterSignIn(session.user.app_metadata)) {
    // Only when none of her nights is running (null = couldn't tell →
    // don't risk a show; she's asked next sign-in).
    if ((await hostHasRunningShow(admin, session.user.id)) === false) {
      redirect =
        purpose === "reset"
          ? `${SET_PASSWORD_PATH}?from=reset&next=${encodeURIComponent(next)}`
          : `${SET_PASSWORD_PATH}?from=code&next=${encodeURIComponent(next)}`;
    }
  }
  await markFounderIfNeeded(session.user);
  // A fresh sign-in asks again (clears any earlier "Not now").
  return forgetPasswordLater(session.applyCookies(NextResponse.json({ ok: true, redirect }, { status: 200 })));
}
