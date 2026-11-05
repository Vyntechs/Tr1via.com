// POST /api/games/:id/end-early — host short-circuits a question timer (theme-derived; 25s for every theme).
//
// Used when "everyone has obviously answered, let's see the result." Both a
// manual press and guarded auto-reveal close through resolve_question_once,
// which names one winner. Only the winner broadcasts 'end-early', so the rest
// of the devices skip straight to reveal exactly once; a loser gets a 409.
//
// Guarded auto-reveal checks "everyone has answered" with plain reads. It does
// not call resolve_question_if_all_locked, whose table locks stall every open
// night and which answers true for a question already closed. The cost is that
// a player joining in the few milliseconds between the reads and the close
// misses this question.

import type { NextRequest } from "next/server";
import { EndEarlySchema, HostPlayCommandSchema } from "@/lib/api/schemas";
import { badRequest, ok, forbidden, unauthorized, serverError, notFound, conflict } from "@/lib/api/responses";
import { requireOwnedGame } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { broadcastAppliedLiveRoomEvent, broadcastFireworks, broadcastToRoom } from "@/lib/api/broadcast";
import { projectExactLiveEvent } from "@/lib/live-answer/projectEvent";
import { freshLiveEventFromRpc, parseLiveCommandRpcEnvelope } from "@/lib/live-answer/rpcResult";
import { withActionLog } from "@/lib/diagnostics/serverLog";
import { questionDurationFor } from "@/lib/theme/lockInCeremony";
import { recordCloseOnResolveRow } from "@/lib/live/closeDue";
import { liveCloseModeFor } from "@/lib/live/liveCloseMode";
import { closeLateMs, logClose } from "@/lib/live/logClose";

/**
 * True when at least one player can answer and every one of them has. An answer
 * from someone no longer eligible counts for nothing. Null means a read failed.
 */
async function everyEligiblePlayerLocked(
  admin: ReturnType<typeof getSupabaseAdmin>,
  gameId: string,
  nightId: string,
  questionId: string,
): Promise<boolean | null> {
  const [participants, activePlayers, answers] = await Promise.all([
    admin.from("game_participations").select("player_id").eq("game_id", gameId),
    admin
      .from("players")
      .select("id")
      .eq("night_id", nightId)
      .is("removed_at", null)
      .eq("can_answer", true),
    admin.from("answers").select("player_id").eq("question_id", questionId),
  ]);
  if (participants.error || activePlayers.error || answers.error) return null;

  const active = new Set((activePlayers.data ?? []).map((row) => row.id));
  const answered = new Set((answers.data ?? []).map((row) => row.player_id));
  const eligible = (participants.data ?? [])
    .map((row) => row.player_id)
    .filter((playerId) => active.has(playerId));
  return eligible.length > 0 && eligible.every((id) => answered.has(id));
}

