// Test-only host login. Returns 404 to anyone without the secret header.
// Otherwise: get-or-create auth.users row for the given email, get-or-create
// hosts row, mint a Supabase session via generateLink + verifyOtp, return
// {hostId, userId}. Caller is now signed in (auth cookies set on response).
//
// Hard refusal: only @tr1via.test emails permitted through this route, even
// with valid secret. Defense against the route ever being used to mint
// sessions for real users (e.g. brandon.james.nichols@gmail.com).

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isTestModeEnabled, isTestEmail } from "@/lib/api/require-test-mode";

interface CookieToSet {
  name: string;
  value: string;
  options?: CookieOptions;
}

export async function POST(req: NextRequest) {
  if (!isTestModeEnabled(req)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as { email?: string; displayName?: string } | null;
  if (!body?.email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  if (!isTestEmail(body.email)) {
    return NextResponse.json({ error: "email must end in @tr1via.test" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // 1. Get-or-create auth user
  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
  const existingUser = existing?.users.find((u) => u.email === body.email);
  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: body.email,
      email_confirm: true,
      user_metadata: { display_name: body.displayName ?? "Test Host" },
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
