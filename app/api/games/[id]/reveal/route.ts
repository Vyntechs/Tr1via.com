// POST /api/games/:id/reveal — host reveals a question. CRITICAL PATH.
//
// This is the "one press, three surfaces" hot path. The host taps Reveal;
// in <250ms we want every phone + the TV to display the question. The
// sequence:
//   1. Verify the question is unrevealed (idempotency guard).
//   2. Stamp questions.played_at = now() AND insert a reveals row in one
//      RPC-equivalent flow. We use two updates in sequence rather than a
//      transaction-spanning function because Postgres rolls back nothing
//      that's already been broadcast.
//   3. Broadcast on room:{roomCode} so subscribers can light up the UI
//      immediately, before the (slower) Postgres Changes notification
//      arrives.
//
// The broadcast carries `serverNow` and `revealedAt` so any device that
// missed the broadcast can still reconstruct the timer from the persisted
// played_at column (durable Postgres Change). This dual path is the
// whole reason TR1VIA feels cinematic instead of janky.

import type { NextRequest } from "next/server";
import { RevealSchema } from "@/lib/api/schemas";
import { badRequest, ok, forbidden, unauthorized, serverError, notFound, conflict } from "@/lib/api/responses";
import { requireOwnedGame } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { broadcastToRoom } from "@/lib/api/broadcast";

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
  const parsed = RevealSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  const admin = getSupabaseAdmin();

  // Verify the question belongs to this game, is unrevealed, and is picked
  // (you can't reveal a candidate question that's not on the board). Two
  // lookups instead of a join — the stub types don't model FK relationships
  // for joined selects.
  const { data: question } = await admin
    .from("questions")
    .select("id, category_id, played_at, finished_at, is_picked")
    .eq("id", parsed.data.questionId)
    .maybeSingle();
  if (!question) return notFound("question not found");
  const { data: cat } = await admin
    .from("categories")
    .select("game_id")
    .eq("id", question.category_id)
    .maybeSingle();
  if (!cat) return notFound("category not found");
  if (cat.game_id !== gameId) return forbidden("question is not in this game");
  if (!question.is_picked) return conflict("question is not on the board");
  if (question.played_at) return conflict("question already revealed");

  // Stamp played_at first. If the broadcast fails, the durable state is
  // still correct — phones will pick up the reveal via Postgres Changes.
  const revealedAt = new Date().toISOString();
  const { error: stampError } = await admin
    .from("questions")
    .update({ played_at: revealedAt, finished_at: null })
    .eq("id", parsed.data.questionId)
    .is("played_at", null); // CAS guard against a double-reveal race
  if (stampError) return serverError(stampError.message);

  // Log the reveal event.
  const { error: revealError } = await admin
    .from("reveals")
    .insert({
      game_id: gameId,
      question_id: parsed.data.questionId,
      event: "reveal",
      metadata: { revealed_at: revealedAt },
    });
  if (revealError) return serverError(revealError.message);

  // Broadcast for low-latency UI animation. Includes serverNow for
  // clock-skew compensation by receivers.
  try {
    await broadcastToRoom(owned.night.room_code, "reveal", {
      questionId: parsed.data.questionId,
      revealedAt,
      serverNow: new Date().toISOString(),
    });
  } catch (e) {
    // Broadcast is best-effort; Postgres Changes will still fire. Log
    // but don't fail the request — the host's UI must succeed.
    console.warn("broadcast reveal failed", e);
  }

  return ok({ revealedAt });
}
