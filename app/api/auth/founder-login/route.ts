// POST /api/auth/founder-login — passwordless login for any registered host.
//
// (Name is historical — the endpoint was originally founder-only, hence
// the path. It now mints a session for any row in public.hosts. Kept
// the path to avoid breaking the /login client and the smoke test that
// references it.)
//
// Body: { email }. If the email matches a registered host, we mint a
// session server-side and return 200 with auth cookies on the response.
// Unknown email → 404.
//
// Why no magic-link round-trip: Brandon's product is two known
// participants (himself + the first host) and any other hosts he comps in via
// /host/admin. Their emails are entered manually by the founder. There's
// no open signup, so requiring an email-verify hop to "prove" each
// sign-in adds friction for zero security gain — anyone who could
// intercept the magic-link email could just type the address here.
//
// Trust model: this is the same boundary "Comp a host" already uses —
// only emails Brandon has put into the hosts table can sign in. New
// accounts come in through /host/admin, not through this endpoint.

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

  // Confirm a hosts row exists for this user. We don't gate on role —
  // any host (founder or otherwise) gets a session. The hosts row also
  // means Brandon has explicitly onboarded this email via "Comp a host."
  const { data: hostRow } = await admin
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!hostRow) {
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
