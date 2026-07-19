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
import { broadcastPlayerJoined } from "@/lib/api/broadcast";
import { playerColorKey } from "@/lib/player/playerColor";
import { serializeRoomPlayer } from "@/lib/room/roomAudience";

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
  // We also pull `room_code` so the player-joined broadcast below can
  // address the right channel without a second lookup.
  const { data: night } = await admin
    .from("nights")
    .select("id, room_code, is_locked, closed_at")
    .eq("id", parsed.data.nightId)
    .maybeSingle();
  if (!night) return notFound("night not found");
  if (night.closed_at) return forbidden("night is over");
  if (night.is_locked) return forbidden("room is locked");

  // Detect first-time joins vs rejoins. Hitting the table BEFORE the upsert
  // lets the welcome broadcast fire ONLY when the player is genuinely new
  // — a returning player on the same device shouldn't trigger a second
  // welcome moment on the TV when they reload the page.
  const { data: existing } = await admin
    .from("players")
    .select("id")
    .eq("night_id", parsed.data.nightId)
    .eq("device_id", deviceId)
    .maybeSingle();
  const isFirstJoin = !existing;

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
        // Migration 0022 makes signed-device players eligible to answer.
        // The cast is temporary until the planned Task 5 type regeneration.
        can_answer: true,
        // Clear any prior soft-removal: if a host removed someone and they
        // rejoin, the host can re-remove. Otherwise being "stuck" is worse.
        removed_at: null,
      } as never,
      { onConflict: "night_id,device_id" },
    )
    .select(
      "id, night_id, display_name, joined_at, last_seen_at, removed_at, app_switch_total_seconds",
    )
    .single();
  if (error || !player) {
    return serverError();
  }

  // Magic-Welcome broadcast — fire-and-forget. The TV's safety poll and
  // the player-row postgres_changes are still the source of truth; this
  // is purely the "wake up everyone NOW" signal so the slide-in tile,
  // gold-glow stinger, and chime can fire within ~300ms of the scan.
  //
  // We only emit on the first join for this (night, device) so that a
  // page reload from a returning player doesn't trigger a duplicate
  // welcome moment on the TV.
  if (isFirstJoin && night.room_code) {
    const colorKey = playerColorKey(player.id);
    try {
      await broadcastPlayerJoined(night.room_code, {
        id: player.id,
        displayName: player.display_name,
        joinedAt: player.joined_at,
        colorKey,
      });
    } catch (e) {
      // Best-effort: the durable players row already landed; the welcome
      // overlay will just lag by up to the TV safety-poll interval. Don't
      // fail the join.
      console.warn("broadcast player-joined failed", e);
    }
  }

  // Auto-opt into game 1 if it exists and isn't done. The player tapping
  // "Join Game 2" later separately participates in game 2.
  //
  // The gate matches the comment intent ("isn't done") — not the previous
  // narrower 'ready'/'live' check. Normal night creation (POST /api/nights)
  // inserts games in 'draft' state and stays there until the host clicks
  // the first cell (the 70fcc55 auto-start). Players who join between
  // "Open the room" and the first cell click need their participation row
  // anyway — otherwise /api/answers rejects every tap with 403.
  const { data: game1 } = await admin
    .from("games")
    .select("id, state")
    .eq("night_id", parsed.data.nightId)
    .eq("game_no", 1)
    .maybeSingle();
  if (game1 && game1.state !== "done") {
    // Ignore conflicts — they just mean the player rejoined.
    await admin
      .from("game_participations")
      .insert({ game_id: game1.id, player_id: player.id })
      .select("id")
      .maybeSingle();
  }

  return ok({ player: serializeRoomPlayer(player) }, 201);
}
