// GET /api/nights/by-code/:code — public-ish lookup for the player join page.
//
// A would-be player types/scans the room code and we need to translate it
// into a night_id so they can post their display name to /api/players.
// Players aren't members yet, so RLS would deny — we use the admin client
// to perform the single narrow lookup. Returns only the bare minimum: id,
// venue name, theme (so the join page can theme itself), and whether the
// room is locked.
//
// Theme: returns both the per-night override (`themeKey`) and the host's
// default (`hostDefaultThemeKey`). The client uses `resolveTheme()` to
// derive the actual theme to render — falls through cleanly when one or
// the other is null.

import { ok, badRequest, notFound, serverError } from "@/lib/api/responses";
import { parseRoomCode, isValidRoomCode } from "@/lib/game/room-code";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await ctx.params;
  // Accept formatted ("K9P·R4M"), lowercase, or whitespace-padded input.
  const code = parseRoomCode(rawCode);
  if (!isValidRoomCode(code)) return badRequest("invalid room code");

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("nights")
    .select(
      "id, venue_name, theme_key, is_locked, opened_at, closed_at, hosts!inner(default_theme_key)",
    )
    .eq("room_code", code)
    .is("closed_at", null)
    .maybeSingle();
  if (error) return serverError(error.message ?? "lookup failed");
  if (!data) return notFound("room not found");

  // Supabase returns the joined `hosts` field as either an object or an
  // array depending on the relationship inference. Normalize to a single
  // object since night → host is many-to-one.
  const host = Array.isArray(data.hosts) ? data.hosts[0] : data.hosts;

  return ok({
    nightId: data.id,
    venueName: data.venue_name,
    themeKey: data.theme_key,
    hostDefaultThemeKey: host?.default_theme_key ?? null,
    isLocked: data.is_locked,
    isOpen: data.opened_at !== null,
  });
}