async function postEndEarly(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await ctx.params;
  const owned = await requireOwnedGame(gameId);
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
  const parsed = (
    owned.night.answer_engine === "resilient_v1"
      ? HostPlayCommandSchema
      : EndEarlySchema
  ).safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  const admin = getSupabaseAdmin();
  if (owned.night.answer_engine === "resilient_v1") {
    const command = HostPlayCommandSchema.parse(parsed.data);
    const { data, error } = await admin.rpc("begin_question_play_final_window", {
      p_game_id: gameId,
      p_play_id: command.playId,
      p_run_id: command.runId,
      p_command_id: command.commandId,
      p_expected_control_revision: command.expectedControlRevision,
    });
    if (error) return serverError("could not update live game");
    const envelope = parseLiveCommandRpcEnvelope(data);
    if (!envelope) return serverError("could not update live game");
    if (
      "eventKind" in envelope.result &&
      ((envelope.result.eventKind !== "final_window_started" &&
        envelope.result.eventKind !== "play_resolved") ||
        !("playId" in envelope.result) ||
        envelope.result.playId !== command.playId)
    ) {
      return serverError("could not update live game");
    }
    const fresh = freshLiveEventFromRpc(envelope);
    if (fresh) {
      const live = await projectExactLiveEvent(owned.night.id, fresh);
      if (live) {
        try {
          await broadcastAppliedLiveRoomEvent(owned.night.room_code, {
            applied: true,
            freshness: "transaction_winner",
            kind: fresh.kind,
            serverNow: new Date().toISOString(),
            live,
          });
        } catch {
          console.warn("broadcast show-answer failed");
        }
        if (fresh.kind === "play_resolved" && live.play?.questionId) {
          try {
            await broadcastFireworks(
              owned.night.room_code,
              "salvo",
              live.play.questionId,
            );
          } catch {
            console.warn("broadcast question fireworks failed");
          }
        }
        if (fresh.kind === "play_resolved" && live.play?.questionId) {
          logClose({
            questionId: live.play.questionId,
            roomCode: owned.night.room_code,
            closedBy: "host",
            lateMs: closeLateMs(Date.now(), Date.parse(live.play.mainZeroAt)),
          });
        }
      }
    }
    return ok(envelope.result);
  }
  const legacy = EndEarlySchema.parse(parsed.data);

  // Sanity: question must belong to this game and be in 'live' state
  // (played_at set, finished_at null). The stored proc raises on the
  // never-revealed case too, but we want a clean 409 not a 500. We do
  // two lookups since the stub types don't carry FK relationships for
  // joined selects.
  const { data: q } = await admin
    .from("questions")
    .select("id, category_id, played_at, finished_at, correct_index")
    .eq("id", legacy.questionId)
    .maybeSingle();
  if (!q) return notFound("question not found");
  const { data: cat } = await admin
    .from("categories")
    .select("game_id")
    .eq("id", q.category_id)
    .maybeSingle();
  if (!cat) return notFound("category not found");
  if (cat.game_id !== gameId) return forbidden("question is not in this game");
  if (!q.played_at) return conflict("question is not live");
  if (q.finished_at) return conflict("question is already resolved");

  if (legacy.requireAllLocked) {
    const allLocked = await everyEligiblePlayerLocked(
      admin,
      gameId,
      owned.night.id,
      legacy.questionId,
    );
    if (allLocked === null) return serverError("could not check locked players");
    if (!allLocked) return conflict("not all eligible players are locked");
  }

  const { data: didResolve, error: rpcError } = await admin.rpc(
    "resolve_question_once",
    { p_question_id: legacy.questionId },
  );
  if (rpcError) return serverError(rpcError.message);
  if (!didResolve) return conflict("question is already resolved");
  const closedAtMs = Date.now();

  // Broadcast end-early as a hint that the reveal is "early"; phones can
  // animate the timer ring "snapping" to 0 rather than naturally winding.
  // Carry correctIndex (same as the 'resolve' broadcast) so the player reveal
  // gets the answer straight from this message — players can no longer read
  // correct_index off the questions row (migration 0014).
  try {
    await broadcastToRoom(owned.night.room_code, "end-early", {
      questionId: legacy.questionId,
      correctIndex: q.correct_index,
      serverNow: new Date(closedAtMs).toISOString(),
    });
  } catch (e) {
    console.warn("broadcast end-early failed", e);
  }
  const closedBy = legacy.requireAllLocked ? "host-auto" : "host";
  const lateMs = closeLateMs(
    closedAtMs,
    new Date(q.played_at).getTime() + questionDurationFor(undefined) * 1_000,
  );
  logClose({
    questionId: legacy.questionId,
    roomCode: owned.night.room_code,
    closedBy,
    lateMs,
  });
  if (liveCloseModeFor(owned.night.id) === "on") {
    await recordCloseOnResolveRow(admin, {
      questionId: legacy.questionId,
      closedBy,
      lateMs,
    });
  }

  return ok({ resolvedAt: new Date(closedAtMs).toISOString() });
}

export const POST = withActionLog("end_early", postEndEarly, { idKind: "game" });
