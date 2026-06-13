// readTimeout — bound a promise so a hung browser→Supabase read can't spin the
// UI forever.
//
// Why this exists: on restrictive venue WiFi the direct `supa.from(...)` reads
// in useRoom can hang indefinitely (packets dropped, not refused), so the host
// console sits on the black DevPlaceholder and the player phone spins on the
// LoadingScreen with no timeout. Wrapping the bootstrap reads in `withTimeout`
// converts that silent hang into a surfaced "unreachable" signal within ~5s.

/** A read (or the whole bootstrap) didn't settle inside its budget. */
export class TimeoutError extends Error {
  constructor(message = "timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

/** Default budget for the bootstrap reads. ~5s: long enough to ride out a slow
 *  but working round-trip, short enough that a real block surfaces fast. */
export const BOOTSTRAP_TIMEOUT_MS = 5000;

/**
 * Resolve/reject with `promise` if it settles within `ms`; otherwise reject
 * with a `TimeoutError`. The underlying promise is NOT cancelled (callers
 * guard stale results with their own `cancelled` flag) — this only bounds how
 * long the caller waits.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label?: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(label ?? `timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
