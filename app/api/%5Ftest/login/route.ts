// Test-only host login. Returns 404 to anyone without the secret header.
// Otherwise: get-or-create auth.users row for the given email (with the
// app_metadata.password_set_at marker so the password gate stays out of the
// way), get-or-create hosts row, mint a Supabase session via generateLink + verifyOtp, return
// {hostId, userId}. Caller is now signed in (auth cookies set on response).
//
// Hard refusal: only @tr1via.test emails permitted through this route, even
// with valid secret. Defense against the route ever being used to mint
// sessions for real users (e.g. host@example.com).

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isTestModeEnabled, isTestEmail } from "@/lib/api/require-test-mode";
import { findAuthUserByEmail } from "@/lib/auth/admin-users";
import { hasPassword, PASSWORD_SET_AT_KEY } from "@/lib/auth/password-gate";

interface CookieToSet {
  name: string;
  value: string;
  options?: CookieOptions;
}

export async function POST(req: NextRequest) {
  if (!isTestModeEnabled(req)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as
    | { email?: string; displayName?: string; password?: string }
    | null;
  if (!body?.email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  if (!isTestEmail(body.email)) {
    return NextResponse.json({ error: "email must end in @tr1via.test" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // 1. Get-or-create auth user, always carrying the password marker so the
  //    /host "Create your password" gate never interrupts local e2e runs.
  const lookup = await findAuthUserByEmail(admin, body.email);
  if (!lookup.ok) {
    return NextResponse.json({ error: lookup.error }, { status: 500 });
  }
  const existingUser = lookup.user;
  const passwordSetAt = new Date().toISOString();
  // Optional known password, so e2e can drive the real /login password step.
  const password =
    typeof body.password === "string" && body.password.length >= 8 ? body.password : undefined;
  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    if (!hasPassword(existingUser.app_metadata) || password) {
      const { error } = await admin.auth.admin.updateUserById(userId, {
        ...(password ? { password } : {}),
        app_metadata: {
          ...(existingUser.app_metadata ?? {}),
          [PASSWORD_SET_AT_KEY]: passwordSetAt,
        },
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: body.email,
      email_confirm: true,
      ...(password ? { password } : {}),
      user_metadata: { display_name: body.displayName ?? "Test Host" },
      app_metadata: { [PASSWORD_SET_AT_KEY]: passwordSetAt },
    });
    if (error || !data.user) {
      return NextResponse.json({ error: error?.message ?? "createUser failed" }, { status: 500 });
    }
    userId = data.user.id;
  }

  // 2. Get-or-create hosts row
  const { data: hostRow, error: hostErr } = await admin
    .from("hosts")
    .upsert(
      { user_id: userId, display_name: body.displayName ?? "Test Host" },
      { onConflict: "user_id" },
    )
    .select("id")
    .single();
  if (hostErr || !hostRow) {
    return NextResponse.json({ error: hostErr?.message ?? "host upsert failed" }, { status: 500 });
  }

  // 3. Mint session cookies via generateLink + SSR client verifyOtp
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: body.email,
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    return NextResponse.json({ error: linkErr?.message ?? "generateLink failed" }, { status: 500 });
  }

  const response = NextResponse.json({ hostId: hostRow.id, userId }, { status: 200 });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
        setAll: (toSet: CookieToSet[]) => {
          for (const { name, value, options } of toSet) {
            response.cookies.set({ name, value, ...options });
          }
        },
      },
    },
  );
  const { error: otpErr } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });
  if (otpErr) {
    return NextResponse.json({ error: otpErr.message }, { status: 500 });
  }

  return response;
}
