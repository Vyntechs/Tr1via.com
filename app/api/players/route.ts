// POST /api/players — player joins a night.
//
// The phone hits this with the night_id (looked up from /api/nights/by-code)
// and a chosen display name. We upsert against (night_id, device_id) — so a
// player re-loading the page on the same device keeps their identity AND
// any answers they already submitted. The display name updates on rejoin
// (lets a player fix a typo without losing their seat).
//
// We use the admin client because at the moment of first join, the player
// row doesn't exist yet — meaning `current_player_id()` returns NULL and
// RLS would deny the insert. After the row exists, downstream calls go
// through the RLS-aware server client.

import type { NextRequest } from "next/server";
import { CreatePlayerSchema } from "@/lib/api/schemas";
import { badRequest, ok, serverError, unauthorized, notFound, forbidden } from "@/lib/api/responses";
import { getDeviceId } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  const deviceId = await getDeviceId();
  if (!deviceId) return unauthorized("no device session");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }
  const parsed = CreatePlayerSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  const admin = getSupabaseAdmin();

  // Pre-flight: the night must exist, not be closed, and not be locked.
  // (Lock = host's "private game" toggle; closed = night is over.)
  const { data: night } = await admin
    .from("nights")
    .select("id, is_locked, closed_at")
    .eq("id", parsed.data.nightId)
    .maybeSingle();
  if (!night) return notFound("night not found");
  if (night.closed_at) return forbidden("night is over");
  if (night.is_locked) return forbidden("room is locked");

  // Upsert keyed on the unique (night_id, device_id). On conflict, refresh
  // display_name + last_seen_at so the player object is current.
  const now = new Date().toISOString();
  const { data: player, error } = await admin
    .from("players")
    .upsert(
      {
        night_id: parsed.data.nightId,
        device_id: deviceId,
        display_name: parsed.data.displayName,
        last_seen_at: now,
        // Clear any prior soft-removal: if a host removed someone and they
        // rejoin, the host can re-remove. Otherwise being "stuck" is worse.
        removed_at: null,
      },
      { onConflict: "night_id,device_id" },
    )
    .select("*")
    .single();
  if (error || !player) {
    return serverError(error?.message ?? "could not join");
  }

  // Auto-opt into game 1 if it exists and isn't done. The player tapping
  // "Join Game 2" later separately participates in game 2.
  const { data: game1 } = await admin
    .from("games")
    .select("id, state")
    .eq("night_id", parsed.data.nightId)
    .eq("game_no", 1)
    .maybeSingle();
  if (game1 && (game1.state === "ready" || game1.state === "live")) {
    // Ignore conflicts — they just mean the player rejoined.
    await admin
      .from("game_participations")
      .insert({ game_id: game1.id, player_id: player.id })
      .select("id")
      .maybeSingle();
  }

  return ok({ player }, 201);
}
