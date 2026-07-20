// POST /api/games/:id/start — host starts a game.
//
// Marks the game state 'live' and stamps started_at. The TV's state
// machine moves from grid → "waiting for first reveal" on this transition.
// The 'state' column has a CHECK constraint that rejects illegal moves
// (e.g. you can't start a 'done' game).

import { z } from "zod";

import { ok, forbidden, unauthorized, serverError, notFound, conflict, badRequest } from "@/lib/api/responses";
import { requireOwnedGame } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { UuidSchema } from "@/lib/api/schemas";
import {
  broadcastAppliedLiveRoomEvent,
  broadcastGameStarted,
} from "@/lib/api/broadcast";
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
    const { data, error } = await admin.rpc("start_live_game", {
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
      (envelope.result.eventKind !== "game_started" ||
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
          console.warn("broadcast game-started failed");
        }
      }
    }
    return ok(envelope.result);
  }

  const { data: existing } = await admin
    .from("games")
    .select("state")
    .eq("id", id)
    .single();
  if (!existing) return notFound("game vanished");

  // Idempotent: already-live returns 200 so an accidental double-click of
  // Start is harmless. Done games can't restart — that would clobber
  // history.
  if (existing.state === "live") {
    try {
      await broadcastGameStarted(owned.night.room_code, id);
    } catch {
      console.warn("broadcast legacy game-started failed");
    }
    return ok({ state: "live" });
  }
  if (existing.state === "done") {
    return conflict("game is already done");
  }

  // Refuse to start an empty game. Without at least one ready category, the
  // TV would render a blank "0 of 0 ANSWERED" board with no way to advance —
  // the host needs to generate questions first.
  const { count: readyCategoryCount } = await admin
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("game_id", id)
    .eq("state", "ready");
  if (!readyCategoryCount || readyCategoryCount === 0) {
    return badRequest(
      "this game has no questions yet — generate categories before starting",
    );
  }

  const startedAt = new Date().toISOString();
  const { error } = await admin
    .from("games")
    .update({ state: "live", started_at: startedAt })
    .eq("id", id);
  if (error) return serverError(error.message);
  try {
    await broadcastGameStarted(owned.night.room_code, id);
  } catch {
    // The database mutation is durable; a missed best-effort wake-up heals on
    // each surface's safety refresh and must not make Start look unsuccessful.
    console.warn("broadcast legacy game-started failed");
  }
  return ok({ state: "live", startedAt });
}
