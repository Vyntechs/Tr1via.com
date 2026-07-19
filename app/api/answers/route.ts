// POST /api/answers — player submits an answer.
//
// Legacy nights retain the question/scramble path below. Resilient nights use
// an opaque play/run/submission tuple and let the database derive identity,
// eligibility, canonical choice, receipt time, and idempotent confirmation.
//
// Legacy validation chain (in order; any failure shorts out):
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
import { ResilientAnswerSchema, SubmitAnswerSchema } from "@/lib/api/schemas";
import { badRequest, noContent, forbidden, unauthorized, serverError, notFound, conflict, ok } from "@/lib/api/responses";
import { getDeviceId } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { scrambleFor } from "@/lib/game/scramble";
import { broadcastAppliedLiveRoomEvent } from "@/lib/api/broadcast";
import { projectExactLiveEvent } from "@/lib/live-answer/projectEvent";
import { projectLiveRoom } from "@/lib/live-answer/projectPlay";
import {
  freshLiveEventFromRpc,
  parseLiveAnswerRpcEnvelope,
} from "@/lib/live-answer/rpcResult";

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

async function loadCurrentLiveRoom(admin: AdminClient, nightId: string) {
  // A current projection spans the night revision and latest play rows. Read
  // the night twice so a play transition between those reads cannot pair an
  // old revision with a newer play (or vice versa).
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: before, error: beforeError } = await admin
      .from("nights")
      .select(
        "id, answer_engine, current_run_id, room_revision, control_revision",
      )
      .eq("id", nightId)
      .maybeSingle();
    if (
      beforeError ||
      !before ||
      before.answer_engine !== "resilient_v1" ||
      !before.current_run_id
    ) {
      return null;
    }
    const { data: currentPlay, error: playError } = await admin
      .from("question_plays")
      .select(
        "id, night_id, run_id, game_id, question_id, status, opened_at, main_zero_at, final_window_starts_at, final_window_ends_at, finalize_at, eligible_count, confirmed_count",
      )
      .eq("night_id", nightId)
      .eq("run_id", before.current_run_id)
      .neq("status", "undone")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (playError) return null;
    const { data: after, error: afterError } = await admin
      .from("nights")
      .select("answer_engine, current_run_id, room_revision, control_revision")
      .eq("id", nightId)
      .maybeSingle();
    if (afterError || !after || after.answer_engine !== "resilient_v1") {
      return null;
    }
    if (
      before.current_run_id !== after.current_run_id ||
      before.room_revision !== after.room_revision ||
      before.control_revision !== after.control_revision
    ) {
      continue;
    }
    return projectLiveRoom({
      night: {
        current_run_id: after.current_run_id,
        room_revision: after.room_revision,
        control_revision: after.control_revision,
      },
      play: currentPlay,
    });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const deviceId = await getDeviceId();
  if (!deviceId) return unauthorized("no device session");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }
  const resilient = ResilientAnswerSchema.safeParse(body);
  const legacy = SubmitAnswerSchema.safeParse(body);
  if (!resilient.success && !legacy.success) return badRequest(resilient.error);

  const admin = getSupabaseAdmin();

  if (resilient.success) {
    const input = resilient.data;
    const { data: play, error: playError } = await admin
      .from("question_plays")
      .select(
        "id, night_id, run_id, game_id, question_id, status, opened_at, main_zero_at, final_window_starts_at, final_window_ends_at, finalize_at, eligible_count, confirmed_count",
      )
      .eq("id", input.playId)
      .maybeSingle();
    if (playError) return serverError();
    if (!play) return notFound("play not found");

    const { data: night, error: nightError } = await admin
      .from("nights")
      .select(
        "id, answer_engine, current_run_id, room_code, room_revision, control_revision",
      )
      .eq("id", play.night_id)
      .maybeSingle();
    if (nightError) return serverError();
    if (!night) return notFound("night not found");
    if (night.answer_engine !== "resilient_v1") {
      return conflict("answer engine mismatch");
    }
    if (!night.room_code || !night.current_run_id) return serverError();

    const { data: rpcData, error: rpcError } = await admin.rpc(
      "submit_question_play_answer",
      {
        p_play_id: input.playId,
        p_run_id: input.runId,
        p_submission_id: input.submissionId,
        p_verified_device_id: deviceId,
        p_visible_slot: input.slotChosen,
      },
    );
    if (rpcError) return serverError();

    const envelope = parseLiveAnswerRpcEnvelope(rpcData);
    if (!envelope) return serverError();
    const result = envelope.result;
    if (result.code !== "confirmed") {
      if (
        result.code === "deadline_passed" ||
        result.code === "identity_invalid" ||
        result.code === "not_eligible" ||
        result.code === "retry_later"
      ) {
        return ok(result);
      }
      if (result.code === "stale") return conflict("stale live play");
      if (result.code === "invalid_request") return badRequest("invalid answer");
      return serverError();
    }

    // The result ancestry must agree with the exact request and lookup. A
    // well-shaped response for a different play is still unsafe to expose.
    if (
      result.runId !== input.runId ||
      result.playId !== input.playId ||
      (result.gameId !== undefined && result.gameId !== play.game_id) ||
      (result.questionId !== undefined && result.questionId !== play.question_id)
    ) {
      return serverError();
    }

    let exactLive = null;
    const freshEvent = freshLiveEventFromRpc(envelope);
    if (freshEvent) {
      exactLive = await projectExactLiveEvent(night.id, freshEvent);
      if (exactLive) {
        try {
          await broadcastAppliedLiveRoomEvent(night.room_code, {
            applied: true,
            freshness: "transaction_winner",
            kind: freshEvent.kind,
            serverNow: new Date().toISOString(),
            live: exactLive,
          });
        } catch {
          console.warn("live answer broadcast failed");
        }
      }
    }

    const responseLive = exactLive ?? await loadCurrentLiveRoom(admin, night.id);
    if (!responseLive) return serverError();
    return ok({
      code: result.code,
      confirmedSlot: result.confirmedSlot,
      duplicate: result.duplicate,
      live: responseLive,
    });
  }

  const parsed = legacy;
  if (!parsed.success) return badRequest(parsed.error);

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

  const { data: night, error: nightError } = await admin
    .from("nights")
    .select("id, answer_engine")
    .eq("id", nightId)
    .maybeSingle();
  if (nightError) return serverError();
  if (!night) return notFound("night not found");
  if (night.answer_engine !== "legacy") {
    return badRequest("resilient answer payload required");
  }

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
