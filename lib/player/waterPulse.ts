// Pure de-dup helpers for the phone's reactive water. The phone fires the June
// beat from its own shared feed; these keep each moment firing exactly once.

/** True when a newly-resolved question should fire a reveal pulse — i.e. it's
 *  resolved and differs from the last question we already pulsed for. */
export function shouldFireReveal(
  resolvedQuestionId: string | null,
  lastFiredQuestionId: string | null,
): boolean {
  if (!resolvedQuestionId) return false;
  return resolvedQuestionId !== lastFiredQuestionId;
}

/** The lock playerIds we haven't rippled yet (preserves input order). */
export function newLockIds(playerIds: string[], rippled: Set<string>): string[] {
  return playerIds.filter((id) => !rippled.has(id));
}
