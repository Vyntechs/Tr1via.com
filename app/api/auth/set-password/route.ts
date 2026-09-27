// POST /api/auth/set-password — a signed-in host creates (or changes) their
// password.
//
// Body: { password, confirm }. Requires a valid session (getUser() checks
// the token with Supabase Auth, not just the cookie). The password and our
// app_metadata.password_set_at marker are written together, server-side,
// with the service-role key — app_metadata can't be written from a browser,
// so the marker can't be faked.
//
// Supabase Auth ALWAYS signs a user out of her other sessions when her
// password changes (GoTrue models.User.UpdatePassword: the admin API ends
// every session; the user-scoped updateUser ends every session but the
// current one). There is no setting to turn that off. So her host phone or
// another computer will ask her to sign in once with the new password —
// the success screen says so, and the prompt never shows on the in-show
// pages (/host/live, /host/phone), so it can't be saved from a running show.
//
// We keep the admin API (not the user-scoped updateUser) because the
// user-scoped path can demand a fresh sign-in when Supabase's "secure
// password change" setting is on, which a host with an old session would
// hit. Right after saving, we sign THIS device in again with the new
// password and put that fresh session's cookies on the 200, so the host
// carries on exactly where she was.
//
// Saving also clears any wrong-password lockout on her email
// (lib/auth/rate-limits.ts), so the new password works everywhere at once.

import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSessionCookieClient } from "@/lib/auth/session-cookies";
import { checkNewPassword, PASSWORD_SET_AT_KEY } from "@/lib/auth/password-gate";
import { clearEvents } from "@/lib/auth/rate-limits";
import {
  RATE_LIMIT_MESSAGE,
  SIGNED_OUT_MESSAGE,
  TRY_AGAIN_MESSAGE,
  WEAK_PASSWORD_MESSAGE,
  isRateLimited,
  isWeakPassword,
} from "@/lib/auth/auth-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, code: string, error: string, field?: string) {
  return NextResponse.json({ code, error, ...(field ? { field } : {}) }, { status });
}

export async function POST(req: NextRequest) {
  const supa = await getSupabaseServer();
  const {
    data: { user },
    error: userErr,
  } = await supa.auth.getUser();
  if (userErr || !user) return fail(401, "signed_out", SIGNED_OUT_MESSAGE);

  const body = (await req.json().catch(() => null)) as
    | { password?: unknown; confirm?: unknown }
    | null;
  const password = typeof body?.password === "string" ? body.password : "";
  const confirm = typeof body?.confirm === "string" ? body.confirm : "";
  const check = checkNewPassword(password, confirm);
  if (!check.ok) return fail(400, "bad_password", check.error, check.field);

  const setAt = new Date().toISOString();
  const { error } = await getSupabaseAdmin().auth.admin.updateUserById(user.id, {
    password,
    // Spread what's there so the founder's password_prompt switch (and
    // Supabase's own provider keys) survive whether GoTrue merges or
    // replaces app_metadata.
    app_metadata: { ...(user.app_metadata ?? {}), [PASSWORD_SET_AT_KEY]: setAt },
  });
  if (error) {
    if (isRateLimited(error)) return fail(429, "rate_limited", RATE_LIMIT_MESSAGE);
    if (isWeakPassword(error)) return fail(400, "weak_password", WEAK_PASSWORD_MESSAGE, "password");
    return fail(500, "save_failed", TRY_AGAIN_MESSAGE);
  }

  if (user.email) await clearEvents("fail:login-email", user.email);

  // Refresh the session with the new password (see header). If this fails
  // the password is still saved; the worst case is one normal sign-in.
  const { supabase, applyCookies } = createSessionCookieClient(req);
  const response = NextResponse.json({ ok: true, passwordSetAt: setAt }, { status: 200 });
  if (user.email) {
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password,
    });
    if (!signInErr) return applyCookies(response);
  }
  return response;
}
