// Explicit audience wire contracts plus local adapters for existing room UI.

import type {
  AnswerRow,
  CategoryRow,
  GameRow,
  GameScoreRow,
  NightRow,
  ParticipationRow,
  PlayerRow,
  QuestionRow,
  RevealRow,
} from "@/lib/supabase/types";
import type { RoomSnapshot } from "@/lib/hooks/useRoom";
import type { RoomMagicReactionEvent } from "@/lib/room-magic/reactions";
import type {
  HostLiveProjection,
  PlayerLiveProjection,
} from "@/lib/live-answer/contracts";
import type {
  HostLiveAnswer,
  ParticipationDTO,
  PlayerCanonicalAnswer,
  PlayerRoomPlayer,
  PlayerScoreDTO,
  RoomPlayer,
  RoomQuestion,
} from "./roomAudience";
import { pickCurrentGame } from "./pickCurrentGame";

export { serializeRoomQuestion } from "./roomAudience";

/** Player-safe night state: tenancy identifiers never cross the wire. */
export interface PlayerNightDTO {
  nightKey: string;
  answer_engine?: string;
  answer_engine_latched_at?: string | null;
  closed_at: string | null;
  control_revision?: number;
  created_at: string;
  is_locked: boolean;
  opened_at: string | null;
  room_code: string;
  room_magic_enabled: boolean;
  room_revision?: number;
  scheduled_at: string | null;
  theme_key: string | null;
  venue_name: string;
}

export type PlayerGameDTO = Omit<GameRow, "night_id">;
export type PlayerQuestionScrambles = Record<
  string,
  [number, number, number, number]
>;

interface SharedRoomSnapshotBase {
  hostDefaultThemeKey: string | null;
  categories: CategoryRow[];
  currentQuestion: RoomQuestion | null;
  lastResolvedQuestion: RoomQuestion | null;
  currentReveal: RevealRow | null;
  allQuestions: RoomQuestion[];
  roomMagicReactions?: RoomMagicReactionEvent[];
}

/** The response is audience-discriminated at the complete HTTP boundary. */
export type RoomSnapshotPayload = SharedRoomSnapshotBase & (
  | {
      audience: "player";
      night: PlayerNightDTO | null;
      games: PlayerGameDTO[];
      players: PlayerRoomPlayer[];
      allScores: PlayerScoreDTO[];
      scores: PlayerScoreDTO[];
      live?: PlayerLiveProjection | null;
      self: PlayerRoomPlayer;
      myAnswers: PlayerCanonicalAnswer[];
      myParticipations: ParticipationDTO[];
      questionScrambles: PlayerQuestionScrambles;
      liveAnswers?: never;
    }
  | {
      audience: "host";
      night: NightRow | null;
      games: GameRow[];
      players: RoomPlayer[];
      allScores: GameScoreRow[];
      scores: GameScoreRow[];
      live?: HostLiveProjection | null;
      self: null;
      myAnswers?: never;
      myParticipations?: never;
      questionScrambles?: never;
      liveAnswers: HostLiveAnswer[];
    }
);

/** Local-only legacy shape. Synthetic ids here never cross an HTTP boundary. */
export interface RoomFallbackPayload {
  night: NightRow | null;
  hostDefaultThemeKey: string | null;
  games: GameRow[];
  categories: CategoryRow[];
  players: PlayerRow[];
  currentQuestion: QuestionRow | null;
  lastResolvedQuestion: QuestionRow | null;
  currentReveal: RevealRow | null;
  allQuestions: QuestionRow[];
  myAnswers: AnswerRow[];
  myParticipations: ParticipationRow[];
  allScores: GameScoreRow[];
  scores: GameScoreRow[];
  liveAnswers: AnswerRow[];
  roomMagicReactions: RoomMagicReactionEvent[];
  questionScrambles?: PlayerQuestionScrambles;
}

export function payloadToRoomSnapshot(payload: RoomSnapshotPayload): RoomSnapshot {
  const playerAudience = payload.audience === "player";
  const night = playerAudience
    ? payload.night
      ? playerNightToRow(payload.night)
      : null
    : payload.night;
  const games: GameRow[] = playerAudience
    ? payload.games.map((game) => playerGameToRow(game, payload.night?.nightKey ?? ""))
    : payload.games;
  const players: PlayerRow[] = playerAudience
    ? payload.players.map((player) =>
        playerRoomPlayerToRow(player, payload.night?.nightKey ?? ""))
    : payload.players.map(roomPlayerToRow);

  return {
    night,
    hostDefaultThemeKey: payload.hostDefaultThemeKey,
    games,
    categories: payload.categories,
    players,
    currentGame: pickCurrentGame(games),
    currentQuestion: payload.currentQuestion ? roomQuestionToRow(payload.currentQuestion) : null,
    lastResolvedQuestion: payload.lastResolvedQuestion
      ? roomQuestionToRow(payload.lastResolvedQuestion)
      : null,
    currentReveal: payload.currentReveal,
    lastBroadcast: null,
    lastFireworksBeat: null,
    lastRoomMagicReaction: null,
    roomMagicReactions: payload.roomMagicReactions ?? [],
    ...(playerAudience
      ? { self: playerRoomPlayerToRow(payload.self, payload.night?.nightKey ?? "") }
      : {}),
    isLoading: false,
  };
}

