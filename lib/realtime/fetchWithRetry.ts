// fetchJsonWithRetry — resilient GET for the server-route fallback.
//
// On a degraded (slow/lossy) network a single fetch may stall or drop. This
// retries a bounded number of times with JITTERED backoff (so a whole room's
// retries never align into a stampede — reason-scale-free-not-observed-count),
// bounds each attempt with its own timeout, and aborts cleanly on an external
// signal. Pure-ish: the fetch impl + RNG are injectable for deterministic tests.

import { jitteredDelayMs } from "./recoveryBackoff";

/** Per-attempt retry backoff: quick first re-tries (not the slow 2→8s recovery
 *  curve). 300ms → 800ms → 2s, jittered. */
export const FETCH_RETRY_BASE_DELAYS_MS = [300, 800, 2000] as const;

export interface FetchJsonRetryOptions {
  /** Max attempts (including the first). Default 3. */
  attempts?: number;
  /** Per-attempt timeout in ms. Default 5000. */
  perAttemptTimeoutMs?: number;
  /** External abort — rejects the whole call when fired. */
  signal?: AbortSignal;
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable RNG for deterministic jitter (tests). Defaults to Math.random. */
  rand?: () => number;
}

class AbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortedError";
  }
}

/**
 * GET `url` and parse JSON, retrying transient failures (network error, non-OK
 * status, or per-attempt timeout) with jittered backoff. Resolves with the
 * parsed body, or rejects after the final attempt fails.
 */
export async function fetchJsonWithRetry<T>(
  url: string,
  options: FetchJsonRetryOptions = {},
): Promise<T> {
  const {
    attempts = 3,
    perAttemptTimeoutMs = 5000,
    signal,
    fetchImpl = fetch,
    rand = Math.random,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal?.aborted) throw new AbortedError();
    try {
      const body = await attemptOnce<T>(url, perAttemptTimeoutMs, signal, fetchImpl);
      return body;
    } catch (err) {
      lastError = err;
      // Don't sleep after the final attempt or once externally aborted.
      if (attempt === attempts - 1 || signal?.aborted) break;
      const delay = jitteredDelayMs(FETCH_RETRY_BASE_DELAYS_MS, attempt, rand());
      await sleep(delay, signal);
    }
  }
  throw lastError ?? new Error("fetchJsonWithRetry: exhausted with no error");
}

async function attemptOnce<T>(
  url: string,
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Race the fetch against the abort so the timeout is authoritative even if
    // the fetch impl ignores the signal (real fetch rejects on abort; a stub
    // might not). Whichever settles first wins.
    const res = await Promise.race([
      fetchImpl(url, { signal: controller.signal, cache: "no-store" }),
      rejectOnAbort(controller.signal),
    ]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

/** A promise that never resolves and rejects the moment `signal` aborts. */
function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new AbortedError());
      return;
    }
    signal.addEventListener("abort", () => reject(new AbortedError()), { once: true });
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new AbortedError());
    };
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new AbortedError());
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
