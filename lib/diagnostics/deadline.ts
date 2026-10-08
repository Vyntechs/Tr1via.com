// A deadline for anything the diagnostic log waits on (the database, the
// sign-in service). Shared by write.ts and hostSession.ts.

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
