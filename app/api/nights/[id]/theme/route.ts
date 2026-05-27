// PATCH /api/nights/:id/theme — host updates the night's palette.
//
// Body: { themeKey: ThemeKey }. ThemeKey is validated against THEME_KEYS
// so a typo or stale client can't poison the row.
//
// Idempotent. The TV snapshot route + player room route both read
// nights.theme_key on next page load to drive the ThemeProvider, so a
// change here propagates to every surface on next mount. Live repaint
// of already-mounted players is a future broadcast feature.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { forbidden, ok, serverError, unauthorized, notFound, badRequest, conflict } from "@/lib/api/responses";
import { requireOwnedNight } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isThemeKey } from "@/lib/theme/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  themeKey: z.string().refine(isThemeKey, { message: "unknown themeKey" }),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const owned = await requireOwnedNight(id);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "invalid body");
  }

  const admin = getSupabaseAdmin();

  // Block theme changes while any game in this night is live. A mid-game
  // flip would break in-flight ceremonies (May → June switch mid-question).
  const { data: liveGame } = await admin
    .from("games")
    .select("id")
    .eq("night_id", id)
    .eq("state", "live")
    .maybeSingle();

  if (liveGame) {
    return conflict(
      "Can't change theme while a game is live. End the current game first.",
    );
  }

  const { data, error } = await admin
    .from("nights")
    .update({ theme_key: parsed.themeKey })
    .eq("id", id)
    .select("theme_key")
    .single();
  if (error || !data) return serverError(error?.message ?? "could not update theme");

  return ok({ themeKey: data.theme_key });
}
