export type HouseLightsIntensity = "idle" | "low" | "medium" | "high";

export interface HouseLightsPresenceInput {
  roomMagicEnabled: boolean;
  lockedCount: number | null | undefined;
  totalPlayers: number | null | undefined;
}

export interface HouseLightsPresence {
  lockedCount: number;
  totalPlayers: number;
  progressPct: number;
  intensity: HouseLightsIntensity;
  complete: boolean;
}

export interface HouseLightsAnswer {
  id?: string | null;
  player_id?: string | null;
  player_key?: string | null;
  question_id?: string | null;
}

export function countHouseLightsLocks(
  answers: HouseLightsAnswer[],
  activeQuestionId?: string | null,
): number {
  const seen = new Set<string>();

  for (const answer of answers) {
    const playerId = typeof answer.player_key === "string"
      ? answer.player_key
      : typeof answer.player_id === "string"
        ? answer.player_id
        : "";
    if (!playerId) continue;
    if (activeQuestionId && answer.question_id !== activeQuestionId) {
      continue;
    }
    seen.add(playerId);
  }

  return seen.size;
}

export function deriveHouseLightsPresence(
  input: HouseLightsPresenceInput,
): HouseLightsPresence | null {
  if (!input.roomMagicEnabled) return null;

  const lockedCount = finiteWholeNumber(input.lockedCount);
  const totalPlayers = finiteWholeNumber(input.totalPlayers);
  if (lockedCount === null || totalPlayers === null) return null;
  if (totalPlayers <= 0 || lockedCount < 0 || lockedCount > totalPlayers) {
    return null;
  }

  const progressPct = Math.min(
    100,
    Math.max(0, Math.round((lockedCount / totalPlayers) * 100)),
  );

  return {
    lockedCount,
    totalPlayers,
    progressPct,
    intensity: intensityFor(progressPct),
    complete: totalPlayers > 0 && lockedCount === totalPlayers,
  };
}

function finiteWholeNumber(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value)) return null;
  return value;
}

function intensityFor(progressPct: number): HouseLightsIntensity {
  if (progressPct <= 0) return "idle";
  if (progressPct < 34) return "low";
  if (progressPct <= 67) return "medium";
  return "high";
}
