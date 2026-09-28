// POST /api/auth/send-code — email a fresh 6-digit code.
//
// Body: { email, purpose: "login" | "reset" | "signup" }. Used for
// "Send a new code", "Forgot password?", and confirming a new host's email.
//
// Each purpose is only allowed for the matching account state, checked
// here on the server (the page can't be trusted to ask for the right one):
//   login  — account exists and has NO password yet. An account with a
//            password must use its password (or "Forgot password?").
//   reset  — account exists.
//   signup — no account with this email yet.

import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { findAuthUserByEmail } from "@/lib/auth/admin-users";
import { hasPassword } from "@/lib/auth/password-gate";
import { isCodePurpose } from "@/lib/auth/email-codes";
import { parseEmail, sendCodeTo } from "@/lib/auth/email-code-flow";
import { clientIp, hitIpLimit } from "@/lib/auth/rate-limits";
import {
  ACCOUNT_EXISTS_MESSAGE,
  BAD_EMAIL_MESSAGE,
  HAS_PASSWORD_MESSAGE,
  NO_ACCOUNT_MESSAGE,
  START_OVER_MESSAGE,
  TOO_MANY_TRIES_MESSAGE,
  TRY_AGAIN_MESSAGE,
} from "@/lib/auth/auth-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Room for a user lookup plus a slow SMTP handshake (8s connect timeout).
export const maxDuration = 30;

function fail(status: number, code: string, error: string) {
  return NextResponse.json({ code, error }, { status });
}

export async function POST(req: NextRequest) {
  // Per-IP cap (lib/auth/rate-limits.ts) — every call here emails a code.
  if (await hitIpLimit("ip:send-code", req)) return fail(429, "too_many_tries", TOO_MANY_TRIES_MESSAGE);
  const body = (await req.json().catch(() => null)) as
    | { email?: unknown; purpose?: unknown }
    | null;
  const email = parseEmail(body?.email);
  if (!email) return fail(400, "bad_email", BAD_EMAIL_MESSAGE);
  const purpose = body?.purpose;
  if (!isCodePurpose(purpose)) return fail(400, "bad_purpose", START_OVER_MESSAGE);

  const lookup = await findAuthUserByEmail(getSupabaseAdmin(), email);
  if (!lookup.ok) return fail(500, "lookup_failed", TRY_AGAIN_MESSAGE);
  const user = lookup.user;

  if (purpose === "signup" && user) return fail(409, "account_exists", ACCOUNT_EXISTS_MESSAGE);
  if (purpose !== "signup" && !user) return fail(404, "no_account", NO_ACCOUNT_MESSAGE);
  if (purpose === "login" && user && hasPassword(user.app_metadata)) {
    return fail(409, "has_password", HAS_PASSWORD_MESSAGE);
  }

  const sent = await sendCodeTo(email, purpose, clientIp(req));
  if (!sent.ok) {
    // too_many_codes: she already has recent codes, so the page shows the
    // code boxes (with this masked email) along with the message.
    return NextResponse.json(
      { code: sent.code, error: sent.error, ...(sent.code === "too_many_codes" ? { maskedEmail: sent.maskedEmail } : {}) },
      { status: sent.status },
    );
  }
  return NextResponse.json({ ok: true, maskedEmail: sent.maskedEmail });
}
