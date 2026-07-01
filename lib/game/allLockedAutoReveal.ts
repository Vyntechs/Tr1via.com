export const ALL_LOCKED_AUTO_REVEAL_GRACE_MS = 1200;

export type AllLockedAutoRevealReason =
  | "no_current_game"
  | "no_live_question"
  | "no_eligible_players"
  | "unknown_eligibility"
  | "not_everyone_locked";

export interface AllLockedAutoRevealDecision {
  eligibleCount: number;
  lockedCount: number;
  complete: boolean;
  reason?: AllLockedAutoRevealReason;
}

export interface AllLockedAutoRevealScoreRow {
  player_id: string | null;
}

export interface AllLockedAutoRevealAnswerRow {
  question_id: string | null;
  player_id: string | null;
}

export interface AllLockedAutoRevealInput {
  currentGameId: string | null | undefined;
  liveQuestionId: string | null | undefined;
  activePlayerIds: readonly string[];
  /**
   * Current-game `game_scores` rows. Pass null until the rows are known to be
   * loaded for the current game; an empty array means "loaded, no participants."
   */
  scoreRows: readonly AllLockedAutoRevealScoreRow[] | null;
  answers: readonly AllLockedAutoRevealAnswerRow[];
}

export function deriveAllLockedAutoRevealDecision(
  input: AllLockedAutoRevealInput,
): AllLockedAutoRevealDecision {
  if (!input.currentGameId) {
    return incomplete("no_current_game");
  }
  if (!input.liveQuestionId) {
    return incomplete("no_live_question");
  }
  if (input.scoreRows === null) {
    return incomplete("unknown_eligibility");
  }

  const activePlayers = new Set(input.activePlayerIds.filter(Boolean));
  const eligiblePlayers = new Set<string>();
  for (const row of input.scoreRows) {
    if (row.player_id && activePlayers.has(row.player_id)) {
      eligiblePlayers.add(row.player_id);
    }
  }

  if (eligiblePlayers.size === 0) {
    return incomplete("no_eligible_players");
  }

  const lockedPlayers = new Set<string>();
  for (const answer of input.answers) {
    if (
      answer.question_id === input.liveQuestionId &&
      answer.player_id &&
      eligiblePlayers.has(answer.player_id)
    ) {
      lockedPlayers.add(answer.player_id);
    }
  }

  const complete = lockedPlayers.size === eligiblePlayers.size;
  return {
    eligibleCount: eligiblePlayers.size,
    lockedCount: lockedPlayers.size,
    complete,
    ...(complete ? {} : { reason: "not_everyone_locked" as const }),
  };
}

function incomplete(reason: AllLockedAutoRevealReason): AllLockedAutoRevealDecision {
  return {
    eligibleCount: 0,
    lockedCount: 0,
    complete: false,
    reason,
  };
}
