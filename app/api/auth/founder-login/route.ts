// POST /api/auth/founder-login — passwordless login for the founder.
//
// Body: { email }. If the email matches a row in public.hosts with
// role='founder', we mint a session server-side and return 200 with the
// auth cookies set on the response. Anything else → 404 (deliberately
// indistinguishable from a missing route so we don't leak "this email is
// the founder").
//
// Why this exists: relying on Supabase email delivery for the single
// founder account is fragile — corporate domains (vyntechs.com) drop
// Supabase's default SMTP, and configuring custom SMTP is a bigger
// project. The founder is a privileged-but-known entity; checking the
// hosts table for role='founder' is the same trust boundary the admin
// dashboard already uses.
//
// Risk surface: someone who knows the founder's exact email could
// impersonate the founder. Mitigated by (a) the email being hard to
// guess and (b) the singleton-founder constraint — there's exactly one.
// Add a shared secret header later if we ever onboard more founders.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

interface CookieToSet {
  name: string;
  value: string;
  options?: CookieOptions;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Find the auth.users row + corresponding hosts.role. We do this via a
  // SQL function call rather than two round-trips since auth.users isn't
  // selectable from the JS client. Easiest path: list users (capped 200,
  // we have <20 hosts), find by email.
  const { data: usersList, error: listErr } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listErr) {
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
  const user = usersList?.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: hostRow } = await admin
    .from("hosts")
    .select("id, role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!hostRow || hostRow.role !== "founder") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Mint a session via generateLink + verifyOtp. The SSR client writes
  // cookies onto the response we return; the browser keeps them and the
  // next request to /host carries the session.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    return NextResponse.json({ error: linkErr?.message ?? "generateLink failed" }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true }, { status: 200 });
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
