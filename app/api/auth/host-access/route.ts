// POST /api/auth/host-access — self-serve sign-up for brand-new hosts.
//
// Body: { email, password, confirm, code }. `code` is the 6-digit "signup"
// code /api/auth/send-code emailed to that address — proof the new host
// owns the email, so nobody can claim someone else's. Only after the code
// checks out do we create the Supabase account WITH a password and our
// app_metadata.password_set_at marker, then sign the new host in (session
// cookies on the 200 response). They land on /host, which routes them to
// /host/onboarding because no hosts row exists yet.
//
// Existing accounts are never signed in here — that's /api/auth/login with
// a password. A duplicate email gets 409 and a "sign in instead" message.
// No more account-by-email-only, and no user-list lookup at all: Supabase's
// own duplicate-email check on createUser does the work.
//
// What this endpoint does NOT do: it never writes the hosts row. The row
// (carrying the 30-day trial) is created by /(host)/auth/onboarding-complete
// so onboarding stays the single writer. See migration 0010.

import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSessionCookieClient } from "@/lib/auth/session-cookies";
import { checkNewPassword, PASSWORD_SET_AT_KEY } from "@/lib/auth/password-gate";
import { cleanCode } from "@/lib/auth/email-codes";
import { checkCode, parseEmail } from "@/lib/auth/email-code-flow";
import {
  ACCOUNT_EXISTS_MESSAGE,
  BAD_CODE_MESSAGE,
  BAD_EMAIL_MESSAGE,
  RATE_LIMIT_MESSAGE,
  TRY_AGAIN_MESSAGE,
  WEAK_PASSWORD_MESSAGE,
  isDuplicateEmail,
  isRateLimited,
  isWeakPassword,
} from "@/lib/auth/auth-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, code: string, error: string, field?: string) {
  return NextResponse.json({ code, error, ...(field ? { field } : {}) }, { status });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { email?: unknown; password?: unknown; confirm?: unknown; code?: unknown }
    | null;
  const email = parseEmail(body?.email);
  if (!email) return fail(400, "bad_email", BAD_EMAIL_MESSAGE, "email");
  const password = typeof body?.password === "string" ? body.password : "";
  const confirm = typeof body?.confirm === "string" ? body.confirm : "";
  const check = checkNewPassword(password, confirm);
  if (!check.ok) return fail(400, "bad_password", check.error, check.field);
  const code = cleanCode(body?.code);
  if (!code) return fail(400, "bad_code", BAD_CODE_MESSAGE, "code");

  // Prove the email first. A wrong/expired code never creates anything.
  const verified = await checkCode(email, "signup", code);
  if (!verified.ok) return fail(verified.status, verified.code, verified.error, "code");

  const admin = getSupabaseAdmin();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    // Marks the address verified so password sign-in works immediately
    // (mirrors how /api/admin/hosts creates comped accounts).
    email_confirm: true,
    app_metadata: { [PASSWORD_SET_AT_KEY]: new Date().toISOString() },
  });
  if (createErr || !created?.user) {
    if (isDuplicateEmail(createErr)) return fail(409, "account_exists", ACCOUNT_EXISTS_MESSAGE);
    if (isWeakPassword(createErr)) {
      return fail(400, "weak_password", WEAK_PASSWORD_MESSAGE, "password");
    }
    if (isRateLimited(createErr)) return fail(429, "rate_limited", RATE_LIMIT_MESSAGE);
    return fail(500, "create_failed", TRY_AGAIN_MESSAGE);
  }

  const { supabase, applyCookies } = createSessionCookieClient(req);
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) {
    if (isRateLimited(signInErr)) return fail(429, "rate_limited", RATE_LIMIT_MESSAGE);
    return fail(500, "sign_in_failed", TRY_AGAIN_MESSAGE);
  }

  return applyCookies(NextResponse.json({ ok: true }, { status: 200 }));
}
