// POST /api/players/:id/heartbeat — phone pings to keep `last_seen_at` fresh
// and to report time spent off the app (visibility-change tracking).
//
// Why: the host's roster screen wants to surface "idle" players (gone for
// >30s) and a quiet cheat signal ("this player has been off-app for 12s of
// the last reveal"). Phone calls this on visibility change AND every 5s
// while visible.
//
// The body is optional. With no body it's just a last_seen_at bump. With
// `{ appSwitchSeconds: N }` it increments the running total.

import type { NextRequest } from "next/server";
import { HeartbeatSchema } from "@/lib/api/schemas";
import { badRequest, noContent, serverError, unauthorized, notFound } from "@/lib/api/responses";
import { requireOwnedPlayer } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const owned = await requireOwnedPlayer(id);
  if (!owned.ok) {
    return owned.status === 401 ? unauthorized(owned.error) : notFound(owned.error);
  }

  // Body is optional — if missing or empty, treat as a bare heartbeat.
  let parsedSeconds: number | null = null;
  const text = await req.text();
  if (text.length > 0) {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return badRequest("invalid JSON");
    }
    const parsed = HeartbeatSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error);
    parsedSeconds = parsed.data.appSwitchSeconds ?? null;
  }

  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  // Atomic update — incrementing app_switch_total_seconds at the SQL level
  // avoids a read-modify-write race when the phone sends two heartbeats
  // close together.
  if (parsedSeconds !== null && parsedSeconds > 0) {
    const { error } = await admin
      .from("players")
      .update({
        last_seen_at: now,
        app_switch_total_seconds: owned.player.app_switch_total_seconds + parsedSeconds,
      })
      .eq("id", id);
    if (error) return serverError(error.message);
  } else {
    const { error } = await admin
      .from("players")
      .update({ last_seen_at: now })
      .eq("id", id);
    if (error) return serverError(error.message);
  }
  return noContent();
}
