import { z } from "zod";

import {
  broadcastAppliedLiveRoomEvent,
  broadcastFireworks,
} from "@/lib/api/broadcast";
import { badRequest, conflict, notFound, ok, serverError } from "@/lib/api/responses";
import { UuidSchema } from "@/lib/api/schemas";
import { isValidRoomCode, parseRoomCode } from "@/lib/game/room-code";
import { projectExactLiveEvent } from "@/lib/live-answer/projectEvent";
import { projectLiveRoom } from "@/lib/live-answer/projectPlay";
import {
  freshLiveEventFromRpc,
  parseLiveFinalizeRpcEnvelope,
} from "@/lib/live-answer/rpcResult";
import {
  latencyBucketFor,
  liveAnswerServerLogSink,
  recordLiveAnswerHealth,
} from "@/lib/live-answer/telemetry";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const FinalizeBodySchema = z.object({ runId: UuidSchema }).strict();
type AdminClient = ReturnType<typeof getSupabaseAdmin>;

async function loadCurrentLiveRoom(admin: AdminClient, nightId: string) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: before, error: beforeError } = await admin
      .from("nights")
      .select(
        "answer_engine, current_run_id, room_revision, control_revision",
      )
      .eq("id", nightId)
      .maybeSingle();
    if (
      beforeError ||
      !before ||
      before.answer_engine !== "resilient_v1" ||
      !before.current_run_id
    ) {
      return null;
    }
    const { data: currentPlay, error: playError } = await admin
      .from("question_plays")
      .select(
        "id, night_id, run_id, game_id, question_id, status, opened_at, main_zero_at, final_window_starts_at, final_window_ends_at, finalize_at, eligible_count, confirmed_count",
      )
      .eq("night_id", nightId)
      .eq("run_id", before.current_run_id)
      .neq("status", "undone")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (playError) return null;
    const { data: after, error: afterError } = await admin
      .from("nights")
      .select("answer_engine, current_run_id, room_revision, control_revision")
      .eq("id", nightId)
      .maybeSingle();
    if (afterError || !after || after.answer_engine !== "resilient_v1") {
      return null;
    }
    if (
      before.current_run_id !== after.current_run_id ||
      before.room_revision !== after.room_revision ||
      before.control_revision !== after.control_revision
    ) {
      continue;
    }
    return projectLiveRoom({
      night: {
        current_run_id: after.current_run_id,
        room_revision: after.room_revision,
        control_revision: after.control_revision,
      },
      play: currentPlay,
    });
  }
  return null;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string; playId: string }> },
) {
  const { code: rawCode, playId: rawPlayId } = await ctx.params;
  const roomCode = parseRoomCode(rawCode);
  const playId = UuidSchema.safeParse(rawPlayId);
  if (!isValidRoomCode(roomCode)) return badRequest("invalid room code");
  if (!playId.success) return badRequest("invalid play");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }
  const parsed = FinalizeBodySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);
  const requestStartedAt = performance.now();

  const admin = getSupabaseAdmin();
  const { data: night, error: nightError } = await admin
    .from("nights")
    .select(
      "id, room_code, answer_engine, current_run_id, room_revision, control_revision",
    )
    .eq("room_code", roomCode)
    .maybeSingle();
  if (nightError) return serverError();
  if (!night) return notFound("room not found");
  if (night.answer_engine !== "resilient_v1") {
    return conflict("answer engine mismatch");
  }

  const { data: play, error: playError } = await admin
    .from("question_plays")
    .select(
      "id, night_id, run_id, game_id, question_id, status, opened_at, main_zero_at, final_window_starts_at, final_window_ends_at, finalize_at, eligible_count, confirmed_count",
    )
    .eq("id", playId.data)
    .eq("night_id", night.id)
    .maybeSingle();
  if (playError) return serverError();
  if (!play) return notFound("play not found");
  if (
    night.current_run_id !== parsed.data.runId ||
    play.run_id !== parsed.data.runId
  ) {
    return conflict("stale live play");
  }

  const { data: rpcData, error: rpcError } = await admin.rpc(
    "finalize_current_play_if_due",
    {
      p_room_code: roomCode,
      p_run_id: parsed.data.runId,
      p_play_id: playId.data,
    },
  );
  if (rpcError) return serverError();
  const envelope = parseLiveFinalizeRpcEnvelope(rpcData);
  if (!envelope) return serverError();
  const result = envelope.result;
  if (
    ("runId" in result && result.runId !== parsed.data.runId) ||
    ("playId" in result && result.playId !== playId.data) ||
    ("gameId" in result && result.gameId !== undefined && result.gameId !== play.game_id) ||
    ("questionId" in result && result.questionId !== undefined && result.questionId !== play.question_id)
  ) {
    return serverError();
  }

  const latencyBucket = latencyBucketFor(performance.now() - requestStartedAt);
  await recordLiveAnswerHealth(
    {
      playId: playId.data,
      resultCode: result.code,
      ...(latencyBucket ? { latencyBucket } : {}),
      ...(result.code === "resolved" ? { resolutionReason: "timer" } : {}),
    },
    liveAnswerServerLogSink,
  );

  let exactLive = null;
  const freshEvent = freshLiveEventFromRpc(envelope);
  if (freshEvent) {
    exactLive = await projectExactLiveEvent(night.id, freshEvent);
    if (exactLive) {
      try {
        await broadcastAppliedLiveRoomEvent(roomCode, {
          applied: true,
          freshness: "transaction_winner",
          kind: freshEvent.kind,
          serverNow: new Date().toISOString(),
          live: exactLive,
        });
      } catch {
        console.warn("public live finalize broadcast failed");
      }
      if (freshEvent.kind === "play_resolved") {
        try {
          await broadcastFireworks(roomCode, "salvo", play.question_id);
        } catch {
          console.warn("broadcast fireworks(salvo) failed");
        }
      }
    }
  }

  const responseLive = exactLive ?? await loadCurrentLiveRoom(admin, night.id);
  if (!responseLive) return serverError();
  return ok({ result, live: responseLive });
}