export function toRoomFallbackPayload(payload: RoomSnapshotPayload): RoomFallbackPayload {
  const room = payloadToRoomSnapshot(payload);
  const common = {
    night: room.night,
    hostDefaultThemeKey: payload.hostDefaultThemeKey,
    games: room.games,
    categories: payload.categories,
    players: room.players,
    currentQuestion: payload.currentQuestion ? roomQuestionToRow(payload.currentQuestion) : null,
    lastResolvedQuestion: payload.lastResolvedQuestion
      ? roomQuestionToRow(payload.lastResolvedQuestion)
      : null,
    currentReveal: payload.currentReveal,
    allQuestions: payload.allQuestions.map(roomQuestionToRow),
    roomMagicReactions: payload.roomMagicReactions ?? [],
  };

  if (payload.audience === "player") {
    return {
      ...common,
      allScores: payload.allScores.map(playerScoreToRow),
      scores: payload.scores.map(playerScoreToRow),
      myAnswers: payload.myAnswers.map((answer) =>
        playerCanonicalAnswerToRow(answer, payload.self.playerKey)),
      myParticipations: payload.myParticipations.map((participation) =>
        participationToRow(participation, payload.self.playerKey)),
      liveAnswers: [],
      questionScrambles: payload.questionScrambles,
    };
  }

  return {
    ...common,
    allScores: payload.allScores,
    scores: payload.scores,
    myAnswers: [],
    myParticipations: [],
    liveAnswers: payload.liveAnswers.map(hostLiveAnswerToRow),
    questionScrambles: {},
  };
}

function playerNightToRow(night: PlayerNightDTO): NightRow {
  const { nightKey, ...safe } = night;
  return { ...safe, id: nightKey, host_id: "", current_run_id: null };
}

function playerGameToRow(game: PlayerGameDTO, nightKey: string): GameRow {
  return { ...game, night_id: nightKey };
}

function playerRoomPlayerToRow(player: PlayerRoomPlayer, nightKey: string): PlayerRow {
  return {
    id: player.playerKey,
    night_id: nightKey,
    display_name: player.displayName,
    joined_at: player.joinedAt,
    last_seen_at: player.lastSeenAt,
    removed_at: player.removedAt,
    app_switch_total_seconds: player.appSwitchTotalSeconds,
    device_id: "",
  };
}

function roomPlayerToRow(player: RoomPlayer): PlayerRow {
  return {
    id: player.id,
    night_id: player.nightId,
    display_name: player.displayName,
    joined_at: player.joinedAt,
    last_seen_at: player.lastSeenAt,
    removed_at: player.removedAt,
    app_switch_total_seconds: player.appSwitchTotalSeconds,
    device_id: "",
  };
}

function roomQuestionToRow(question: RoomQuestion): QuestionRow {
  return {
    id: question.id,
    category_id: question.categoryId,
    difficulty: question.difficulty,
    fact_blurb: question.factBlurb,
    image_attribution: question.imageAttribution,
    image_source: question.imageSource,
    image_url: question.imageUrl,
    is_picked: question.isPicked,
    options: question.options,
    played_at: question.playedAt,
    finished_at: question.finishedAt,
    point_value: question.pointValue,
    prompt: question.prompt,
    source: question.source,
    correct_index: question.correctIndex ?? 0,
  };
}

function playerCanonicalAnswerToRow(
  answer: PlayerCanonicalAnswer,
  playerKey: string,
): AnswerRow {
  return {
    id: `answer:${answer.questionId}`,
    question_id: answer.questionId,
    player_id: playerKey,
    chosen_index: answer.chosenIndex,
    scramble: answer.scramble,
    locked_at: answer.lockedAt,
    ms_to_lock: answer.msToLock,
    is_correct: answer.isCorrect,
    awarded_points: answer.awardedPoints,
  };
}

function hostLiveAnswerToRow(answer: HostLiveAnswer): AnswerRow {
  return {
    id: answer.id,
    question_id: answer.questionId,
    player_id: answer.playerId,
    chosen_index: answer.chosenIndex ?? 0,
    scramble: [0, 1, 2, 3],
    locked_at: "",
    ms_to_lock: answer.msToLock,
    is_correct: answer.isCorrect,
    awarded_points: null,
  };
}

function participationToRow(
  participation: ParticipationDTO,
  playerKey: string,
): ParticipationRow {
  return {
    id: `participation:${participation.gameId}`,
    player_id: playerKey,
    game_id: participation.gameId,
    joined_at: participation.joinedAt,
  };
}

function playerScoreToRow(score: PlayerScoreDTO): GameScoreRow {
  return {
    game_id: score.gameId,
    player_id: score.playerKey,
    display_name: score.displayName,
    score: score.score,
    correct_count: score.correctCount,
    answered_count: score.answeredCount,
    fastest_correct_ms: score.fastestCorrectMs,
  };
}
