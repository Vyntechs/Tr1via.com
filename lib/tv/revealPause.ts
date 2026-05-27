// lib/tv/revealPause.ts
//
// Decides whether reveal should still be held back because ceremony events
// are pending. Pure function — testable without React.

export interface RevealPauseInput {
  /** Has the question timer expired? */
  timerExpired: boolean;
  /** Number of unprocessed ceremony events. */
  pendingCount: number;
  /** Date.now() when the timer first expired. null if not yet expired. */
  expiredAtMs: number | null;
  /** Date.now() at the moment of the call. */
  nowMs: number;
  /** Theme supports a ceremony (i.e., May/Storm). */
  ceremonyEnabled: boolean;
}

export const REVEAL_HOLD_MAX_MS = 3000;

export function shouldHoldReveal(input: RevealPauseInput): boolean {
  if (!input.timerExpired || !input.ceremonyEnabled) return false;
  if (input.pendingCount === 0) return false;
  if (input.expiredAtMs === null) return true;
  return input.nowMs - input.expiredAtMs < REVEAL_HOLD_MAX_MS;
}
