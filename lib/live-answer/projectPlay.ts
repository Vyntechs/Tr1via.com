import type {
  HostLiveProjection,
  LivePlayProjection,
  LivePlayState,
  LiveRoomProjection,
  PlayerCanonicalPlayAnswer,
  PlayerLiveProjection,
} from "./contracts";

interface LiveNightSource {
  current_run_id: string;
  room_revision: number;
  control_revision: number;
}

interface LivePlaySource {
  id: string;
  game_id: string;
  question_id: string;
  status: string;
  opened_at: string;
  main_zero_at: string;
  final_window_starts_at: string | null;
  final_window_ends_at: string;
  finalize_at: string | null;
  eligible_count: number;
  confirmed_count: number;
}

interface EligibilitySource {
  play_id: string;
}

interface CanonicalAnswerSource {
  visible_slot: number;
  canonical_index: number;
  received_at: string;
  locked_at: string;
  ms_to_lock: number;
  is_correct: boolean | null;
  awarded_points: number | null;
}

interface LiveProjectionSource {
  night: LiveNightSource;
  play: LivePlaySource | null;
}

interface PlayerProjectionSource extends LiveProjectionSource {
  eligibility: EligibilitySource | null;
  answer: CanonicalAnswerSource | null;
}

export function projectLiveRoom({
  night,
  play,
}: LiveProjectionSource): LiveRoomProjection {
  return {
    runId: night.current_run_id,
    roomRevision: night.room_revision,
    controlRevision: night.control_revision,
    playId: play?.id ?? null,
    play: play ? projectPlay(play) : null,
  };
}

export function projectPlayerLiveRoom(
  source: PlayerProjectionSource,
): PlayerLiveProjection {
  return {
    ...projectLiveRoom(source),
    canAnswerThisPlay: Boolean(
      source.play && source.eligibility?.play_id === source.play.id,
    ),
    canonicalAnswer: source.answer ? projectCanonicalAnswer(source.answer) : null,
  };
}

export function projectHostLiveRoom(
  source: LiveProjectionSource,
): HostLiveProjection {
  const common = projectLiveRoom(source);
  const eligibleCount = common.play?.eligibleCount ?? 0;
  const confirmedCount = common.play?.confirmedCount ?? 0;
  return {
    ...common,
    operations: {
      eligibleCount,
      confirmedCount,
      awaitingCount: Math.max(0, eligibleCount - confirmedCount),
    },
  };
}

function projectPlay(play: LivePlaySource): LivePlayProjection {
  return {
    playId: play.id,
    gameId: play.game_id,
    questionId: play.question_id,
    state: livePlayState(play.status),
    openedAt: play.opened_at,
    mainZeroAt: play.main_zero_at,
    finalWindowStartsAt: play.final_window_starts_at,
    finalWindowEndsAt: play.final_window_ends_at,
    finalizeAt: play.finalize_at,
    eligibleCount: play.eligible_count,
    confirmedCount: play.confirmed_count,
  };
}

function projectCanonicalAnswer(
  answer: CanonicalAnswerSource,
): PlayerCanonicalPlayAnswer {
  return {
    confirmedSlot: visibleSlot(answer.visible_slot),
    canonicalIndex: canonicalIndex(answer.canonical_index),
    receivedAt: answer.received_at,
    lockedAt: answer.locked_at,
    msToLock: answer.ms_to_lock,
    isCorrect: answer.is_correct,
    awardedPoints: answer.awarded_points,
  };
}

function livePlayState(value: string): LivePlayState {
  if (
    value === "accepting" ||
    value === "all_in_hold" ||
    value === "final_window" ||
    value === "resolved" ||
    value === "undone"
  ) {
    return value;
  }
  throw new Error("invalid live play state");
}

function visibleSlot(value: number): 1 | 2 | 3 | 4 {
  if (value === 1 || value === 2 || value === 3 || value === 4) return value;
  throw new Error("invalid visible answer slot");
}

function canonicalIndex(value: number): 0 | 1 | 2 | 3 {
  if (value === 0 || value === 1 || value === 2 || value === 3) return value;
  throw new Error("invalid canonical answer index");
}
