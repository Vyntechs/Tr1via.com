import type {
  AnswerRow,
  ParticipationRow,
  PlayerRow,
  QuestionRow,
} from "@/lib/supabase/types";

/** The roster fields that are safe on a room-facing surface. */
export interface RoomPlayer {
  id: string;
  night_id: string;
  display_name: string;
  joined_at: string;
  last_seen_at: string;
  removed_at: string | null;
  app_switch_total_seconds: number;
}

/** The signed-in player's safe identity, returned only to that player. */
export interface PlayerSelf {
  id: string;
  nightId: string;
  displayName: string;
  joinedAt: string;
  lastSeenAt: string;
  removedAt: string | null;
  appSwitchTotalSeconds: number;
}

/** A player's own answer. `scramble` is deliberately not part of this contract. */
export interface PlayerCanonicalAnswer {
  id: string;
  player_id: string;
  question_id: string;
  chosen_index: 0 | 1 | 2 | 3;
  ms_to_lock: number;
  is_correct: boolean | null;
  awarded_points: number | null;
  locked_at: string;
}

/** The subset of an answer the host needs for lock counts and reveals. */
export interface HostLiveAnswer {
  id: string;
  question_id: string;
  player_id: string;
  ms_to_lock: number;
  is_correct: boolean | null;
  chosen_index: 0 | 1 | 2 | 3;
}

/** A participation row contains no browser identity and is safe for its owner. */
export interface ParticipationDTO {
  id: string;
  player_id: string;
  game_id: string;
  joined_at: string;
}

/**
 * Question fields that can cross the room boundary. `correct_index` is only
 * present after resolution; the explicit construction makes future DB columns
 * fail closed instead of silently joining the wire contract.
 */
export interface RoomQuestion {
  id: string;
  category_id: string;
  difficulty: number;
  fact_blurb: string | null;
  image_attribution: string | null;
  image_source: string | null;
  image_url: string | null;
  is_picked: boolean;
  options: [string, string, string, string];
  played_at: string | null;
  finished_at: string | null;
  point_value: 100 | 200 | 300 | 400 | 500 | 600 | 700 | null;
  prompt: string;
  source: string;
  correct_index?: 0 | 1 | 2 | 3;
}

export function serializeRoomPlayer(player: PlayerRow): RoomPlayer {
  return {
    id: player.id,
    night_id: player.night_id,
    display_name: player.display_name,
    joined_at: player.joined_at,
    last_seen_at: player.last_seen_at,
    removed_at: player.removed_at,
    app_switch_total_seconds: player.app_switch_total_seconds,
  };
}

export function serializePlayerSelf(player: PlayerRow): PlayerSelf {
  return {
    id: player.id,
    nightId: player.night_id,
    displayName: player.display_name,
    joinedAt: player.joined_at,
    lastSeenAt: player.last_seen_at,
    removedAt: player.removed_at,
    appSwitchTotalSeconds: player.app_switch_total_seconds,
  };
}

export function serializePlayerCanonicalAnswer(answer: AnswerRow): PlayerCanonicalAnswer {
  return {
    id: answer.id,
    player_id: answer.player_id,
    question_id: answer.question_id,
    chosen_index: answer.chosen_index,
    ms_to_lock: answer.ms_to_lock,
    is_correct: answer.is_correct,
    awarded_points: answer.awarded_points,
    locked_at: answer.locked_at,
  };
}

export function serializeHostLiveAnswer(answer: AnswerRow): HostLiveAnswer {
  return {
    id: answer.id,
    question_id: answer.question_id,
    player_id: answer.player_id,
    ms_to_lock: answer.ms_to_lock,
    is_correct: answer.is_correct,
    chosen_index: answer.chosen_index,
  };
}

export function serializeParticipation(participation: ParticipationRow): ParticipationDTO {
  return {
    id: participation.id,
    player_id: participation.player_id,
    game_id: participation.game_id,
    joined_at: participation.joined_at,
  };
}

export function serializeRoomQuestion(question: QuestionRow): RoomQuestion {
  const serialized: RoomQuestion = {
    id: question.id,
    category_id: question.category_id,
    difficulty: question.difficulty,
    fact_blurb: question.fact_blurb,
    image_attribution: question.image_attribution,
    image_source: question.image_source,
    image_url: question.image_url,
    is_picked: question.is_picked,
    options: question.options,
    played_at: question.played_at,
    finished_at: question.finished_at,
    point_value: question.point_value,
    prompt: question.prompt,
    source: question.source,
  };

  if (question.finished_at !== null) {
    serialized.correct_index = question.correct_index;
  } else {
    // Keep the in-process helper compatible with legacy callers that read the
    // field, while keeping it absent from JSON and therefore off the wire.
    Object.defineProperty(serialized, "correct_index", {
      value: null,
      enumerable: false,
    });
  }

  return serialized;
}
