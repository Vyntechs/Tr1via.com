// POST /api/games/:id/end — host ends a game.
//
// Stamps ended_at and moves state → 'done'. The TV's state machine moves
// from "leaderboard" → "intermission" (game 1) or "finale winner card"
// (game 2). After this call, no new answers can be inserted (RLS on
// answers requires `questions.finished_at IS NULL` for the parent
// question, and a done game's live question — if any — should've been
// resolved before End).

import { z } from "zod";

import { UuidSchema } from "@/lib/api/schemas";
import { ok, forbidden, unauthorized, serverError, notFound, badRequest } from "@/lib/api/responses";
import { requireOwnedGame } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { broadcastAppliedLiveRoomEvent, broadcastGameEnded, broadcastFireworks } from "@/lib/api/broadcast";
import { projectExactLiveEvent } from "@/lib/live-answer/projectEvent";
import { freshLiveEventFromRpc, parseLiveCommandRpcEnvelope } from "@/lib/live-answer/rpcResult";

const LiveGameCommandSchema = z.object({
  runId: UuidSchema,
  commandId: UuidSchema,
  expectedControlRevision: z.number().int().nonnegative(),
}).strict();

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const owned = await requireOwnedGame(id);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }

  const admin = getSupabaseAdmin();
  if (owned.night.answer_engine === "resilient_v1") {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest("invalid JSON");
    }
    const command = LiveGameCommandSchema.safeParse(body);
    if (!command.success) return badRequest(command.error);
    const { data, error } = await admin.rpc("end_live_game", {
      p_game_id: id,
      p_run_id: command.data.runId,
      p_command_id: command.data.commandId,
      p_expected_control_revision: command.data.expectedControlRevision,
    });
    if (error) return serverError("could not update live game");
    const envelope = parseLiveCommandRpcEnvelope(data);
    if (!envelope) return serverError("could not update live game");
    if (
      "eventKind" in envelope.result &&
      (envelope.result.eventKind !== "game_ended" ||
        !("gameId" in envelope.result) ||
        envelope.result.gameId !== id)
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
          console.warn("broadcast game-ended failed");
        }
        try {
          await broadcastFireworks(owned.night.room_code, "finale");
        } catch {
          console.warn("broadcast fireworks(finale) failed");
        }
      }
    }
    return ok(envelope.result);
  }

  const endedAt = new Date().toISOString();
  const { data, error } = await admin
    .from("games")
    .update({ state: "done", ended_at: endedAt })
    .eq("id", id)
    .select("state, ended_at")
    .single();
  if (error || !data) return serverError(error?.message ?? "could not end game");

  // Broadcast the state flip so phones + TV refresh without waiting on
  // postgres_changes. Phones flip to PlayerJoinGame2 (if game 1 ended) or
  // out of the live screen entirely; the TV moves to intermission/finale.
  try {
    await broadcastGameEnded(owned.night.room_code, id);
  } catch (e) {
    console.warn("broadcast game-ended failed", e);
  }

  // Heavier synchronized firework eruption (July) at the game-end moment — the
  // whole room erupts together. Cosmetic + best-effort; no-op on non-July
  // nights. (The full build→erupt finale crescendo is Phase 4; this is the
  // single synchronized eruption riding the same beat primitive.)
  try {
    await broadcastFireworks(owned.night.room_code, "finale");
  } catch (e) {
    console.warn("broadcast fireworks(finale) failed", e);
  }

  return ok({ state: data.state, endedAt: data.ended_at });
}
