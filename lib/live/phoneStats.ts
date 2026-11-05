// A phone's own view of how the room's connection went, carried to the server
// on the heartbeat because the device can't be seen from anywhere else. Log
// lines only: no table, no effect on play.

export interface PhoneStats {
  resendCount: number;
  longestReplyWaitMs: number;
  secondsAtZero: number;
}

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
  stats.longestReplyWaitMs = Math.max(stats.longestReplyWaitMs, Math.round(ms));
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

/** A heartbeat that failed gives its stats back: a blip is when they matter. */
export function returnPhoneStats(taken: PhoneStats): void {
  stats.resendCount += taken.resendCount;
  stats.longestReplyWaitMs = Math.max(
    stats.longestReplyWaitMs,
    taken.longestReplyWaitMs,
  );
  stats.secondsAtZero += taken.secondsAtZero;
}
