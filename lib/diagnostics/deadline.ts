// A deadline for anything the diagnostic log waits on (the database, the
// sign-in service). Shared by write.ts and hostSession.ts.
//
// Two layers: every single call has its own short deadline, and a whole log JOB
// (write.ts scheduleDiagWrite) runs inside a job scope with an overall deadline.
// Inside a job scope no call can start after the job's deadline and no call can
// run past it (its time is clipped to what is left), so a job really STOPS at
// its deadline instead of carrying on at the database after giving up its turn.

import { AsyncLocalStorage } from "node:async_hooks";

const jobScope = new AsyncLocalStorage<{ expiresAt: number }>();

/** Run `fn` as a job that must be finished by `expiresAt` (ms since epoch). */
export function runInJobScope<T>(expiresAt: number, fn: () => T): T {
  return jobScope.run({ expiresAt }, fn);
}

/** Milliseconds left for the job we are inside, or undefined outside a job. */
export function jobTimeLeft(): number | undefined {
  const job = jobScope.getStore();
  return job ? job.expiresAt - Date.now() : undefined;
}

export class DiagTimeout extends Error {
  constructor() {
    super("timeout");
    this.name = "DiagTimeout";
  }
}

/**
 * Thrown by a lookup that could not be answered in time (slow or failing
 * database). It is NOT "no such row": the caller must not take it for a
 * stranger. scheduleDiagWrite counts it separately ("slow") in the minute
 * summary. Never carries the underlying message (it can contain row contents).
 */
export class DiagLookupSlow extends Error {
  constructor() {
    super("lookup too slow or failed");
    this.name = "DiagLookupSlow";
  }
}

/**
 * Run `work`, but stop waiting after `ms`. The signal is aborted at the
 * deadline so the request itself is cancelled where the client supports it;
 * the race guarantees we stop waiting even where it does not.
 */
export function withDeadline<T>(ms: number, work: (signal: AbortSignal) => PromiseLike<T> | T): Promise<T> {
  // Inside a job: never start a call the job has no time left for, and never
  // let one run past the job's deadline.
  const left = jobTimeLeft();
  if (left !== undefined) {
    if (left <= 0) return Promise.reject(new DiagTimeout());
    ms = Math.min(ms, left);
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DiagTimeout());
    }, ms);
  });
  const run = (async () => work(controller.signal))();
  // If the deadline wins, a later failure of `run` must not surface as unhandled.
  run.catch(() => {});
  return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
}
