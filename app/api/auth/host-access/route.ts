// POST /api/auth/host-access — self-serve sign-up for brand-new hosts.
//
// Body: { email, password, confirm, code }. `code` is the 6-digit "signup"
// code /api/auth/send-code emailed to that address — proof the new host
// owns the email, so nobody can claim someone else's. Only after the code
// checks out do we create the Supabase account WITH a password and our
// app_metadata.password_set_at marker, then sign the new host in (session
// cookies on the 200 response).
//
// The code is checked first but only USED UP once the account exists. If
// Supabase refuses the password (its own rules, set in the Supabase
// dashboard, can be stricter than our 8-character minimum) she gets the
// rule in plain words and can fix the password and try the SAME code again
// — no wasted code, no extra email against her hourly limit. They land on /host, which routes them to
// /host/onboarding because no hosts row exists yet. If the account is made
// but signing in right after fails, the answer is 409 "account_ready" and
// the page moves her to the password sign-in step: "Your account is ready.
// Sign in with your password."
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
import { checkCode, parseEmail, spendCode } from "@/lib/auth/email-code-flow";
import { clientIp, hitIpLimit } from "@/lib/auth/rate-limits";
import { forgetPasswordLater } from "@/lib/auth/password-gate";
import {
  ACCOUNT_EXISTS_MESSAGE,
  ACCOUNT_READY_MESSAGE,
  BAD_CODE_MESSAGE,
  BAD_EMAIL_MESSAGE,
  RATE_LIMIT_MESSAGE,
  RELOAD_PAGE_MESSAGE,
  TOO_MANY_TRIES_MESSAGE,
  TRY_AGAIN_MESSAGE,
  isDuplicateEmail,
  isRateLimited,
  isWeakPassword,
  weakPasswordMessage,
} from "@/lib/auth/auth-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, code: string, error: string, field?: string) {
  return NextResponse.json({ code, error, ...(field ? { field } : {}) }, { status });
}

/** An old /login tab (from before passwords) posts `{ email }` only. */
function isLegacyEmailOnlyBody(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.email === "string" &&
    b.password === undefined &&
    b.confirm === undefined &&
    b.code === undefined
  );
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { email?: unknown; password?: unknown; confirm?: unknown; code?: unknown }
    | null;
  // A /login tab left open from before this update still posts `{ email }`
  // only. Tell her to refresh instead of a confusing password error. The old
  // page shows `error` from any non-OK answer, so this reads right there.
  // Checked before the per-IP cap so a stale tab can't use up her tries.
  if (isLegacyEmailOnlyBody(body)) return fail(400, "reload_page", RELOAD_PAGE_MESSAGE);
  // Shares the per-IP code-check cap with /api/auth/verify-code.
  if (await hitIpLimit("ip:verify-code", req)) return fail(429, "too_many_tries", TOO_MANY_TRIES_MESSAGE);
  const email = parseEmail(body?.email);
  if (!email) return fail(400, "bad_email", BAD_EMAIL_MESSAGE, "email");
  const password = typeof body?.password === "string" ? body.password : "";
  const confirm = typeof body?.confirm === "string" ? body.confirm : "";
  const check = checkNewPassword(password, confirm);
  if (!check.ok) return fail(400, "bad_password", check.error, check.field);
  const code = cleanCode(body?.code);
  if (!code) return fail(400, "bad_code", BAD_CODE_MESSAGE, "code");

  // Prove the email first. A wrong/expired code never creates anything.
  // consume:false — the code is used up only after the account is created.
  const verified = await checkCode(email, "signup", code, { ip: clientIp(req), consume: false });
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
    if (isDuplicateEmail(createErr)) {
      await spendCode({ codeId: verified.codeId, email, purpose: "signup" });
      return fail(409, "account_exists", ACCOUNT_EXISTS_MESSAGE);
    }
    if (isWeakPassword(createErr)) {
      return fail(400, "weak_password", weakPasswordMessage(createErr), "password");
    }
    if (isRateLimited(createErr)) return fail(429, "rate_limited", RATE_LIMIT_MESSAGE);
    return fail(500, "create_failed", TRY_AGAIN_MESSAGE);
  }
  // The account exists now, so the code is done either way.
  await spendCode({ codeId: verified.codeId, email, purpose: "signup" });

  const { supabase, applyCookies } = createSessionCookieClient(req);
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) {
    // Her account is made and her code is used up, so a code screen would be
    // a dead end. Send her to the normal password sign-in instead.
    console.error("[host-access] account created, but sign-in failed", {
      code: (signInErr as { code?: string }).code,
      status: (signInErr as { status?: number }).status,
    });
    return fail(409, "account_ready", ACCOUNT_READY_MESSAGE);
  }

  return forgetPasswordLater(applyCookies(NextResponse.json({ ok: true }, { status: 200 })));
}
