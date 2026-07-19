// POST /api/questions/:id/resolve — advance the due question.
//
// Legacy nights keep the security-gated resolve_question path below.
// Resilient nights resolve the server-selected current play only through
// finalize_current_play_if_due, so no phone timer can choose a deadline,
// reason, answer, player, or alternate play.
//
// Authentication: the normal timer trigger remains anonymous so the venue TV
// and player phones can race safely at T+30. Possessing the live question UUID
// is not authority to end it early, though: this handler checks the
// server-recorded reveal time against the same theme duration used by clients
// before invoking the service-role RPC. The authenticated host-only end-early
// route remains the sole production path for an early close.
//
// On legacy success, we run the scoring RPC and broadcast only the canonical
// answer plus a refetch signal. Per-player correctness and points remain in
// protected database reads; they never cross the shared room channel.

import { conflict, ok, serverError, notFound } from "@/lib/api/responses";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  broadcastAppliedLiveRoomEvent,
  broadcastToRoom,
  broadcastFireworks,
} from "@/lib/api/broadcast";
import { isTestModeEnabled } from "@/lib/api/require-test-mode";
import { questionDurationFor } from "@/lib/theme/lockInCeremony";
import { resolveTheme } from "@/lib/theme/resolveTheme";
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
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: questionId } = await ctx.params;
  const admin = getSupabaseAdmin();

  // Look up question → category → game → night.room_code through three
  // sequential queries. The stub types don't model FK relationships for
  // joined selects, so a single nested-select wouldn't typecheck.
  const { data: q, error: questionError } = await admin
    .from("questions")
    .select("id, category_id, correct_index, played_at, finished_at")
    .eq("id", questionId)
    .maybeSingle();
  if (questionError) return serverError();
  if (!q) return notFound("question not found");
  const { data: cat, error: categoryError } = await admin
    .from("categories")
    .select("game_id")
    .eq("id", q.category_id)
    .maybeSingle();
  if (categoryError) return serverError();
  if (!cat) return notFound("category not found");
  const { data: game, error: gameError } = await admin
    .from("games")
    .select("night_id")
    .eq("id", cat.game_id)
    .maybeSingle();
  if (gameError) return serverError();
  if (!game) return notFound("game not found");
  const { data: night, error: nightError } = await admin
    .from("nights")
    .select(
      "id, room_code, theme_key, answer_engine, current_run_id, room_revision, control_revision, hosts!inner(default_theme_key)",
    )
    .eq("id", game.night_id)
    .maybeSingle();
  if (nightError) return serverError();
  if (!night) return notFound("night not found");
  const roomCode = night.room_code;

  if (night.answer_engine === "resilient_v1") {
    const requestStartedAt = performance.now();
    if (!night.current_run_id) return serverError();
    const { data: plays, error: playError } = await admin
      .from("question_plays")
      .select(
        "id, night_id, run_id, game_id, question_id, status, opened_at, main_zero_at, final_window_starts_at, final_window_ends_at, finalize_at, eligible_count, confirmed_count",
      )
      .eq("night_id", night.id)
      .eq("run_id", night.current_run_id)
      .neq("status", "undone")
      .order("opened_at", { ascending: false })
      .limit(1);
    if (playError) return serverError();
    const play = plays?.[0];
    if (!play || play.question_id !== questionId) {
      return conflict("question is not the current play");
    }

    const { data: rpcData, error: finalizeError } = await admin.rpc(
      "finalize_current_play_if_due",
      {
        p_room_code: roomCode,
        p_run_id: night.current_run_id,
        p_play_id: play.id,
      },
    );
    if (finalizeError) return serverError();
    const envelope = parseLiveFinalizeRpcEnvelope(rpcData);
    if (!envelope) return serverError();
    const result = envelope.result;
    if (
      ("runId" in result && result.runId !== night.current_run_id) ||
      ("playId" in result && result.playId !== play.id) ||
      ("gameId" in result && result.gameId !== undefined && result.gameId !== play.game_id) ||
      ("questionId" in result && result.questionId !== undefined && result.questionId !== play.question_id)
    ) {
      return serverError();
    }

    const latencyBucket = latencyBucketFor(performance.now() - requestStartedAt);
    await recordLiveAnswerHealth(
      {
        playId: play.id,
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
          console.warn("live finalize broadcast failed");
        }
        if (freshEvent.kind === "play_resolved") {
          try {
            await broadcastFireworks(roomCode, "salvo", questionId);
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

  // The test-only fast-forward proxy is already protected by the two-part
  // TEST_AUTH_ENABLED + x-test-secret gate. Re-check that same gate here so
  // its request can skip elapsed time without introducing a body/query force
  // flag that could ever work in production.
  const isTestFastForward = isTestModeEnabled(req);
  if (!isTestFastForward) {
    if (!q.played_at) {
      return conflict("question is not live");
    }

    // Once resolved, keep the route's existing idempotent behavior: the RPC
    // no-ops and a retry can rebuild/broadcast the canonical result. The
    // deadline guard is needed only while the question remains live.
    if (!q.finished_at) {
      const playedAtMs = new Date(q.played_at).getTime();
      if (!Number.isFinite(playedAtMs)) return serverError();

      const host = Array.isArray(night.hosts) ? night.hosts[0] : night.hosts;
      const themeKey = resolveTheme(
        { theme_key: night.theme_key },
        { default_theme_key: host?.default_theme_key ?? null },
      );
      const resolveAtMs =
        playedAtMs + questionDurationFor(themeKey) * 1_000;
      if (Date.now() < resolveAtMs) {
        return conflict("question answer window is still open");
      }
    }
  }

  const { error: rpcError } = await admin.rpc("resolve_question", {
    p_question_id: questionId,
  });
  if (rpcError) return serverError();

  // Preserve the response's aggregate count without selecting private answer
  // details into this shared-broadcast path.
  const { data: answerRows, error: answersError } = await admin
    .from("answers")
    .select("id")
    .eq("question_id", questionId);
  if (answersError) return serverError();

  const payload = {
    questionId,
    correctIndex: q.correct_index,
    refetch: true,
    serverNow: new Date().toISOString(),
  };

  try {
    await broadcastToRoom(roomCode, "resolve", payload);
  } catch {
    console.warn("broadcast resolve failed");
  }

  // Synchronized firework salvo (July) — every July screen ignites the same
  // burst at the same instant as the answer is revealed. Cosmetic + best-effort
  // (a dropped beat never affects scoring); no-op on non-July nights.
  try {
    await broadcastFireworks(roomCode, "salvo", questionId);
  } catch {
    console.warn("broadcast fireworks(salvo) failed");
  }

  return ok({
    resolvedAt: new Date().toISOString(),
    awardCount: answerRows?.length ?? 0,
  });
}
