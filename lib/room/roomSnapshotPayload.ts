// roomSnapshotPayload — explicit wire contract and legacy-client adapters for
// the resilient server-route fallback.

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
import {
  type HostLiveAnswer,
  type ParticipationDTO,
  type PlayerCanonicalAnswer,
  type RoomPlayer,
  type RoomQuestion,
} from "./roomAudience";
import { pickCurrentGame } from "./pickCurrentGame";

export { serializeRoomQuestion } from "./roomAudience";

interface RoomSnapshotBase {
  night: NightRow | null;
  hostDefaultThemeKey: string | null;
  games: GameRow[];
  categories: CategoryRow[];
  players: RoomPlayer[];
  currentQuestion: RoomQuestion | null;
  lastResolvedQuestion: RoomQuestion | null;
  currentReveal: RevealRow | null;
  allQuestions: RoomQuestion[];
  allScores: GameScoreRow[];
  scores: GameScoreRow[];
  roomMagicReactions?: RoomMagicReactionEvent[];
}

/** The response is intentionally audience-discriminated at the HTTP boundary. */
export type RoomSnapshotPayload = RoomSnapshotBase & (
  | {
      audience: "player";
      self: RoomPlayer;
      myAnswers: PlayerCanonicalAnswer[];
      myParticipations: ParticipationDTO[];
      liveAnswers?: never;
    }
  | {
      audience: "host";
      self: null;
      myAnswers?: never;
      myParticipations?: never;
      liveAnswers: HostLiveAnswer[];
    }
);

/**
 * Local-only shape consumed by legacy fallback users. It is constructed below
 * from every allowlisted DTO field; it is never used as the wire contract.
 */
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
}

/** Map the route payload into the RoomSnapshot shape useRoom already produces. */
export function payloadToRoomSnapshot(payload: RoomSnapshotPayload): RoomSnapshot {
  return {
    night: payload.night,
    hostDefaultThemeKey: payload.hostDefaultThemeKey,
    games: payload.games,
    categories: payload.categories,
    players: payload.players.map(roomPlayerToRow),
    currentGame: pickCurrentGame(payload.games),
    currentQuestion: payload.currentQuestion ? roomQuestionToRow(payload.currentQuestion) : null,
    lastResolvedQuestion: payload.lastResolvedQuestion
      ? roomQuestionToRow(payload.lastResolvedQuestion)
      : null,
    currentReveal: payload.currentReveal,
    lastBroadcast: null,
    lastFireworksBeat: null,
    lastRoomMagicReaction: null,
    roomMagicReactions: payload.roomMagicReactions ?? [],
    isLoading: false,
  };
}

/** Explicitly adapt the safe HTTP DTO for the existing fallback-only consumers. */
export function toRoomFallbackPayload(payload: RoomSnapshotPayload): RoomFallbackPayload {
  const common = {
    night: payload.night,
    hostDefaultThemeKey: payload.hostDefaultThemeKey,
    games: payload.games,
    categories: payload.categories,
    players: payload.players.map(roomPlayerToRow),
    currentQuestion: payload.currentQuestion ? roomQuestionToRow(payload.currentQuestion) : null,
    lastResolvedQuestion: payload.lastResolvedQuestion
      ? roomQuestionToRow(payload.lastResolvedQuestion)
      : null,
    currentReveal: payload.currentReveal,
    allQuestions: payload.allQuestions.map(roomQuestionToRow),
    allScores: payload.allScores,
    scores: payload.scores,
    roomMagicReactions: payload.roomMagicReactions ?? [],
  };

  if (payload.audience === "player") {
    return {
      ...common,
      myAnswers: payload.myAnswers.map(playerCanonicalAnswerToRow),
      myParticipations: payload.myParticipations.map(participationToRow),
      liveAnswers: [],
    };
  }

  return {
    ...common,
    myAnswers: [],
    myParticipations: [],
    liveAnswers: payload.liveAnswers.map(hostLiveAnswerToRow),
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
    // Room DTOs deliberately exclude bearer identity. Existing roster-only
    // consumers require the generated row type, so use an inert local value.
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
    // Consumers only inspect this after finish. A synthetic local value keeps
    // their legacy type intact without adding a live answer to the wire DTO.
    correct_index: question.correctIndex ?? 0,
  };
}

function playerCanonicalAnswerToRow(answer: PlayerCanonicalAnswer): AnswerRow {
  return {
    id: answer.id,
    question_id: answer.questionId,
    player_id: answer.playerId,
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
    // The host fallback never renders an answer's option order. This inert
    // local value only satisfies the legacy raw-row consumer type.
    scramble: [0, 1, 2, 3],
    locked_at: "",
    ms_to_lock: answer.msToLock,
    is_correct: answer.isCorrect,
    awarded_points: null,
  };
}

function participationToRow(participation: ParticipationDTO): ParticipationRow {
  return {
    id: participation.id,
    player_id: participation.playerId,
    game_id: participation.gameId,
    joined_at: participation.joinedAt,
  };
}
