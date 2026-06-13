// recoveryBackoff — pure schedule for the "unreachable" self-healing retry.
//
// While a surface can't reach the server, it re-checks the connection on a
// backing-off, jittered cadence and STOPS the instant a read succeeds. Pure
// (no timers, no React) so the schedule is unit-testable in isolation; the
// hook that drives it lives in useUnreachableRetry.
//
// Why backoff + jitter (not a flat poll): on shared venue WiFi every device is
// unreachable at once. A flat interval would make a whole room retry in the
// same instant the network returns — a thundering herd against Supabase. The
// per-client ±jitter de-syncs them and the backoff caps the load (the
// reason-scale-free-not-observed-count lesson: the risky path must be safe at
// ANY room size, not just the one we observed).

/** Base delays per attempt index; the last value is the cap for all further
 *  attempts. ~2s → 4s → 8s. */
export const RECOVERY_BASE_DELAYS_MS = [2000, 4000, 8000] as const;

/** ±fraction of jitter applied to each base delay. */
export const RECOVERY_JITTER = 0.25;

/**
 * Generic jittered backoff: pick the base delay for `attempt` (clamped to the
 * last entry = the cap) and apply ±`jitter` based on `rand`.
 *
 * @param baseDelaysMs Ascending base delays; the last value caps further attempts.
 * @param attempt      0-based attempt index. Clamped into range.
 * @param rand         A value in [0, 1) (caller passes Math.random()). 0.5 = no
 *                     net jitter; 0 = floor (base·(1−J)); →1 = ceil (base·(1+J)).
 * @param jitter       ±fraction (default RECOVERY_JITTER).
 */
export function jitteredDelayMs(
  baseDelaysMs: readonly number[],
  attempt: number,
  rand: number,
  jitter: number = RECOVERY_JITTER,
): number {
  const idx = Math.min(Math.max(0, Math.floor(attempt)), baseDelaysMs.length - 1);
  const base = baseDelaysMs[idx];
  // Map rand [0,1) → factor [1−J, 1+J].
  const factor = 1 - jitter + rand * (2 * jitter);
  return base * factor;
}

/**
 * Delay (ms) before the next "unreachable" recovery re-check (2s → 4s → 8s cap).
 */
export function recoveryDelayMs(attempt: number, rand: number): number {
  return jitteredDelayMs(RECOVERY_BASE_DELAYS_MS, attempt, rand);
}
