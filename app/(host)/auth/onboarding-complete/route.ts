// POST /(host)/auth/onboarding-complete — creates the host's row after the
// onboarding form. Body: { displayName: string; defaultVenue?: string }.
//
// Uses the SERVER (RLS-on) Supabase client so the insert runs as the
// authenticated user — the hosts_self_insert policy permits
// `user_id = auth.uid()`, which we set explicitly below.
//
// Returns the new hosts row (or the existing one, if the user already
// completed onboarding in another tab — idempotent enough).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  displayName: z.string().trim().min(1).max(80),
  defaultVenue: z.string().trim().min(1).max(120).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid body" },
      { status: 400 },
    );
  }

  const supabase = await getSupabaseServer();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // If the row already exists, return it without trying to insert again.
  const { data: existing, error: existingError } = await supabase
    .from("hosts")
    .select("*")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json({ host: existing });
  }

  // First-time host → start their 30-day free trial here. This insert path
  // is only reached by self-serve signups (came in via /api/auth/host-access
  // with no hosts row yet); founder + comped hosts already have a row from
  // /api/admin/hosts and short-circuit at the `existing` check above, so
  // their trial_ends_at correctly stays NULL. See migration 0010.
  const TRIAL_DAYS = 30;
  const trialEndsAt = new Date(
    Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: inserted, error: insertError } = await supabase
    .from("hosts")
    .insert({
      user_id: userData.user.id,
      display_name: parsed.displayName,
      default_venue: parsed.defaultVenue ?? null,
      trial_ends_at: trialEndsAt,
    })
    .select("*")
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ host: inserted }, { status: 201 });
}
