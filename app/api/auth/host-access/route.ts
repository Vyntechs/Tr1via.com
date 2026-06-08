// POST /api/auth/host-access — the single self-serve door for hosts.
//
// One email box, two outcomes, no dead-end:
//   - Known email (already an auth user)  → mint a session, sign them in.
//   - New email (no auth user yet)        → create the account, mint a
//                                            session. They land on
//                                            /host/onboarding (the /host
//                                            page redirects there whenever
//                                            no hosts row exists yet).
//
// Either way we return 200 with auth cookies on the response and the
// client navigates to /host. There is intentionally NO 404 "we don't
// recognize that email" branch — that dead-end is what this endpoint
// replaces. (Sign-in for known hosts still also works via the older
// /api/auth/founder-login, which the prod smoke + history reference; this
// endpoint is the new superset the /login page calls.)
//
// Why no magic-link round-trip: same trust model as founder-login —
// anyone who could intercept a verification email could just type the
// address here. We mint the session directly via generateLink → verifyOtp.
//
// What this endpoint does NOT do: it never writes the hosts row. The row
// (carrying the 30-day trial) is created by /(host)/auth/onboarding-complete
// so that onboarding stays the single writer and a brand-new account is
// actually routed THROUGH the onboarding form (which only happens while no
// hosts row exists). See migration 0010 + the onboarding-complete handler.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // Find the auth.users row by email. auth.users isn't selectable from the
  // JS client, so we list (capped 200 — same as founder-login) and match.
  const { data: usersList, error: listErr } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listErr) {
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
  let user = usersList?.users.find((u) => u.email?.toLowerCase() === email) ?? null;

  // New email → create the auth account. email_confirm: true marks the
  // address verified so verifyOtp works immediately on this first request
  // (mirrors how /api/admin/hosts creates comped accounts). We do NOT
  // create the hosts row here — onboarding does that.
  if (!user) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (createErr || !created?.user) {
      return NextResponse.json(
        { error: createErr?.message ?? "account creation failed" },
        { status: 500 },
      );
    }
    user = created.user;
  }

  // Mint a session via generateLink + verifyOtp — identical to
  // founder-login. The SSR client writes cookies onto the response we
  // return; the browser keeps them and the next request to /host carries
  // the session.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    return NextResponse.json(
      { error: linkErr?.message ?? "generateLink failed" },
      { status: 500 },
    );
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
