// roomSnapshotPayload — wire contract for the resilient server-route fallback.

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
  serializeRoomQuestion,
  type HostLiveAnswer,
  type ParticipationDTO,
  type PlayerCanonicalAnswer,
  type PlayerSelf,
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
  scores: GameScoreRow[];
  roomMagicReactions?: RoomMagicReactionEvent[];
}

/** The response is intentionally audience-discriminated at the HTTP boundary. */
export type RoomSnapshotPayload = RoomSnapshotBase & (
  | {
      audience: "player";
      self: PlayerSelf;
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
 * The fallback store is surface-local: a player route can only receive a
 * player payload and a host route can only receive a host payload. This bridge
 * preserves the existing client consumers while the wire payload stays strict.
 */
export interface RoomFallbackPayload {
  audience: "player" | "host";
  self: PlayerSelf | null;
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
  scores: GameScoreRow[];
  liveAnswers: AnswerRow[];
  roomMagicReactions?: RoomMagicReactionEvent[];
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
    currentQuestion: payload.currentQuestion
      ? roomQuestionToRow(payload.currentQuestion)
      : null,
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

function roomPlayerToRow(player: RoomPlayer): PlayerRow {
  return {
    id: player.id,
    night_id: player.night_id,
    display_name: player.display_name,
    joined_at: player.joined_at,
    last_seen_at: player.last_seen_at,
    removed_at: player.removed_at,
    app_switch_total_seconds: player.app_switch_total_seconds,
  } as PlayerRow;
}

function roomQuestionToRow(question: RoomQuestion): QuestionRow {
  const row: Omit<QuestionRow, "correct_index"> & { correct_index?: QuestionRow["correct_index"] } = {
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
  if (question.correct_index !== undefined) row.correct_index = question.correct_index;
  return row as QuestionRow;
}
