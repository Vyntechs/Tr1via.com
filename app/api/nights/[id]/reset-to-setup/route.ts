// POST /api/nights/:id/reset-to-setup — host rolls a started/finished
// night back to the setup screen.
//
// Ownership enforced via requireOwnedNight (same pattern as /open,
// /close). The actual wipe is one Postgres RPC for atomicity — partial
// failure here would leave the game in an unrepresentable state.
// Idempotent: if no games are in live/done, the RPC returns zero counts
// and nothing changes.

import { z } from "zod";

import { UuidSchema } from "@/lib/api/schemas";
import { badRequest, forbidden, notFound, ok, serverError, unauthorized } from "@/lib/api/responses";
import { requireOwnedNight } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { broadcastAppliedLiveRoomEvent } from "@/lib/api/broadcast";
import { projectExactLiveEvent } from "@/lib/live-answer/projectEvent";
import { freshLiveEventFromRpc, parseLiveCommandRpcEnvelope } from "@/lib/live-answer/rpcResult";

const LiveNightCommandSchema = z.object({
  runId: UuidSchema,
  commandId: UuidSchema,
  expectedControlRevision: z.number().int().nonnegative(),
}).strict();

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const owned = await requireOwnedNight(id);
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
    const command = LiveNightCommandSchema.safeParse(body);
    if (!command.success) return badRequest(command.error);
    const { data, error } = await admin.rpc("reset_live_night_to_setup", {
      p_night_id: id,
      p_run_id: command.data.runId,
      p_command_id: command.data.commandId,
      p_expected_control_revision: command.data.expectedControlRevision,
    });
    if (error) return serverError("could not update live game");
    const envelope = parseLiveCommandRpcEnvelope(data);
    if (!envelope) return serverError("could not update live game");
    if (
      "eventKind" in envelope.result &&
      (envelope.result.eventKind !== "night_reset" ||
        !("previousRunId" in envelope.result) ||
        envelope.result.previousRunId !== command.data.runId)
    ) {
      return serverError("could not update live game");
    }
    const fresh = freshLiveEventFromRpc(envelope);
    if (fresh) {
      const live = await projectExactLiveEvent(id, fresh);
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
          console.warn("broadcast night-reset failed");
        }
      }
    }
    return ok(envelope.result);
  }

  const { data, error } = await admin.rpc("reset_night_to_setup", {
    p_night_id: id,
  });
  if (error) return serverError(error.message ?? "could not reset night");

  return ok(data ?? {});
}
