// POST /api/room-magic/reactions — player sends one bounded post-reveal
// reaction to the room. This is cosmetic only: it never changes answers,
// scores, timers, or durable room snapshots.

import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDeviceId } from "@/lib/api/auth";
import { broadcastRoomMagicReaction } from "@/lib/api/broadcast";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "@/lib/api/responses";
import {
  isRoomMagicReactionKind,
  type RoomMagicReactionKind,
} from "@/lib/room-magic/reactions";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    questionId: z.string().uuid(),
    kind: z
      .string()
      .refine(isRoomMagicReactionKind, { message: "unknown reaction kind" })
      .transform((value) => value as RoomMagicReactionKind),
  })
  .strict();

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  const deviceId = await getDeviceId();
  if (!deviceId) return unauthorized("no device session");

  const admin = getSupabaseAdmin();

  const { data: question, error: questionError } = await admin
    .from("questions")
    .select("id, category_id, played_at, finished_at")
    .eq("id", parsed.data.questionId)
    .maybeSingle();
  if (questionError) return serverError(questionError.message);
  if (!question) return notFound("question not found");
  if (!question.played_at || !question.finished_at) {
    return conflict("question is not resolved");
  }

  const { data: category, error: categoryError } = await admin
    .from("categories")
    .select("id, game_id")
    .eq("id", question.category_id)
    .maybeSingle();
  if (categoryError) return serverError(categoryError.message);
  if (!category) return notFound("category not found");

  const { data: game, error: gameError } = await admin
    .from("games")
    .select("id, night_id")
    .eq("id", category.game_id)
    .maybeSingle();
  if (gameError) return serverError(gameError.message);
  if (!game) return notFound("game not found");

  const { data: night, error: nightError } = await admin
    .from("nights")
    .select("id, room_code, room_magic_enabled")
    .eq("id", game.night_id)
    .maybeSingle();
  if (nightError) return serverError(nightError.message);
  if (!night) return notFound("night not found");
  if (night.room_magic_enabled !== true) {
    return forbidden("room magic disabled");
  }

  const { data: player, error: playerError } = await admin
    .from("players")
    .select("id, removed_at")
    .eq("night_id", night.id)
    .eq("device_id", deviceId)
    .is("removed_at", null)
    .maybeSingle();
  if (playerError) return serverError(playerError.message);
  if (!player) return forbidden("not joined to this night");

  const { data: participation, error: participationError } = await admin
    .from("game_participations")
    .select("id")
    .eq("game_id", game.id)
    .eq("player_id", player.id)
    .maybeSingle();
  if (participationError) return serverError(participationError.message);
  if (!participation) return forbidden("not in this game");

  const { data: insertedReaction, error: insertError } = await admin
    .from("room_magic_reactions")
    .insert({
      night_id: night.id,
      game_id: game.id,
      question_id: question.id,
      player_id: player.id,
      kind: parsed.data.kind,
    })
    .select("id, created_at")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return ok({ accepted: false, reason: "already_sent" as const });
    }
    return serverError(insertError.message);
  }
  if (!insertedReaction?.id || !insertedReaction.created_at) {
    return serverError("room magic reaction insert returned no receipt");
  }

  try {
    await broadcastRoomMagicReaction(night.room_code, {
      id: insertedReaction.id,
      kind: parsed.data.kind,
      serverNow: insertedReaction.created_at,
    });
    return ok({ accepted: true, broadcasted: true });
  } catch (error) {
    console.warn("broadcast room magic reaction failed", error);
    return ok({ accepted: true, broadcasted: false });
  }
}
