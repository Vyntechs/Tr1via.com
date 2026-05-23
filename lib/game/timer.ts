/**
 * Server-timestamp-driven countdown timer.
 *
 * The host presses Reveal → the DB writes `revealed_at: T` (server clock)
 * and broadcasts the event. Every device — TV, host laptop, host phone,
 * each player phone — computes the seconds-remaining locally as
 * `max(0, durationS - (now - T) / 1000)`. This means there is exactly one
 * source of truth (the server's T) and zero clock-sync between devices.
 *
 * Devices may pass `nowMs` explicitly (e.g. when the realtime payload
 * includes the server's `now`, the client can subtract local clock skew),
 * but the default `Date.now()` is correct within ~tens of ms for any
 * modern device.
 */
export function secondsRemaining(opts: {
  revealedAtMs: number;
  durationS: number;
  nowMs?: number;
}): number {
  const now = opts.nowMs ?? Date.now();
  const elapsedS = (now - opts.revealedAtMs) / 1000;
  const remaining = opts.durationS - elapsedS;
  // Clamp to [0, durationS]: cannot go below zero (timer ended) and cannot
  // exceed the duration (negative elapsed = reveal-event arrived early via
  // clock skew; fall back to "full timer" rather than going past 100%).
  if (remaining < 0) return 0;
  if (remaining > opts.durationS) return opts.durationS;
  return remaining;
}

/**
 * Fractional progress 0..1 for arc/ring rendering.
 *
 * Always equals `secondsRemaining / durationS` so the visual sweep matches
 * the numeric countdown exactly.
 */
export function timerFraction(opts: {
  revealedAtMs: number;
  durationS: number;
  nowMs?: number;
}): number {
  return secondsRemaining(opts) / opts.durationS;
}
