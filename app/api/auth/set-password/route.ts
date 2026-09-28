// POST /api/auth/set-password — a signed-in host creates (or changes) their
// password.
//
// Body: { password, confirm }. Requires a valid session (getUser() checks
// the token with Supabase Auth, not just the cookie). The password and our
// app_metadata.password_set_at marker are written together, server-side,
// with the service-role key — app_metadata can't be written from a browser,
// so the marker can't be faked. Only the marker key is sent: GoTrue merges
// app_metadata on an admin update, so a switch the founder flips at the
// same moment is never overwritten by a stale copy.
//
// Supabase Auth ALWAYS signs a user out of her other sessions when her
// password changes (GoTrue models.User.UpdatePassword: the admin API ends
// every session; the user-scoped updateUser ends every session but the
// current one). There is no setting to turn that off. So her host phone or
// another computer will ask her to sign in once with the new password —
// the success screen says so. The prompt never shows on the in-show pages
// (/host/live, /host/phone), and this route REFUSES (409 "show_running")
// while any of her nights is running (lib/auth/live-show.ts), so no path —
// not even a second tab on /host — can sign a running show out.
//
// We keep the admin API (not the user-scoped updateUser) because the
// user-scoped path can demand a fresh sign-in when Supabase's "secure
// password change" setting is on, which a host with an old session would
// hit. Right after saving, we sign THIS device in again with the new
// password and put that fresh session's cookies on the 200, so the host
// carries on exactly where she was.
//
// Cookies: the session check uses a client whose cookie writes are held
// back (not next/headers, which would put a refreshed OLD session on the
// response). A refresh from that check is only sent on the early error
// answers, where the old session is still alive. On success ONLY the new
// session's cookies go out. If signing back in fails, the old session is
// already dead, so its cookies are cleared and the answer is 409
// "sign_in_again" with a /login link: "Your password is saved. Sign in with
// it now."
//
// Saving also clears any wrong-password lockout on her email
// (lib/auth/rate-limits.ts), so the new password works everywhere at once.

import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSessionCookieClient, isSupabaseSessionCookie } from "@/lib/auth/session-cookies";
import { checkNewPassword, PASSWORD_SET_AT_KEY } from "@/lib/auth/password-gate";
import { clearEvents } from "@/lib/auth/rate-limits";
import { hostHasRunningShow } from "@/lib/auth/live-show";
import { hostReturnPath } from "@/lib/host/hostReturnPath";
import {
  PASSWORD_SAVED_SIGN_IN_MESSAGE,
  RATE_LIMIT_MESSAGE,
  SHOW_RUNNING_MESSAGE,
  SIGNED_OUT_MESSAGE,
  TRY_AGAIN_MESSAGE,
  isRateLimited,
  isWeakPassword,
  weakPasswordMessage,
} from "@/lib/auth/auth-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, code: string, error: string, field?: string) {
  return NextResponse.json({ code, error, ...(field ? { field } : {}) }, { status });
}

export async function POST(req: NextRequest) {
  // Session check with held-back cookies (see header).
  const current = createSessionCookieClient(req);
  const fail = (status: number, code: string, error: string, field?: string) =>
    current.applyCookies(json(status, code, error, field));
  const {
    data: { user },
    error: userErr,
  } = await current.supabase.auth.getUser();
  if (userErr || !user) return fail(401, "signed_out", SIGNED_OUT_MESSAGE);

  const body = (await req.json().catch(() => null)) as
    | { password?: unknown; confirm?: unknown; next?: unknown }
    | null;
  const password = typeof body?.password === "string" ? body.password : "";
  const confirm = typeof body?.confirm === "string" ? body.confirm : "";
  const check = checkNewPassword(password, confirm);
  if (!check.ok) return fail(400, "bad_password", check.error, check.field);

  // Never mid-show: saving signs out every other device, including the
  // laptop on the venue TV. Refuse while one of her nights is running
  // (lib/auth/live-show.ts); if we can't tell, refuse too — she can save
  // it in a minute, but a broken show can't be undone.
  const admin = getSupabaseAdmin();
  const running = await hostHasRunningShow(admin, user.id);
  if (running === null) return fail(503, "try_again", TRY_AGAIN_MESSAGE);
  if (running) return fail(409, "show_running", SHOW_RUNNING_MESSAGE);

  const setAt = new Date().toISOString();
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    password,
    // Only the key we change: GoTrue merges app_metadata (checked against
    // the local Supabase Auth), so the founder's switches and Supabase's
    // own provider keys stay as they are right now in the database.
    app_metadata: { [PASSWORD_SET_AT_KEY]: setAt },
  });
  if (error) {
    if (isRateLimited(error)) return fail(429, "rate_limited", RATE_LIMIT_MESSAGE);
    if (isWeakPassword(error)) return fail(400, "weak_password", weakPasswordMessage(error), "password");
    return fail(500, "save_failed", TRY_AGAIN_MESSAGE);
  }

  if (user.email) await clearEvents("fail:login-email", user.email);

  // Every session she had is now ended (see header). Sign THIS device in
  // with the new password; only that new session's cookies go out.
  const fresh = createSessionCookieClient(req);
  if (user.email) {
    const { error: signInErr } = await fresh.supabase.auth.signInWithPassword({
      email: user.email,
      password,
    });
    if (!signInErr) {
      return fresh.applyCookies(NextResponse.json({ ok: true, passwordSetAt: setAt }, { status: 200 }));
    }
    console.error("[set-password] saved, but could not sign back in", { message: signInErr.message });
  }

  // Saved, but this device is signed out. Clear the dead session's cookies
  // and send her to /login with a plain next step.
  const next = hostReturnPath(typeof body?.next === "string" ? body.next : null);
  const redirect = `/login?notice=password-saved&next=${encodeURIComponent(next)}`;
  const response = NextResponse.json(
    {
      ok: false,
      code: "sign_in_again",
      error: PASSWORD_SAVED_SIGN_IN_MESSAGE,
      passwordSetAt: setAt,
      redirect,
    },
    { status: 409 },
  );
  for (const { name } of req.cookies.getAll()) {
    if (isSupabaseSessionCookie(name)) response.cookies.set({ name, value: "", path: "/", maxAge: 0 });
  }
  return response;
}
