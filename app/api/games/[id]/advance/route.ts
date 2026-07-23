// POST /api/games/:id/advance — host publishes the standings/board frame.
//
// Unlike the old component-local "Pick next" state, this append-only event is
// durable. A venue TV that misses the broadcast or reloads still derives the
// same board frame from the reveals history.

import { z } from "zod";

import { requireOwnedGame } from "@/lib/api/auth";
import { broadcastToRoom } from "@/lib/api/broadcast";
import { UuidSchema } from "@/lib/api/schemas";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "@/lib/api/responses";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const AdvanceSchema = z.object({ questionId: UuidSchema }).strict();

export async function POST(
  req: Request,
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
  const parsed = AdvanceSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  const admin = getSupabaseAdmin();
  const { data: question, error: questionError } = await admin
    .from("questions")
    .select("id, category_id, finished_at")
    .eq("id", parsed.data.questionId)
    .maybeSingle();
  if (questionError) return serverError("could not read question");
  if (!question) return notFound("question not found");

  const { data: category, error: categoryError } = await admin
    .from("categories")
    .select("game_id")
    .eq("id", question.category_id)
    .maybeSingle();
  if (categoryError) return serverError("could not read category");
  if (!category) return notFound("category not found");
  if (category.game_id !== gameId) return forbidden("question is not in this game");
  if (!question.finished_at) return conflict("answer is not resolved yet");

  const occurredAt = new Date().toISOString();
  const { data: applied, error: insertError } = await (admin.rpc as unknown as (
    name: "record_standings_advance",
    args: {
      p_game_id: string;
      p_question_id: string;
      p_resolved_at: string;
      p_occurred_at: string;
    },
  ) => PromiseLike<{ data: boolean | null; error: { message: string } | null }>)(
    "record_standings_advance",
    {
      p_game_id: gameId,
      p_question_id: question.id,
      p_resolved_at: question.finished_at,
      p_occurred_at: occurredAt,
    },
  );
  if (insertError) {
    return serverError("could not show standings");
  }

  if (!applied) {
    return ok({ state: "standings-board", occurredAt, repeated: true });
  }

  try {
    await broadcastToRoom(owned.night.room_code, "advance", {
      questionId: question.id,
      serverNow: occurredAt,
    });
  } catch {
    // The durable row is authority; every TV also performs a safety refresh.
    console.warn("broadcast standings advance failed");
  }

  return ok({ state: "standings-board", occurredAt, repeated: false });
}
