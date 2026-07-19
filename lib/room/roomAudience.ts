import type {
  ParticipationRow,
  PlayerRow,
  QuestionRow,
} from "@/lib/supabase/types";

type SafePlayerRow = Pick<
  PlayerRow,
  | "id"
  | "night_id"
  | "display_name"
  | "joined_at"
  | "last_seen_at"
  | "removed_at"
  | "app_switch_total_seconds"
>;

/** Authenticated-host roster row. Player audiences use PlayerRoomPlayer. */
export interface RoomPlayer {
  id: string;
  nightId: string;
  displayName: string;
  joinedAt: string;
  lastSeenAt: string;
  removedAt: string | null;
  appSwitchTotalSeconds: number;
}

/** Signed-player roster row. Correlates presentation state without DB ids. */
export interface PlayerRoomPlayer {
  playerKey: string;
  displayName: string;
  joinedAt: string;
  lastSeenAt: string;
  removedAt: string | null;
  appSwitchTotalSeconds: number;
}

export interface PlayerCanonicalAnswer {
  questionId: string;
  chosenIndex: 0 | 1 | 2 | 3;
  scramble: [number, number, number, number];
  lockedAt: string;
  msToLock: number;
  isCorrect: boolean | null;
  awardedPoints: number | null;
}

export interface HostLiveAnswer {
  id: string;
  questionId: string;
  playerId: string;
  msToLock: number;
  chosenIndex: 0 | 1 | 2 | 3 | null;
  isCorrect: boolean | null;
}

export interface ParticipationDTO {
  gameId: string;
  joinedAt: string;
}

export interface PlayerScoreDTO {
  gameId: string | null;
  playerKey: string;
  displayName: string;
  score: number;
  correctCount: number;
  answeredCount: number;
  fastestCorrectMs: number | null;
}

export interface RoomQuestion {
  id: string;
  categoryId: string;
  difficulty: number;
  factBlurb: string | null;
  imageAttribution: string | null;
  imageSource: string | null;
  imageUrl: string | null;
  isPicked: boolean;
  options: [string, string, string, string];
  playedAt: string | null;
  finishedAt: string | null;
  pointValue: 100 | 200 | 300 | 400 | 500 | 600 | 700 | null;
  prompt: string;
  source: string;
  correctIndex?: 0 | 1 | 2 | 3;
}

interface PlayerCanonicalAnswerSource {
  question_id: string;
  chosen_index: number;
  scramble: unknown;
  locked_at: string;
  ms_to_lock: number;
  is_correct: boolean | null;
  awarded_points: number | null;
}

interface HostLiveAnswerSource {
  id: string;
  question_id: string;
  player_id: string;
  ms_to_lock: number;
  chosen_index: number | null;
  is_correct: boolean | null;
}

export function serializeRoomPlayer(player: SafePlayerRow): RoomPlayer {
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

export function serializePlayerRoomPlayer(
  player: SafePlayerRow,
  playerKey: string,
): PlayerRoomPlayer {
  return {
    playerKey,
    displayName: player.display_name,
    joinedAt: player.joined_at,
    lastSeenAt: player.last_seen_at,
    removedAt: player.removed_at,
    appSwitchTotalSeconds: player.app_switch_total_seconds,
  };
}

export function serializePlayerSelf(
  player: SafePlayerRow,
  playerKey: string,
): PlayerRoomPlayer {
  return serializePlayerRoomPlayer(player, playerKey);
}

export function serializePlayerCanonicalAnswer(
  answer: PlayerCanonicalAnswerSource,
): PlayerCanonicalAnswer {
  return {
    questionId: answer.question_id,
    chosenIndex: optionIndex(answer.chosen_index),
    scramble: answerScramble(answer.scramble),
    lockedAt: answer.locked_at,
    msToLock: answer.ms_to_lock,
    isCorrect: answer.is_correct,
    awardedPoints: answer.awarded_points,
  };
}

export function serializeHostLiveAnswer(
  answer: HostLiveAnswerSource,
): HostLiveAnswer {
  return {
    id: answer.id,
    questionId: answer.question_id,
    playerId: answer.player_id,
    msToLock: answer.ms_to_lock,
    chosenIndex: answer.chosen_index === null ? null : optionIndex(answer.chosen_index),
    isCorrect: answer.is_correct,
  };
}

export function serializeParticipation(
  participation: Pick<ParticipationRow, "game_id" | "joined_at">,
): ParticipationDTO {
  return {
    gameId: participation.game_id,
    joinedAt: participation.joined_at,
  };
}

export function serializePlayerScore(
  score: {
    game_id: string | null;
    player_id: string | null;
    display_name: string | null;
    score: number | null;
    correct_count: number | null;
    answered_count: number | null;
    fastest_correct_ms: number | null;
  },
  playerKey: string,
): PlayerScoreDTO | null {
  if (score.player_id === null || score.display_name === null) return null;
  return {
    gameId: score.game_id,
    playerKey,
    displayName: score.display_name,
    score: Number(score.score ?? 0),
    correctCount: Number(score.correct_count ?? 0),
    answeredCount: Number(score.answered_count ?? 0),
    fastestCorrectMs: score.fastest_correct_ms,
  };
}

export function serializeRoomQuestion(question: QuestionRow): RoomQuestion {
  const serialized: RoomQuestion = {
    id: question.id,
    categoryId: question.category_id,
    difficulty: question.difficulty,
    factBlurb: question.fact_blurb,
    imageAttribution: question.image_attribution,
    imageSource: question.image_source,
    imageUrl: question.image_url,
    isPicked: question.is_picked,
    options: question.options,
    playedAt: question.played_at,
    finishedAt: question.finished_at,
    pointValue: question.point_value,
    prompt: question.prompt,
    source: question.source,
  };
  if (question.finished_at !== null) serialized.correctIndex = question.correct_index;
  return serialized;
}

function optionIndex(value: number): 0 | 1 | 2 | 3 {
  if (value === 0 || value === 1 || value === 2 || value === 3) return value;
  throw new Error("invalid answer index");
}

function answerScramble(value: unknown): [number, number, number, number] {
  if (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((entry) => typeof entry === "number")
  ) {
    return [value[0], value[1], value[2], value[3]];
  }
  throw new Error("invalid answer scramble");
}
