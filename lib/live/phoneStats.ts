// A phone's own view of how the room's connection went, carried to the server
// on the heartbeat because the device can't be seen from anywhere else. Log
// lines only: no table, no effect on play.

export interface PhoneStats {
  resendCount: number;
  longestReplyWaitMs: number;
  secondsAtZero: number;
}

/** The most the heartbeat takes. The wait is wall-clock, so it counts a locked phone. */
export const MAX_REPLY_WAIT_MS = 3_600_000;

const empty = (): PhoneStats => ({
  resendCount: 0,
  longestReplyWaitMs: 0,
  secondsAtZero: 0,
});

let stats = empty();

export function notePhoneResend(): void {
  stats.resendCount += 1;
}

export function notePhoneReplyWait(ms: number): void {
  if (!Number.isFinite(ms)) return;
  stats.longestReplyWaitMs = Math.max(
    stats.longestReplyWaitMs,
    Math.min(Math.round(ms), MAX_REPLY_WAIT_MS),
  );
}

export function notePhoneAtZero(ms: number): void {
  stats.secondsAtZero += Math.round(ms / 1_000);
}

/** Hands over what has built up, or null if nothing has. */
export function takePhoneStats(): PhoneStats | null {
  const taken = stats;
  stats = empty();
  const hasAny =
    taken.resendCount > 0 ||
    taken.longestReplyWaitMs > 0 ||
    taken.secondsAtZero > 0;
  return hasAny ? taken : null;
}

/**
 * A heartbeat lost to the network or a 5xx gives its stats back: a blip is when
 * they matter. Any other refusal drops them, since resending the same numbers
 * would only be refused again.
 */
export function returnPhoneStats(taken: PhoneStats): void {
  stats.resendCount += taken.resendCount;
  stats.longestReplyWaitMs = Math.max(
    stats.longestReplyWaitMs,
    taken.longestReplyWaitMs,
  );
  stats.secondsAtZero += taken.secondsAtZero;
}
