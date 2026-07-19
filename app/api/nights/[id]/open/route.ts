// POST /api/nights/:id/open — host opens the room to players.
//
// Stamps `opened_at` so the lobby screen knows the room is "live for join."
// Idempotent: re-opening a night that's already open is a no-op (we don't
// bump opened_at, so leaderboard "joined at" deltas stay stable).

import { randomUUID } from "node:crypto";

import { ok, forbidden, unauthorized, serverError, notFound, conflict } from "@/lib/api/responses";
import { requireOwnedNight } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { broadcastAppliedLiveRoomEvent } from "@/lib/api/broadcast";
import { projectExactLiveEvent } from "@/lib/live-answer/projectEvent";
import {
  freshLiveEventFromRpc,
  parseLiveCommandRpcEnvelope,
} from "@/lib/live-answer/rpcResult";

export async function POST(
  _req: Request,
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
  const { data: rpcData, error: rpcError } = await admin.rpc("open_night_run", {
    p_night_id: id,
    p_command_id: randomUUID(),
    // Postgres accepts null for the first run even though generated function
    // argument types cannot express SQL parameter nullability.
    p_expected_run_id: owned.night.current_run_id as string,
    p_expected_control_revision: owned.night.control_revision ?? 0,
  });
  if (rpcError) return serverError("could not open night");

  const resilient = parseLiveCommandRpcEnvelope(rpcData);
  const legacy = parseLegacyOpenEnvelope(rpcData);
  if (!resilient && !legacy) return serverError("could not open night");

  const freshEvent = freshLiveEventFromRpc(resilient);
  if (freshEvent) {
    const live = await projectExactLiveEvent(id, freshEvent);
    if (live) {
      try {
        await broadcastAppliedLiveRoomEvent(owned.night.room_code, {
          applied: true,
          freshness: "transaction_winner",
          kind: freshEvent.kind,
          serverNow: new Date().toISOString(),
          live,
        });
      } catch (error) {
        console.warn("broadcast night-opened failed", error);
      }
    }
  }

  // The RPC owns engine selection and the entire open mutation. Re-read only
  // the durable outcome; never pre-read rollout settings or pre-update the
  // night in the route.
  const { data: durable, error: durableError } = await admin
    .from("nights")
    .select("opened_at, answer_engine, current_run_id, room_revision, control_revision")
    .eq("id", id)
    .maybeSingle();
  if (durableError || !durable?.opened_at) {
    if (resilient?.result.code === "stale") {
      return conflict("night state changed; try again");
    }
    return serverError("could not open night");
  }
  return ok({ openedAt: durable.opened_at });
}

function parseLegacyOpenEnvelope(value: unknown): {
  code: "legacy_opened" | "already_open";
  openedAt: string;
} | null {
  if (!isExactRecord(value, ["freshlyApplied", "result"])) return null;
  if (value.freshlyApplied !== false) return null;
  const result = value.result;
  if (!isExactRecord(result, ["code", "openedAt"])) return null;
  if (result.code !== "legacy_opened" && result.code !== "already_open") {
    return null;
  }
  if (
    typeof result.openedAt !== "string" ||
    !Number.isFinite(Date.parse(result.openedAt))
  ) {
    return null;
  }
  return { code: result.code, openedAt: result.openedAt };
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}
