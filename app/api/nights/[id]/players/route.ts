// POST /api/nights/:id/players — host adds a latecomer to the night.
//
// Used when someone shows up after the room is locked, has a dead phone,
// or otherwise can't go through the normal QR/code flow. The route mints
// a synthetic device_id (uuid v4) for them and inserts a players row.
// Because they have no real device cookie, they'll never heartbeat — so
// the roster naturally shows them as off-app, which is the intended
// implicit "host-added" tell.
//
// Host-only — the calling host must own the night.

import { type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { requireOwnedNight } from "@/lib/api/auth";
import { HostAddPlayerSchema } from "@/lib/api/schemas";
import {
  badRequest,
  forbidden,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "@/lib/api/responses";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { serializeRoomPlayer } from "@/lib/room/roomAudience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: nightId } = await ctx.params;

  const owned = await requireOwnedNight(nightId);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }
  const parsed = HostAddPlayerSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  if (owned.night.closed_at) return forbidden("night is over");

  const admin = getSupabaseAdmin();
  const deviceId = randomUUID();
  const now = new Date().toISOString();

  const { data: player, error } = await admin
    .from("players")
    .insert({
      night_id: nightId,
      device_id: deviceId,
      display_name: parsed.data.displayName,
      last_seen_at: now,
      // Host-added roster names have no signed device and are score-only.
      // The cast is temporary until the planned Task 5 type regeneration.
      can_answer: false,
    } as never)
    .select(
      "id, night_id, display_name, joined_at, last_seen_at, removed_at, app_switch_total_seconds",
    )
    .single();
  if (error || !player) {
    return serverError();
  }

  // Auto-opt into the currently active game (live > ready, prefer the
  // higher game_no so a Game 2 in progress wins over a finished Game 1).
  // Mirrors the logic in POST /api/players for the normal join path.
  const { data: games } = await admin
    .from("games")
    .select("id, game_no, state")
    .eq("night_id", nightId)
    .order("game_no", { ascending: true });
  const activeGame =
    (games ?? []).find((g) => g.state === "live") ??
    (games ?? []).find((g) => g.state === "ready") ??
    null;
  if (activeGame) {
    // Swallow duplicate-key races (player added twice for any reason).
    await admin
      .from("game_participations")
      .insert({ game_id: activeGame.id, player_id: player.id });
  }

  return ok({ player: serializeRoomPlayer(player) }, 201);
}
