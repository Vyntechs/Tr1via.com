// GET /api/room-magic/reactions/recent?code=ABC123 — durable replay source
// for cosmetic Room Magic reactions when a TV/host display misses the live
// realtime broadcast.

import { type NextRequest, type NextResponse } from "next/server";

import { badRequest, notFound, ok, serverError } from "@/lib/api/responses";
import { isValidRoomCode, parseRoomCode } from "@/lib/game/room-code";
import { isRoomMagicReactionKind } from "@/lib/room-magic/reactions";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECENT_REACTION_WINDOW_MS = 30_000;
const RECENT_REACTION_LIMIT = 25;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const code = parseRoomCode(req.nextUrl.searchParams.get("code") ?? "");
  if (!isValidRoomCode(code)) return badRequest("invalid room code");

  const admin = getSupabaseAdmin();
  const { data: night, error: nightError } = await admin
    .from("nights")
    .select("id, room_magic_enabled")
    .eq("room_code", code)
    .maybeSingle();
  if (nightError) return serverError(nightError.message);
  if (!night) return notFound("room not found");
  if (night.room_magic_enabled !== true) return ok({ reactions: [] });

  const since = new Date(Date.now() - RECENT_REACTION_WINDOW_MS).toISOString();
  const { data, error } = await admin
    .from("room_magic_reactions")
    .select("kind, question_id, player_id, created_at")
    .eq("night_id", night.id)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(RECENT_REACTION_LIMIT);
  if (error) return serverError(error.message);

  const reactions = ((data ?? []) as Array<Record<string, unknown>>)
    .filter((row) => isRoomMagicReactionKind(row.kind))
    .map((row) => ({
      kind: row.kind,
      questionId: String(row.question_id),
      playerId: String(row.player_id),
      serverNow: String(row.created_at),
    }));

  return ok({ reactions });
}
