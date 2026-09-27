// POST /api/auth/login — host sign-in with email + password.
//
// Body: { email, password }. On success the Supabase session cookies ride
// back on the 200 response (same SSR cookie pattern as the rest of the app).
//
// This is step 2 of the email-first /login page (after /api/auth/start
// said "password"). Only accounts carrying our app_metadata.password_set_at
// marker can sign in. Accounts made before passwords existed have a random
// Supabase password nobody knows; /api/auth/start emails them a 6-digit
// code instead (and the founder's /host/admin link still works).
//
// No user lookup on the happy path. Only when Supabase says "invalid
// credentials" do we look the email up (paged, no cap) to tell the host
// which of three things went wrong: no account / no password yet / wrong
// password.
//
// Abuse limits (lib/auth/rate-limits.ts): a per-IP request cap, and a
// lockout after too many wrong passwords for one email or from one IP
// ("Too many tries. Wait 15 minutes or use Forgot password."). The lockout
// only covers this door — "Forgot password?" still emails a reset code.
//
// Replaces the email-only /api/auth/founder-login. The prod smoke scripts
// sign in here with SMOKE_FOUNDER_EMAIL + SMOKE_FOUNDER_PASSWORD.

import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { findAuthUserByEmail } from "@/lib/auth/admin-users";
import { createSessionCookieClient } from "@/lib/auth/session-cookies";
import { hasPassword } from "@/lib/auth/password-gate";
import { clientIp, hitIpLimit, isOverLimit, recordEvent } from "@/lib/auth/rate-limits";
import {
  LOCKED_OUT_MESSAGE,
  NO_ACCOUNT_MESSAGE,
  NO_PASSWORD_MESSAGE,
  RATE_LIMIT_MESSAGE,
  TOO_MANY_TRIES_MESSAGE,
  TRY_AGAIN_MESSAGE,
  WRONG_PASSWORD_MESSAGE,
  isRateLimited,
} from "@/lib/auth/auth-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, code: string, error: string) {
  return NextResponse.json({ code, error }, { status });
}

export async function POST(req: NextRequest) {
  if (await hitIpLimit("ip:login", req)) return fail(429, "too_many_tries", TOO_MANY_TRIES_MESSAGE);

  const body = (await req.json().catch(() => null)) as
    | { email?: unknown; password?: unknown }
    | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) {
    return fail(400, "missing_fields", "Please type your email and your password.");
  }

  const ip = clientIp(req);
  const [emailLocked, ipLocked] = await Promise.all([
    isOverLimit("fail:login-email", email),
    isOverLimit("fail:login-ip", ip),
  ]);
  if (emailLocked || ipLocked) return fail(429, "locked_out", LOCKED_OUT_MESSAGE);

  const { supabase, applyCookies } = createSessionCookieClient(req);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (!error && data.user) {
    if (!hasPassword(data.user.app_metadata)) {
      // Only reachable if someone guessed an old random password. Don't
      // hand out the session — the marker is the source of truth.
      return fail(403, "no_password", NO_PASSWORD_MESSAGE);
    }
    return applyCookies(NextResponse.json({ ok: true }, { status: 200 }));
  }

  if (isRateLimited(error)) {
    return fail(429, "rate_limited", RATE_LIMIT_MESSAGE);
  }

  const lookup = await findAuthUserByEmail(getSupabaseAdmin(), email);
  if (!lookup.ok) return fail(500, "lookup_failed", TRY_AGAIN_MESSAGE);
  // Every failed try counts against this IP; a wrong password for a real
  // password account also counts against that email.
  await recordEvent("fail:login-ip", ip);
  if (!lookup.user) return fail(404, "no_account", NO_ACCOUNT_MESSAGE);
  if (!hasPassword(lookup.user.app_metadata)) {
    return fail(403, "no_password", NO_PASSWORD_MESSAGE);
  }
  await recordEvent("fail:login-email", email);
  return fail(401, "wrong_password", WRONG_PASSWORD_MESSAGE);
}
