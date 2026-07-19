// POST /api/games/:id/end-early — host short-circuits a question timer (theme-derived; 30s for every theme).
//
// Used when "everyone has obviously answered, let's see the result." Manual
// presses reuse resolve_question(); guarded auto-reveal uses a DB-side
// check-and-resolve RPC so a late participant cannot slip between app reads
// and the resolve. After RPC, broadcast 'end-early' so the rest of the devices
// skip straight to reveal.
//
// Note: resolve_question is idempotent. If a phone's timer races us and
// also calls /api/questions/:id/resolve, only the first call does work
// (the second sees `finished_at IS NOT NULL` and returns no-op).

import type { NextRequest } from "next/server";
import { EndEarlySchema, HostPlayCommandSchema } from "@/lib/api/schemas";
import { badRequest, ok, forbidden, unauthorized, serverError, notFound, conflict } from "@/lib/api/responses";
import { requireOwnedGame } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { broadcastAppliedLiveRoomEvent, broadcastToRoom } from "@/lib/api/broadcast";
import { projectExactLiveEvent } from "@/lib/live-answer/projectEvent";
import { freshLiveEventFromRpc, parseLiveCommandRpcEnvelope } from "@/lib/live-answer/rpcResult";

export async function POST(
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
    const { data: didResolve, error: rpcError } = await admin.rpc(
      "resolve_question_if_all_locked",
      {
        p_question_id: legacy.questionId,
      },
    );
    if (rpcError) return serverError(rpcError.message);
    if (!didResolve) {
      return conflict("not all eligible players are locked");
    }
  } else {
    const { error: rpcError } = await admin.rpc("resolve_question", {
      p_question_id: legacy.questionId,
    });
    if (rpcError) return serverError(rpcError.message);
  }

  // Broadcast end-early as a hint that the reveal is "early"; phones can
  // animate the timer ring "snapping" to 0 rather than naturally winding.
  // Carry correctIndex (same as the 'resolve' broadcast) so the player reveal
  // gets the answer straight from this message — players can no longer read
  // correct_index off the questions row (migration 0014).
  try {
    await broadcastToRoom(owned.night.room_code, "end-early", {
      questionId: legacy.questionId,
      correctIndex: q.correct_index,
      serverNow: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("broadcast end-early failed", e);
  }

  return ok({ resolvedAt: new Date().toISOString() });
}
