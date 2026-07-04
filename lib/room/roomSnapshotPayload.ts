// roomSnapshotPayload — wire contract for the resilient server-route fallback
// (`GET /api/room/[code]/snapshot`).
//
// The route assembles this payload server-side via the admin client (the way
// the TV snapshot route does), and the client maps it into the exact
// `RoomSnapshot` shape `useRoom` already produces — so on a degraded network we
// swap the 7 direct browser→Supabase reads for ONE same-origin request without
// changing anything downstream.

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
import { pickCurrentGame } from "./pickCurrentGame";

export interface RoomSnapshotPayload {
  night: NightRow | null;
  hostDefaultThemeKey: string | null;
  games: GameRow[];
  categories: CategoryRow[];
  players: PlayerRow[];
  /** Live question (played, not finished). correct_index is withheld (null). */
  currentQuestion: QuestionRow | null;
  /** Most-recently-resolved question. correct_index present (it's the reveal). */
  lastResolvedQuestion: QuestionRow | null;
  currentReveal: RevealRow | null;
  /** All picked questions (host board). correct_index withheld for non-finished. */
  allQuestions: QuestionRow[];
  // ── player-mode only (null/empty in host mode) ──
  /** The authed player's own row (player mode). */
  me: PlayerRow | null;
  /** The authed player's answers across the night. */
  myAnswers: AnswerRow[];
  /** The authed player's per-game participation rows. */
  myParticipations: ParticipationRow[];
  /** game_scores for the current game (both modes). */
  scores: GameScoreRow[];
  /** Answers for the target question (live, else most-recently-resolved). Used
   *  by the HOST console for lock counts + the reveal "X of N got it". Same data
   *  the public TV feed already exposes; the player surface ignores it. */
  liveAnswers: AnswerRow[];
  /** Host-fallback-only display-safe Room Magic reactions. */
  roomMagicReactions?: RoomMagicReactionEvent[];
}

/**
 * SECURITY: withhold correct_index for any question that isn't RESOLVED. A live
 * or unplayed question must never ship its answer to a device — same rule as
 * the public TV feed (`serializeBoardQuestion`, 2026-06-06 pentest CRITICAL).
 * Resolved questions keep it so the reveal screen can highlight the answer.
 */
export function serializeRoomQuestion(q: QuestionRow): QuestionRow {
  return {
    ...q,
    // `as` keeps the QuestionRow shape; consumers only read correct_index when
    // finished_at is set, exactly as the direct-read path does.
    correct_index: (q.finished_at ? q.correct_index : null) as QuestionRow["correct_index"],
  };
}

/** Map the route payload into the RoomSnapshot shape useRoom returns. */
export function payloadToRoomSnapshot(payload: RoomSnapshotPayload): RoomSnapshot {
  return {
    night: payload.night,
    hostDefaultThemeKey: payload.hostDefaultThemeKey,
    games: payload.games,
    categories: payload.categories,
    players: payload.players,
    currentGame: pickCurrentGame(payload.games),
    currentQuestion: payload.currentQuestion,
    lastResolvedQuestion: payload.lastResolvedQuestion,
    currentReveal: payload.currentReveal,
    lastBroadcast: null,
    // The server-route fallback payload carries durable state only; the
    // firework beat is a transient broadcast, never reconstructed from a poll.
    lastFireworksBeat: null,
    lastRoomMagicReaction: null,
    roomMagicReactions: payload.roomMagicReactions ?? [],
    isLoading: false,
  };
}
