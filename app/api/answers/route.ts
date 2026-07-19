// POST /api/answers — player submits an answer.
//
// Validation chain (in order; any failure shorts out):
//   1. Device cookie identifies a player.
//   2. The question is live (played_at set, finished_at null).
//   3. The player has a game_participations row for the question's game.
//   4. The submitted `scramble` matches what scrambleFor(qId, playerId)
//      computes — anti-tamper. If a malicious client tried to claim a
//      different slot was correct, the scramble check rejects it.
//
// We translate the player's `slotChosen` (1..4 — the visible slot on the
// phone) into a canonical `chosen_index` (0..3 — what the host's question
// row calls the correct answer) by indexing the scramble. The DB stores
// chosen_index so scoring at T+20 is a simple `chosen_index == correct_index`.
//
// `ms_to_lock` is computed server-side from questions.played_at; we don't
// trust the client clock. is_correct + awarded_points remain NULL until
// resolve_question() runs.
//
// Note on Supabase joins: the local types.ts stub doesn't declare the FK
// relationships, so nested-select would not compile. We do three small
// lookups in sequence — still single-region, still fast, but typed cleanly.

import type { NextRequest } from "next/server";
import { SubmitAnswerSchema } from "@/lib/api/schemas";
import { badRequest, noContent, forbidden, unauthorized, serverError, notFound, conflict } from "@/lib/api/responses";
import { getDeviceId } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { scrambleFor } from "@/lib/game/scramble";

export async function POST(req: NextRequest) {
  const deviceId = await getDeviceId();
  if (!deviceId) return unauthorized("no device session");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }
  const parsed = SubmitAnswerSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  const admin = getSupabaseAdmin();

  // Look up the question, then its category, then the game and night.
  // (Avoids the join-typings issue with our stub types.)
  const { data: q, error: questionError } = await admin
    .from("questions")
    .select("id, category_id, played_at, finished_at, correct_index")
    .eq("id", parsed.data.questionId)
    .maybeSingle();
  if (questionError) return serverError();
  if (!q) return notFound("question not found");
  if (!q.played_at) return conflict("question is not live");
  if (q.finished_at) return conflict("question is closed");

  const { data: cat, error: categoryError } = await admin
    .from("categories")
    .select("id, game_id")
    .eq("id", q.category_id)
    .maybeSingle();
  if (categoryError) return serverError();
  if (!cat) return notFound("category not found");
  const gameId = cat.game_id;

  const { data: game, error: gameError } = await admin
    .from("games")
    .select("id, night_id")
    .eq("id", gameId)
    .maybeSingle();
  if (gameError) return serverError();
  if (!game) return notFound("game not found");
  const nightId = game.night_id;

  // Resolve the player row for this device + night.
  const { data: player, error: playerError } = await admin
    .from("players")
    .select("id, removed_at")
    .eq("night_id", nightId)
    .eq("device_id", deviceId)
    .maybeSingle();
  if (playerError) return serverError();
  if (!player) return forbidden("not joined to this night");
  if (player.removed_at) return forbidden("you have been removed");

  // Verify per-game participation. Players who joined the night but didn't
  // opt into this game (e.g. arrived after game 1 ended, didn't hit Join
  // Game 2) shouldn't be able to answer.
  const { data: participation, error: participationError } = await admin
    .from("game_participations")
    .select("id")
    .eq("game_id", gameId)
    .eq("player_id", player.id)
    .maybeSingle();
  if (participationError) return serverError();
  if (!participation) return forbidden("not in this game");

  // Anti-tamper: the scramble the client sent must equal what we compute
  // for (questionId, playerId). If it doesn't, either the client is being
  // tampered with or there's a bug — either way, refuse.
  const expected = scrambleFor(parsed.data.questionId, player.id);
  const provided = parsed.data.scramble;
  if (
    provided[0] !== expected[0] ||
    provided[1] !== expected[1] ||
    provided[2] !== expected[2] ||
    provided[3] !== expected[3]
  ) {
    return forbidden("scramble mismatch");
  }

  // Translate visible slot (1..4) to canonical index via the scramble:
  // scramble[slot-1] is the canonical option index the phone showed in that
  // slot. Out-of-range is impossible because SubmitAnswerSchema clamps to 1..4.
  const chosenIndex = expected[parsed.data.slotChosen - 1] as 0 | 1 | 2 | 3;
  const msToLock = Math.max(
    0,
    Date.now() - new Date(q.played_at).getTime(),
  );

  const { error } = await admin
    .from("answers")
    .insert({
      question_id: parsed.data.questionId,
      player_id: player.id,
      chosen_index: chosenIndex,
      scramble: provided,
      ms_to_lock: msToLock,
    });
  if (error) {
    // 23505 = duplicate (player already answered this question). The
    // rules say one answer per (player, question); surface as 409 so
    // the UI can show "you already answered" rather than spinning.
    if (error.code === "23505") return conflict("already answered");
    return serverError();
  }

  return noContent();
}
