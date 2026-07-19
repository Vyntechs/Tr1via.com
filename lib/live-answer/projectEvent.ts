import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { projectLiveRoom } from "./projectPlay";
import type { LiveRoomProjection, LiveRoomEventKind } from "./contracts";
import type { FreshLiveEventReference } from "./rpcResult";

const PLAY_SELECT =
  "id, night_id, run_id, game_id, question_id, status, opened_at, main_zero_at, final_window_starts_at, final_window_ends_at, finalize_at, eligible_count, confirmed_count";
const GAME_SELECT = "id, night_id";

/**
 * Rebuilds the fast event from current server truth. The exact play returned by
 * the RPC is read first (including resolved/undone rows), then the night is
 * checked at the exact winner revisions. If anything has already advanced,
 * the durable snapshot path wins and no stale fast event is emitted.
 */
export async function projectExactLiveEvent(
  nightId: string,
  event: FreshLiveEventReference,
): Promise<LiveRoomProjection | null> {
  if (event.applied !== true || event.freshness !== "transaction_winner") {
    return null;
  }

  const admin = getSupabaseAdmin();
  let play: Parameters<typeof projectLiveRoom>[0]["play"] = null;

  if (event.playId) {
    const { data, error } = await admin
      .from("question_plays")
      .select(PLAY_SELECT)
      .eq("id", event.playId)
      .eq("night_id", nightId)
      .eq("run_id", event.runId)
      .maybeSingle();
    if (
      error ||
      !data ||
      data.id !== event.playId ||
      data.night_id !== nightId ||
      data.run_id !== event.runId ||
      (event.gameId !== null && data.game_id !== event.gameId) ||
      (event.questionId !== null && data.question_id !== event.questionId) ||
      !eventMatchesPlay(event.kind, data.status)
    ) {
      return null;
    }
    play = data;
  } else if (isPlayEvent(event.kind)) {
    return null;
  }

  if (isGameEvent(event.kind)) {
    if (!event.gameId) return null;
    const { data: game, error: gameError } = await admin
      .from("games")
      .select(GAME_SELECT)
      .eq("id", event.gameId)
      .eq("night_id", nightId)
      .maybeSingle();
    if (
      gameError ||
      !game ||
      game.id !== event.gameId ||
      game.night_id !== nightId
    ) {
      return null;
    }
  }

  const { data: night, error: nightError } = await admin
    .from("nights")
    .select("answer_engine, current_run_id, room_revision, control_revision")
    .eq("id", nightId)
    .maybeSingle();
  if (
    nightError ||
    !night ||
    night.answer_engine !== "resilient_v1" ||
    night.current_run_id !== event.runId ||
    night.room_revision !== event.roomRevision ||
    night.control_revision !== event.controlRevision
  ) {
    return null;
  }

  return projectLiveRoom({
    night: {
      current_run_id: event.runId,
      room_revision: event.roomRevision,
      control_revision: event.controlRevision,
    },
    play,
  });
}

function isGameEvent(kind: LiveRoomEventKind): boolean {
  return kind === "game_started" || kind === "game_ended";
}

function isPlayEvent(kind: LiveRoomEventKind): boolean {
  return (
    kind === "play_opened" ||
    kind === "answer_progress" ||
    kind === "final_window_started" ||
    kind === "play_resolved" ||
    kind === "play_undone"
  );
}

function eventMatchesPlay(kind: LiveRoomEventKind, state: string): boolean {
  switch (kind) {
    case "play_opened":
      return state === "accepting";
    case "answer_progress":
      return (
        state === "accepting" ||
        state === "all_in_hold" ||
        state === "final_window"
      );
    case "final_window_started":
      return state === "final_window";
    case "play_resolved":
      return state === "resolved";
    case "play_undone":
      return state === "undone";
    default:
      return false;
  }
}
