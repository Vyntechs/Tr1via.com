// The timer-zero ladder: how a phone or TV asks the server to close a question
// when its own countdown ends, without giving up on the first bad reply.
//
//   window still open (409 + retryInMs) → wait retryInMs + 100-300ms, ask again.
//                                         These waits don't use up a send.
//   network failure, 5xx, 408/425/429,
//   or no reply in 3s                   → wait 1-2s, then 2.5-4s, ask again.
//   anything else (closed, already
//   closed, not live, other refusals)   → stop.
//
// A phone sends at most 3 times and the TV 4. `onSettled` runs once when the
// ladder ends for any reason except cancel(). That last refresh is also the
// recovery if the close happened but its broadcast never arrived.
//
// /resolve is idempotent, so a request that timed out here but landed anyway
// costs nothing.

import { CLOSE_CALLER_HEADER } from "@/lib/live/logClose";

export type ResolveCaller = "phone" | "tv";

export const RESOLVE_ATTEMPT_TIMEOUT_MS = 3000;
export const RESOLVE_MAX_SENDS: Record<ResolveCaller, number> = { phone: 3, tv: 4 };
/** Waiting out the open window is free, but it must still end: one wait is
 *  normal, and a server that keeps saying "not yet" is not worth chasing. */
export const RESOLVE_MAX_WINDOW_WAITS = 5;
/** The longest "not yet" believed. A question runs 25s, so more is a bad value. */
const MAX_WINDOW_WAIT_MS = 30_000;

export interface ResolveAtZeroOptions {
  questionId: string;
  caller: ResolveCaller;
  /** Runs once at the end of the ladder. Not called after cancel(). */
  onSettled?: () => void;
  /** Tests inject these. */
  fetchImpl?: typeof fetch;
  random?: () => number;
}

type Outcome = { kind: "done" } | { kind: "retry" } | { kind: "wait"; retryInMs: number };

async function judge(res: Response): Promise<Outcome> {
  if (res.ok) return { kind: "done" };
  if (res.status === 409) {
    let retryInMs: unknown;
    try {
      retryInMs = ((await res.json()) as { retryInMs?: unknown } | null)?.retryInMs;
    } catch {
      return { kind: "done" };
    }
    const usable =
      typeof retryInMs === "number" &&
      Number.isFinite(retryInMs) &&
      retryInMs > 0 &&
      retryInMs <= MAX_WINDOW_WAIT_MS;
    return usable ? { kind: "wait", retryInMs: retryInMs as number } : { kind: "done" };
  }
  if (res.status >= 500 || res.status === 408 || res.status === 425 || res.status === 429) {
    return { kind: "retry" };
  }
  return { kind: "done" };
}

/** Starts the ladder and returns cancel(), which stops it without settling. */
export function resolveAtZero({
  questionId,
  caller,
  onSettled,
  fetchImpl,
  random = Math.random,
}: ResolveAtZeroOptions): () => void {
  const send = fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const stop = new AbortController();
  let wake: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, ms);
    });

  async function ask(): Promise<Outcome> {
    const attempt = new AbortController();
    const onStop = () => attempt.abort();
    stop.signal.addEventListener("abort", onStop);
    const timeout = setTimeout(() => attempt.abort(), RESOLVE_ATTEMPT_TIMEOUT_MS);
    try {
      const res = await send(`/api/questions/${questionId}/resolve`, {
        method: "POST",
        credentials: "same-origin",
        headers: { [CLOSE_CALLER_HEADER]: caller },
        signal: attempt.signal,
      });
      return await judge(res);
    } catch {
      return { kind: "retry" };
    } finally {
      clearTimeout(timeout);
      stop.signal.removeEventListener("abort", onStop);
    }
  }

  async function climb(): Promise<void> {
    const maxSends = RESOLVE_MAX_SENDS[caller];
    let failedSends = 0;
    let windowWaits = 0;
    while (!stop.signal.aborted) {
      const outcome = await ask();
      if (stop.signal.aborted) return;
      if (outcome.kind === "done") break;
      if (outcome.kind === "wait") {
        windowWaits += 1;
        if (windowWaits > RESOLVE_MAX_WINDOW_WAITS) break;
        await sleep(outcome.retryInMs + 100 + random() * 200);
        continue;
      }
      failedSends += 1;
      if (failedSends >= maxSends) break;
      await sleep(failedSends === 1 ? 1000 + random() * 1000 : 2500 + random() * 1500);
    }
    if (!stop.signal.aborted) onSettled?.();
  }

  void climb();

  return () => {
    stop.abort();
    if (timer) clearTimeout(timer);
    wake?.();
  };
}
