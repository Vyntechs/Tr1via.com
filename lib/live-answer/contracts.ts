export type LivePlayState =
  | "accepting"
  | "all_in_hold"
  | "final_window"
  | "resolved"
  | "undone";

export interface LiveRevision {
  runId: string;
  roomRevision: number;
  controlRevision: number;
  playId: string | null;
}

export interface LivePlayProjection {
  playId: string;
  gameId: string;
  questionId: string;
  state: LivePlayState;
  openedAt: string;
  mainZeroAt: string;
  finalWindowStartsAt: string | null;
  finalWindowEndsAt: string;
  finalizeAt: string | null;
  eligibleCount: number;
  confirmedCount: number;
}

export interface LiveRoomProjection extends LiveRevision {
  play: LivePlayProjection | null;
}

export interface PlayerCanonicalPlayAnswer {
  confirmedSlot: 1 | 2 | 3 | 4;
  canonicalIndex: 0 | 1 | 2 | 3;
  receivedAt: string;
  lockedAt: string;
  msToLock: number;
  isCorrect: boolean | null;
  awardedPoints: number | null;
}

export interface PlayerLiveProjection extends LiveRoomProjection {
  canAnswerThisPlay: boolean;
  canonicalAnswer: PlayerCanonicalPlayAnswer | null;
}

export interface HostLiveProjection extends LiveRoomProjection {
  operations: {
    eligibleCount: number;
    confirmedCount: number;
    awaitingCount: number;
  };
}

export type SubmitAnswerResult =
  | {
      code: "confirmed";
      confirmedSlot: 1 | 2 | 3 | 4;
      duplicate: boolean;
      live: LiveRoomProjection;
    }
  | { code: "deadline_passed" | "identity_invalid" | "not_eligible" }
  | { code: "retry_later"; retryAfterMs: number };

export type LiveRoomEventKind =
  | "night_opened"
  | "game_started"
  | "play_opened"
  | "answer_progress"
  | "final_window_started"
  | "play_resolved"
  | "play_undone"
  | "game_ended"
  | "night_reset";

/**
 * Freshness is deliberately explicit. `applied=true` alone is insufficient:
 * an exact RPC retry returns the original applied result.
 */
export interface LiveRoomBroadcastAttempt {
  applied: boolean;
  freshness: "transaction_winner" | "replay";
  kind: LiveRoomEventKind;
  serverNow: string;
  live: LiveRoomProjection;
}
