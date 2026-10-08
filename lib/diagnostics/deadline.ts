// Deadlines for anything the diagnostic log waits on (the database, the
// sign-in service). Shared by write.ts and hostSession.ts.
//
// Two kinds of wait, and they are different on purpose:
//
//   withDeadline    "stop waiting after N ms". For the sign-in service. The
//                   request is cancelled at the deadline, and inside a log job
//                   no call starts after the job's deadline.
//
//   trackedCall     a call to THE DATABASE made for a log job. Cancelling the
//                   HTTP request does NOT stop the statement: PostgREST keeps
//                   running it after the client hangs up (and a request still
//                   waiting for one of PostgREST's connections is run later,
//                   once one frees up; both measured on the local stack). So a
//                   log job must not let go of its turn just because it
//                   stopped waiting. A tracked call is cancelled at a high
//                   ceiling only, the job scope remembers every call until it
//                   has really returned, and the job keeps its turn until all
//                   of them have (see settleJobScope). The database cancels a
//                   slow log write by itself long before the ceiling: the log
//                   functions carry their own statement_timeout (see the
//                   migration), so the normal "slow" ending is the database's
//                   own 57014 answer.

import { AsyncLocalStorage } from "node:async_hooks";

/** What one log job remembers about the database calls it has made. */
export interface JobScope {
  /** No database call may START after this (ms since epoch). */
  expiresAt: number;
  /** Calls that have not returned yet (or been cancelled at the ceiling). */
  calls: Set<Promise<void>>;
  /** After a call was cancelled at the ceiling, hold the turn until this time. */
  holdUntil: number;
}

const jobScope = new AsyncLocalStorage<JobScope>();

export function createJobScope(expiresAt: number): JobScope {
  return { expiresAt, calls: new Set(), holdUntil: 0 };
}

/** Run `fn` as a job that must not start a call after `scope.expiresAt` (ms since epoch). */
export function runInJobScope<T>(scope: JobScope | number, fn: () => T): T {
  return jobScope.run(typeof scope === "number" ? createJobScope(scope) : scope, fn);
}

/** Milliseconds left for the job we are inside, or undefined outside a job. */
export function jobTimeLeft(): number | undefined {
  const job = jobScope.getStore();
  return job ? job.expiresAt - Date.now() : undefined;
}

export class DiagTimeout extends Error {
  /** False when the call was never sent (the job was out of time), so the database was not asked at all. */
  readonly sent: boolean;
  constructor(sent = true) {
    super("timeout");
    this.name = "DiagTimeout";
    this.sent = sent;
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
 * the race guarantees we stop waiting even where it does not. Not for the
 * database (see trackedCall): cancelling the request does not stop a statement.
 */
export function withDeadline<T>(ms: number, work: (signal: AbortSignal) => PromiseLike<T> | T): Promise<T> {
  // Inside a job: never start a call the job has no time left for, and never
  // let one run past the job's deadline.
  const left = jobTimeLeft();
  if (left !== undefined) {
    if (left <= 0) return Promise.reject(new DiagTimeout(false));
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

export interface TrackedCallOptions {
  /** Cancel the request after this long (a high ceiling, never the normal ending). */
  ceilingMs: number;
  /**
   * After a cancel at the ceiling the statement may still be at the database
   * for up to the database's own statement timeout: keep the job's turn this long.
   */
  holdAfterAbortMs: number;
  /**
   * The CALLER stops waiting after this long (a lookup that is "too slow to
   * answer"), but the call carries on and the job still keeps its turn until
   * it has returned. Leave out to wait for the answer.
   */
  giveUpAfterMs?: number;
}

/**
 * One call to the database for a log job. See the top of this file.
 *  - Inside a job it never STARTS after the job's deadline, nor while an earlier
 *    call of the job that was cancelled at the ceiling may still be running
 *    (rejects with DiagTimeout, nothing was sent).
 *  - It is remembered by the job scope until it has returned (an answer,
 *    including the database's own "cancelled: statement timeout" error), or
 *    been cancelled at the ceiling.
 * Rejects with DiagTimeout when the caller gave up or the ceiling cancelled it.
 */
export function trackedCall<T>(
  work: (signal: AbortSignal) => PromiseLike<T> | T,
  options: TrackedCallOptions,
): Promise<T> {
  const scope = jobScope.getStore();
  // Nothing is sent when the job is out of time, or while an earlier call of this
  // job, cancelled at the ceiling, may still be running at the database (one
  // turn is one statement at a time).
  if (scope && (scope.expiresAt - Date.now() <= 0 || scope.holdUntil > Date.now())) {
    return Promise.reject(new DiagTimeout(false));
  }

  const controller = new AbortController();
  const raw = (async () => work(controller.signal))();
  raw.catch(() => {}); // a late failure of a call the caller stopped waiting for is not unhandled

  let cancelledAtCeiling: () => void = () => {};
  const ceilingReached = new Promise<void>((resolve) => {
    cancelledAtCeiling = resolve;
  });
  const ceilingTimer = setTimeout(() => {
    controller.abort();
    if (scope) scope.holdUntil = Math.max(scope.holdUntil, Date.now() + options.holdAfterAbortMs);
    cancelledAtCeiling();
  }, options.ceilingMs);

  // `tracked` settles when the call has returned, or has been cancelled at the ceiling.
  const tracked: Promise<void> = Promise.race([raw.then(() => undefined, () => undefined), ceilingReached]).finally(() => {
    clearTimeout(ceilingTimer);
    scope?.calls.delete(tracked);
  });
  scope?.calls.add(tracked);

  let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    raw.then(resolve, reject);
    void ceilingReached.then(() => reject(new DiagTimeout()));
    if (options.giveUpAfterMs !== undefined) {
      giveUpTimer = setTimeout(() => reject(new DiagTimeout()), options.giveUpAfterMs);
    }
  }).finally(() => clearTimeout(giveUpTimer));
}

/**
 * Resolves when every database call of this job has returned (or been
 * cancelled at the ceiling) and any hold after such a cancel has passed. The
 * job keeps its turn until then, so the database never sees more log calls
 * than there are turns.
 */
export async function settleJobScope(scope: JobScope): Promise<void> {
  while (scope.calls.size > 0) await Promise.all([...scope.calls]);
  const wait = scope.holdUntil - Date.now();
  if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
}
