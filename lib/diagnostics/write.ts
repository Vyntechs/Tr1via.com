// Getting diagnostic rows into the database without ever getting in the way.
//
//   scheduleDiagWrite(task)   runs the task AFTER the response has gone out
//                             (Next's after(), which Vercel keeps the
//                             function alive for). Every failure is
//                             swallowed: logging can never break or slow a
//                             request. At most DIAG_MAX_WRITES_IN_FLIGHT (5)
//                             tasks touch the database at once; the rest wait
//                             in a short queue, and a job that waits too long
//                             or arrives to a full queue is dropped and
//                             counted. So a burst of taps can never take the
//                             database connections real answers need.
//                             A job keeps its turn until every database call
//                             it made has RETURNED (see "turns" below), so the
//                             limit is on what the database is running, not on
//                             what the app is still waiting for. That limit is
//                             per server copy; the DATABASE adds one across all
//                             copies (3 write slots in diag_insert_rows).
//   recordDiagRows(...)       the way every normal row is stored. It first
//                             asks the database for room under the night's
//                             row caps (see "row caps" below), then inserts
//                             only as many rows as were granted.
//   insertDiagRows(table, r)  one insert, through the database function
//                             diag_insert_rows. That function (and the row-cap
//                             function) carries its OWN statement timeout
//                             (DIAG_DB_STATEMENT_TIMEOUT_MS), so the DATABASE
//                             cancels a slow log write by itself, and no other
//                             query is affected. A failed insert prints ONE
//                             short line to the server console so a test or a
//                             reader can see that logging is failing (and never
//                             changes a response).
//   lookup*                   small cached id lookups used to fill in the
//                             night / player on rows whose handler returned
//                             before it knew them (a late tap is turned away
//                             before the player is even looked up), and to
//                             check that the caller really is a player of
//                             that night or the host who owns it. A lookup
//                             that finds nothing is remembered for a short
//                             time too, so made-up ids cost one read each.
//   noteIgnored(kind)         a request that was not from a verified player or
//                             host stores nothing; it only bumps a counter,
//                             printed as one summary line a minute.
//
// Turns. Cancelling an HTTP request does not stop the statement behind it:
// PostgREST keeps running it after the client hangs up, and a request still
// waiting for one of its connections is run later, once one frees up (both
// measured). So a job never lets go of its turn because the APP stopped
// waiting. Every database call of a job goes through trackedCall (deadline.ts):
// it is cancelled only at a high ceiling (DIAG_CALL_CEILING_MS), the normal
// "too slow" ending is the database's own statement timeout answering with
// error 57014, and the job gives its turn back only when all its calls have
// returned (or, after a cancel at the ceiling, DIAG_ABORT_HOLD_MS later).
// Counters are written inside a turn too.
//
// Dropped, failed and capped writes are counted. The counts are written as one
// `diag_server_actions` row (actor "system", action "diag_drops") as soon as
// the database accepts a write again, so a gap in a night's evidence says so.
//
// Server only. Tables are not in the generated types yet, so the client is
// cast to a narrow shape (same pattern as lib/api/gameDelivery.ts).

import "server-only";

import { after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  createJobScope,
  DiagLookupSlow,
  DiagTimeout,
  runInJobScope,
  settleJobScope,
  trackedCall,
  withDeadline,
} from "./deadline";
import {
  DIAG_ABORT_HOLD_MS,
  DIAG_BUCKET_ROW_CAPS,
  DIAG_CALL_CEILING_MS,
  DIAG_CLEANUP_BATCH_ROWS,
  DIAG_CLEANUP_BUDGET_MS,
  DIAG_CLEANUP_MAX_BATCHES,
  DIAG_DEVICE_ROW_CAPS,
  DIAG_JOB_DEADLINE_MS,
  DIAG_MAX_WRITES_IN_FLIGHT,
  DIAG_NIGHT_PRESS_ROW_CAP,
  DIAG_NIGHT_ROW_CAP,
  DIAG_NIGHT_SERVER_ROW_CAP,
  DIAG_PAUSE_AFTER_TIMEOUTS,
  DIAG_PAUSE_MS,
  DIAG_QUEUE_WAIT_MS,
  DIAG_QUOTA_BUSY_BACKOFF_MS,
  DIAG_QUOTA_BUSY_RETRIES,
  DIAG_QUOTA_FULL_MEMORY_MS,
  DIAG_QUOTA_LEASE_ROWS,
  DIAG_RETENTION_DAYS,
  DIAG_WRITE_QUEUE_MAX,
  DIAG_WRITE_TIMEOUT_MS,
} from "./config";

export type DiagTable =
  | "diag_answer_events"
  | "diag_server_actions"
  | "diag_device_events";

type Scheduler = (task: () => Promise<void>) => void;

function defaultScheduler(task: () => Promise<void>): void {
  const safe = async () => {
    try {
      await task();
    } catch {
      // Logging is best-effort by design.
    }
  };
  try {
    after(safe);
  } catch {
    // after() only works inside a request (not in a unit test or script).
    void safe();
  }
}

let scheduler: Scheduler = defaultScheduler;

/** Test hook: replace how after-the-response work is scheduled. */
export function __setDiagSchedulerForTests(next: Scheduler | null): void {
  scheduler = next ?? defaultScheduler;
}

// ─── counters, and one short console line per kind of failure ────────
// Why a write did not happen, kept apart so the summary can say the TRUE reason:
//   queueFull       too many jobs were already waiting for a turn
//   waitedTooLong   a job waited DIAG_QUEUE_WAIT_MS for a turn and was dropped
//   busy            the row-cap counter was held by another server (even after retries)
//   slots           all of the database's fleet-wide log write slots were taken (see diag_insert_rows)
//   timedOut        the database cancelled the write (statement or lock timeout) or it hit the ceiling
//   paused          logging was paused because the database was in trouble with log writes
//   failed          the database answered with some other error
//   capped          rows past a row cap
const pending = { queueFull: 0, waitedTooLong: 0, busy: 0, slots: 0, timedOut: 0, paused: 0, failed: 0, capped: 0 };
const LOG_EVERY_MS = 60_000;
const COUNTER_FLUSH_EVERY_MS = 10_000;
const lastLine = new Map<string, { at: number; skipped: number }>();
let lastCounterFlushAt = 0;
let counterFlushRunning = false;
let clock: () => number = () => Date.now();

/** At most one line a minute per kind (the rest are counted into the next line). */
function logOnce(key: string, text: string): void {
  try {
    const now = clock();
    const seen = lastLine.get(key);
    if (seen && now - seen.at < LOG_EVERY_MS) {
      seen.skipped += 1;
      return;
    }
    if (lastLine.size >= 50) lastLine.clear();
    lastLine.set(key, { at: now, skipped: 0 });
    const more = seen && seen.skipped > 0 ? ` (+${seen.skipped} more since the last line)` : "";
    // Never the error message or details: Postgres can put row contents in them.
    console.warn(`[diag] ${text}${more}`);
  } catch {
    // a broken console must not matter
  }
}

function failureCode(error: unknown): string {
  if (error instanceof DiagTimeout) return "timeout";
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_]{1,16}$/.test(code)) return code;
    return "error";
  }
  return "exception";
}

/** Test hook: counters, console-line memory and the clock. */
export function __resetDiagWriteForTests(options: { now?: () => number } = {}): void {
  pending.queueFull = 0;
  pending.waitedTooLong = 0;
  pending.busy = 0;
  pending.slots = 0;
  pending.timedOut = 0;
  pending.paused = 0;
  pending.failed = 0;
  pending.capped = 0;
  slowStreak = 0;
  pausedUntil = 0;
  probing = false;
  ignored.clear();
  lastIgnoredLineAt = 0;
  leases.clear();
  fullUntil.clear();
  deviceUsed.clear();
  asking.clear();
  lastLine.clear();
  lastCounterFlushAt = 0;
  counterFlushRunning = false;
  running = 0;
  outstanding = 0;
  for (const waiter of waiters.splice(0)) clearTimeout(waiter.timer);
  clock = options.now ?? (() => Date.now());
}

/** Test hook: put the owed counts at chosen values (to see the summary row with very large counts). */
export function __setDiagCountersForTests(counts: Partial<typeof pending>): void {
  Object.assign(pending, counts);
}

/** Test hook: how many writes were dropped / failed / capped and not yet recorded. */
export function __diagWriteCountersForTests(): {
  /** Jobs that never got a turn (queue full + waited too long). */
  dropped: number;
  queueFull: number;
  waitedTooLong: number;
  busy: number;
  slots: number;
  timedOut: number;
  paused: number;
  failed: number;
  capped: number;
  inFlight: number;
  queued: number;
  ignored: number;
} {
  let ignoredTotal = 0;
  for (const n of ignored.values()) ignoredTotal += n;
  return {
    dropped: pending.queueFull + pending.waitedTooLong,
    queueFull: pending.queueFull,
    waitedTooLong: pending.waitedTooLong,
    busy: pending.busy,
    slots: pending.slots,
    timedOut: pending.timedOut,
    paused: pending.paused,
    failed: pending.failed,
    capped: pending.capped,
    inFlight: running,
    queued: waiters.length,
    ignored: ignoredTotal,
  };
}

// ─── requests that are not from a verified player or host ────────────
// Nothing is stored for them. They are only counted, and one summary line a
// minute says how many there were, so a flood is visible without costing a
// database write.
const ignored = new Map<string, number>();
let lastIgnoredLineAt = 0;

// "slow" is a caller we could not verify IN TIME (a lookup timed out or failed),
// which is different from one we looked up and found not to be a player or host.
export type IgnoredKind = "answer" | "action" | "report" | "slow";

/** Never throws, never touches the database. */
export function noteIgnored(kind: IgnoredKind): void {
  try {
    ignored.set(kind, (ignored.get(kind) ?? 0) + 1);
    const now = clock();
    if (lastIgnoredLineAt !== 0 && now - lastIgnoredLineAt < LOG_EVERY_MS) return;
    lastIgnoredLineAt = now;
    const parts = [...ignored].map(([name, count]) => `${name}=${count}`).join(" ");
    ignored.clear();
    console.info(
      `[diag] stored nothing for requests with no verified player or host (slow = could not be checked in time): ${parts}`,
    );
  } catch {
    // counting is best-effort
  }
}

// ─── scheduling: a small number at a time, a short queue, then drop ───
// `running` jobs hold a turn (they are the only ones touching the database);
// `waiters` are jobs queued for a turn; `outstanding` is everything handed to
// the scheduler and not finished yet, which is what the queue limit bounds.
let running = 0;
let outstanding = 0;
const waiters: Array<{ grant: (got: boolean) => void; timer: ReturnType<typeof setTimeout> }> = [];

// ─── a pause when the database is in trouble with log writes ──────────
// Even with the limits of 5 at a time per server and 3 at a time across all
// servers (diag_insert_rows), a database that stalls every log write would keep
// connections busy for as long as logs keep coming, and PostgREST has only about
// 10 for everything: the game's own calls (the question-close calls at timer end
// above all) would have to share what is left. So after DIAG_PAUSE_AFTER_TIMEOUTS
// log calls in a row came back in trouble, new log jobs are dropped (counted as
// "paused") for DIAG_PAUSE_MS. After that ONE job is let through to see whether
// the database is back; a good answer ends the pause, another failure starts a
// new one. Losing log rows while the database is in trouble is the intended
// trade; slowing a tap or a press is not.
//
// What counts as "in trouble" (verdictOf): the database cancelling a write
// (57014) or giving up on a lock (55P03), no answer at the ceiling, and every
// failure that is NOT the database refusing one particular row: a full
// connection pool (PGRST003), a gateway error, "fetch failed", a missing table or
// function, a refused connection. What does not: a row the table refused (data
// and constraint errors, class 22 and 23), which says nothing about the
// database; a call the job never had time to send; and a single "busy" answer
// (the night's counter or the write slots were taken), which is ordinary
// contention. (A write that still finds every slot taken after all its
// back-offs does count: the slots are then held by stalled writes.)
// Only a stored INSERT resets the streak of failures: a fast row-cap answer
// ("yes, room for 100 more") must not hide that every insert after it was
// cancelled. A good row-cap answer to the one job testing the database after a pause
// does end that pause (the database answered), without forgetting the streak.
let slowStreak = 0;
let pausedUntil = 0;
let probing = false;

type Verdict = "answered" | "trouble" | "not-sent";

/** How a failed database call counts for the pause. */
function verdictOf(error: unknown): Verdict {
  if (error instanceof DiagTimeout) return error.sent ? "trouble" : "not-sent";
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  // The table refused one particular row: the database is fine, the next batch may be too.
  if (typeof code === "string" && /^(22|23)[0-9A-Z]{3}$/.test(code)) return "answered";
  return "trouble";
}

/**
 * What a database call for logging came to. `call` says which kind: "insert"
 * (a stored write), "check" (the row-cap question) or "read" (an id lookup).
 */
function noteWriteOutcome(call: "insert" | "check" | "read", verdict: Verdict): void {
  if (verdict === "not-sent") return;
  if (verdict === "trouble") {
    slowStreak += 1;
    if (slowStreak >= DIAG_PAUSE_AFTER_TIMEOUTS) {
      pausedUntil = clock() + DIAG_PAUSE_MS;
      probing = false;
    }
    return;
  }
  if (call === "insert") {
    slowStreak = 0;
    pausedUntil = 0;
    probing = false;
  } else if (call === "check" && probing) {
    // Only the job testing the database after a pause may end it with a row-cap answer
    // (a job that was already running when the pause began says nothing new).
    pausedUntil = 0;
    probing = false;
  }
}

/** True while logging is paused (the database is in trouble with log writes). Cheap; no database call. */
export function isLoggingPaused(): boolean {
  return pausedUntil !== 0 && clock() < pausedUntil;
}

/** True if this job may use the database. Called once the job has its turn. */
function admitJob(): { admit: boolean; isProbe: boolean } {
  if (pausedUntil === 0) return { admit: true, isProbe: false };
  if (clock() < pausedUntil) return { admit: false, isProbe: false };
  if (probing) return { admit: false, isProbe: false }; // another job is already testing the database
  probing = true;
  return { admit: true, isProbe: true };
}

/** Resolves true when this job has a turn, false if it waited too long for one. */
function acquireTurn(): Promise<boolean> {
  if (running < DIAG_MAX_WRITES_IN_FLIGHT) {
    running += 1;
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    const waiter = {
      grant: resolve,
      timer: setTimeout(() => {
        const at = waiters.indexOf(waiter);
        if (at >= 0) waiters.splice(at, 1);
        resolve(false);
      }, DIAG_QUEUE_WAIT_MS),
    };
    (waiter.timer as { unref?: () => void }).unref?.();
    waiters.push(waiter);
  });
}

function releaseTurn(): void {
  const next = waiters.shift();
  if (next) {
    // The turn passes straight to the next job in line.
    clearTimeout(next.timer);
    next.grant(true);
  } else {
    running = Math.max(0, running - 1);
  }
}

/** Never throws. */
export function scheduleDiagWrite(task: () => Promise<void>): void {
  try {
    if (outstanding >= DIAG_MAX_WRITES_IN_FLIGHT + DIAG_WRITE_QUEUE_MAX) {
      pending.queueFull += 1;
      logOnce("drop", "dropping log writes: too many waiting");
      return;
    }
    outstanding += 1;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      outstanding = Math.max(0, outstanding - 1);
    };

    const job = async () => {
      try {
        if (!(await acquireTurn())) {
          // Waited too long: the evidence is stale and the database is busy. Give way.
          pending.waitedTooLong += 1;
          logOnce("drop", "dropping log writes: waited too long for a turn");
          return;
        }
        // The turn is held until every database call of the job has RETURNED.
        // Inside the job scope no call starts after the job's deadline; a call
        // that has started is let finish (the database cancels a slow log write
        // by itself, DIAG_DB_STATEMENT_TIMEOUT_MS; we cancel the request only at
        // DIAG_CALL_CEILING_MS), and settleJobScope waits for all of them.
        const { admit, isProbe } = admitJob();
        if (!admit) {
          // The database is cancelling log writes: do not ask it for more (see "a pause", above).
          pending.paused += 1;
          logOnce("paused", "pausing log writes: the database keeps cancelling them for being slow");
          releaseTurn();
          return;
        }
        const scope = createJobScope(Date.now() + DIAG_JOB_DEADLINE_MS);
        const flushScope = createJobScope(0);
        try {
          try {
            // The outer limit is only a last resort for work that hangs outside any call.
            await withDeadline(DIAG_JOB_DEADLINE_MS + DIAG_CALL_CEILING_MS + DIAG_WRITE_TIMEOUT_MS + 1_000, () =>
              runInJobScope(scope, () => task()),
            );
          } catch (error) {
            // A lookup that could not be answered in time is counted, not taken for a stranger.
            if (error instanceof DiagLookupSlow) noteIgnored("slow");
            // Anything else was already counted where it happened.
          }
          // Everything the task sent has to have RETURNED (or been cancelled at the
          // ceiling, plus the hold) before this job makes another call. One turn is
          // one statement at the database at a time.
          await settleJobScope(scope);
          // The drop / failure counts are written while this job still holds its
          // turn, so even that write is inside the limit.
          flushScope.expiresAt = Date.now() + DIAG_WRITE_TIMEOUT_MS;
          await runInJobScope(flushScope, () => flushCounters());
        } catch {
          // best-effort
        } finally {
          try {
            await Promise.all([settleJobScope(scope), settleJobScope(flushScope)]);
          } catch {
            // best-effort
          }
          // A probe that never reached the database (nothing to write) must not leave the next one waiting for it.
          if (isProbe) probing = false;
          releaseTurn();
        }
      } finally {
        finish();
      }
    };
    try {
      scheduler(job);
    } catch {
      finish();
    }
  } catch {
    // A broken scheduler must not reach the caller.
  }
}

/** The kinds of drop, in the order they are written down. */
const COUNT_KEYS = ["queueFull", "waitedTooLong", "busy", "slots", "timedOut", "paused", "failed", "capped"] as const;

/**
 * Write the drop / failure counts once the database is taking writes again.
 * Call it inside a turn.
 *
 * The numbers live in `steps` (always small enough); `reason` only NAMES the
 * kinds that are not zero, so it always fits the column's 64 characters however
 * large the counts have grown. If the database refuses the row itself (a data or
 * constraint error), retrying would never work: the counts are discarded, with
 * one console line, instead of being retried every ten seconds for ever.
 */
async function flushCounters(): Promise<void> {
  try {
    if (counterFlushRunning) return;
    // While the database is in trouble with log writes, do not add one more that would stall the same way:
    // the counts are written once a write has gone through again.
    if (pausedUntil !== 0 || slowStreak > 0) return;
    if (COUNT_KEYS.every((key) => pending[key] === 0)) return;
    const now = clock();
    if (lastCounterFlushAt !== 0 && now - lastCounterFlushAt < COUNTER_FLUSH_EVERY_MS) return;
    counterFlushRunning = true;
    lastCounterFlushAt = now;
    const sent = { ...pending };
    const dropped = sent.queueFull + sent.waitedTooLong;
    const names = [
      dropped > 0 ? "dropped" : "",
      sent.busy > 0 ? "busy" : "",
      sent.slots > 0 ? "slots" : "",
      sent.timedOut > 0 ? "timed_out" : "",
      sent.paused > 0 ? "paused" : "",
      sent.failed > 0 ? "failed" : "",
      sent.capped > 0 ? "capped" : "",
    ].filter(Boolean);
    try {
      const outcome = await insertCore("diag_server_actions", [
        {
          received_at: new Date().toISOString(),
          action: "diag_drops",
          actor: "system",
          http_status: 0,
          outcome: "gap",
          // Names only (the numbers are in `steps`): this always fits 64 characters.
          reason: `see steps: ${names.join(",")}`.slice(0, 64),
          steps: {
            dropped,
            queue_full: sent.queueFull,
            waited_too_long: sent.waitedTooLong,
            busy: sent.busy,
            slots: sent.slots,
            timed_out: sent.timedOut,
            paused: sent.paused,
            failed: sent.failed,
            capped: sent.capped,
          },
          region: process.env.VERCEL_REGION?.slice(0, 32) ?? null,
          deployment: process.env.VERCEL_DEPLOYMENT_ID?.slice(0, 64) ?? null,
        },
      ]);
      // The database refused the row itself (data / constraint error): it never will accept it.
      const refused = !outcome.ok && typeof outcome.code === "string" && /^(22|23)[0-9A-Z]{3}$/.test(outcome.code);
      if (outcome.ok || refused) {
        for (const key of COUNT_KEYS) pending[key] = Math.max(0, pending[key] - sent[key]);
      }
      if (refused) {
        logOnce("summary-refused", `the drop summary row was refused by the database (code=${outcome.code}); its counts were discarded`);
      }
      if (outcome.ok) {
        // Say the TRUE reason for each kind of drop.
        if (dropped > 0) {
          logOnce(
            "dropped",
            `dropped ${dropped} log writes (jobs that never got a turn: ${sent.queueFull} found the queue full, ${sent.waitedTooLong} waited too long)`,
          );
        }
        if (sent.busy > 0) {
          logOnce("dropped-busy", `dropped ${sent.busy} log row batches (the row-cap counter was busy)`);
        }
        if (sent.slots > 0) {
          logOnce("dropped-slots", `dropped ${sent.slots} log row batches (all of the database's log write slots were taken)`);
        }
        if (sent.timedOut > 0) {
          logOnce("dropped-timeout", `lost ${sent.timedOut} log writes (the database cancelled them or they ran out of time)`);
        }
        if (sent.paused > 0) {
          logOnce("dropped-paused", `dropped ${sent.paused} log writes (logging was paused while the database was in trouble with log writes)`);
        }
      }
    } finally {
      counterFlushRunning = false;
    }
  } catch {
    // counters are best-effort
  }
}

// ─── the database, through a narrow shape ────────────────────────────
interface LooseResult<T> {
  data?: T | null;
  error?: unknown;
}
interface LooseQuery<T> extends PromiseLike<LooseResult<T>> {
  select(columns: string): LooseQuery<T>;
  eq(column: string, value: string): LooseQuery<T>;
  abortSignal?(signal: AbortSignal): LooseQuery<T>;
  maybeSingle(): PromiseLike<LooseResult<T>>;
}
interface LooseInsert extends PromiseLike<LooseResult<unknown>> {
  abortSignal?(signal: AbortSignal): LooseInsert;
}
interface LooseAdmin {
  from(table: string): LooseQuery<Record<string, unknown>> & {
    insert(rows: Record<string, unknown> | Record<string, unknown>[]): LooseInsert;
  };
  rpc(fn: string, args: Record<string, unknown>): LooseInsert;
}

function admin(): LooseAdmin {
  return getSupabaseAdmin() as unknown as LooseAdmin;
}

/** What happened to one database call made for logging. */
type CallOutcome =
  | { ok: true }
  | {
      ok: false;
      /** The database cancelled it (statement timeout, lock timeout) or the request ran out of time. */
      timedOut: boolean;
      /** Every fleet-wide write slot stayed taken, even after the back-offs: nothing was written. */
      slotsFull?: boolean;
      /** The database's error code, when it gave one. */
      code?: string;
    };

/** The database cancelled the statement (57014) or gave up on a lock (55P03), or the request ran out of time. */
function isTimeout(error: unknown): boolean {
  if (error instanceof DiagTimeout) return true;
  const code = failureCode(error);
  return code === "57014" || code === "55P03";
}

/**
 * One insert, through diag_insert_rows. That function has its own statement
 * timeout and lock timeout, so a stalled insert is cancelled BY THE DATABASE and
 * answers; we wait for that answer (see the notes at the top of this file), and
 * only cancel the request ourselves at DIAG_CALL_CEILING_MS. The function also
 * hands out only a few write slots across ALL servers and answers -1 ("busy") at
 * once when they are taken: we back off a few milliseconds and ask again, then
 * give the rows up (counted), as for the night's counter.
 */
async function insertCore(table: DiagTable, rows: Record<string, unknown>[]): Promise<CallOutcome> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await trackedCall(
        async (signal) => {
          const call = admin().rpc("diag_insert_rows", { p_table: table, p_rows: rows });
          return await (typeof call.abortSignal === "function" ? call.abortSignal(signal) : call);
        },
        { ceilingMs: DIAG_CALL_CEILING_MS, holdAfterAbortMs: DIAG_ABORT_HOLD_MS },
      );
      // supabase-js hands failures back as `error` instead of throwing.
      if (result && result.error) {
        const code = failureCode(result.error);
        logOnce(`${table}:${code}`, `insert failed table=${table} code=${code}`);
        noteWriteOutcome("insert", verdictOf(result.error));
        return { ok: false, timedOut: isTimeout(result.error), code };
      }
      if (Number(result?.data) === -1) {
        // One "busy" is ordinary contention (slots are held for milliseconds): neither a success nor trouble.
        if (attempt >= DIAG_QUOTA_BUSY_RETRIES) {
          // But a write that finds every slot still taken after all its back-offs means the
          // slots are held by stalled writes: that counts toward the pause, so a copy whose own
          // writes were not the stalled ones stops asking too, instead of making three quick calls per job.
          noteWriteOutcome("insert", "trouble");
          return { ok: false, timedOut: false, slotsFull: true };
        }
        await sleep(DIAG_QUOTA_BUSY_BACKOFF_MS * (1 + Math.random()));
        continue;
      }
      noteWriteOutcome("insert", "answered");
      return { ok: true };
    } catch (error) {
      const code = failureCode(error);
      logOnce(`${table}:${code}`, `insert failed table=${table} code=${code}`);
      noteWriteOutcome("insert", verdictOf(error));
      return { ok: false, timedOut: isTimeout(error), code };
    }
  }
}

/** One insert. Errors (including a missing table) never reach the caller. */
export async function insertDiagRows(
  table: DiagTable,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const outcome = await insertCore(table, rows);
    if (!outcome.ok) {
      if (outcome.slotsFull) {
        pending.slots += 1;
        logOnce("slots", "log write slots all taken: dropping log rows instead of waiting");
      } else if (outcome.timedOut) pending.timedOut += 1;
      else pending.failed += 1;
    }
  } catch {
    // ignore
  }
}

// ─── row caps ─────────────────────────────────────────────────────────
// Every normal row is stored through recordDiagRows(), which first asks the
// database (function diag_take_rows, table diag_quota) how many rows this
// night and this KIND of source (phone reports, TV, host, taps, presses) may
// still have. The answer holds across every server instance. To keep it cheap
// an instance asks for a block of rows at a time (DIAG_QUOTA_LEASE_ROWS, 100
// for the busy kinds), spends them from memory, and a kind found to be full is
// not asked about again for a minute. A block that is never spent (an
// instance that goes away) just counts toward the cap, which is the safe
// direction. One phone's share is counted in this server's memory (see
// DIAG_DEVICE_ROW_CAPS), so a burst of 60 different phones is still one call.
//
// The check NEVER waits for a lock. The database function takes a per-night
// try-lock and answers -1 ("busy") at once if another server is in the middle
// of the same night's counter (and it gives up on any row lock after 50 ms), so
// a log job can never sit holding a database connection behind other logging.
// On "busy" this side backs off for a few milliseconds (no connection held)
// and asks again, a couple of times, then drops the rows and counts them.
export type DiagSource =
  // device reports
  | { kind: "player"; deviceId: string }
  | { kind: "tv" }
  | { kind: "host" }
  // the server's own rows: a phone's taps and timer-end calls, the host's presses
  | { kind: "tap"; deviceId: string }
  | { kind: "press" };

/** The database counter a source's rows come out of: one per KIND, not per phone. */
function bucketOf(source: DiagSource): string {
  if (source.kind === "player") return "phones";
  if (source.kind === "tap") return "taps";
  return source.kind;
}

/**
 * Reports stop at the night cap; taps and timer-end calls have room above it;
 * host presses have their own small reserve above THAT (see config.ts), so a
 * press can never be crowded out by anything else.
 */
function nightCapOf(source: DiagSource): number {
  if (source.kind === "press") return DIAG_NIGHT_PRESS_ROW_CAP;
  return source.kind === "tap" ? DIAG_NIGHT_SERVER_ROW_CAP : DIAG_NIGHT_ROW_CAP;
}

const leases = new Map<string, { left: number }>();
const fullUntil = new Map<string, number>();
// How many rows this server has stored for one phone tonight (memory only).
const deviceUsed = new Map<string, number>();
const QUOTA_MEMORY_MAX = 2000;
const DEVICE_MEMORY_MAX = 5000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Rows added to the lease (0 = full), "busy" (see below), "timeout" (the
 * database cancelled the check, or it ran out of time) or "failed" (the
 * database could not be asked, or answered with an error).
 */
type BlockOutcome = number | "busy" | "timeout" | "failed";

// One block request per night and kind at a time: five jobs that find the block
// spent at the same moment share ONE call to the database instead of making
// five (and reserving five blocks).
const asking = new Map<string, Promise<BlockOutcome>>();

async function askForBlock(
  key: string,
  nightId: string,
  source: DiagSource,
  lease: { left: number },
  ask: number,
): Promise<BlockOutcome> {
  const bucket = bucketOf(source);
  let granted = -1;
  for (let attempt = 0; granted === -1; attempt += 1) {
    try {
      // Like the insert: the function has its own statement timeout, and we wait for its answer.
      const result = await trackedCall(
        async (signal) => {
          const call = admin().rpc("diag_take_rows", {
            p_night_id: nightId,
            p_bucket: bucket,
            p_want: ask,
            p_bucket_cap: DIAG_BUCKET_ROW_CAPS[source.kind],
            p_night_cap: nightCapOf(source),
          });
          return await (typeof call.abortSignal === "function" ? call.abortSignal(signal) : call);
        },
        { ceilingMs: DIAG_CALL_CEILING_MS, holdAfterAbortMs: DIAG_ABORT_HOLD_MS },
      );
      if (result && result.error) {
        logOnce(`quota:${failureCode(result.error)}`, `row-cap check failed code=${failureCode(result.error)}`);
        noteWriteOutcome("check", verdictOf(result.error));
        return isTimeout(result.error) ? "timeout" : "failed";
      }
      granted = Number(result?.data);
      if (!Number.isFinite(granted) || granted < -1) return "failed";
      // A row-cap answer ends a pause that is running, but never clears a streak of failed inserts;
      // "busy" (-1) is ordinary contention and says nothing either way.
      if (granted !== -1) noteWriteOutcome("check", "answered");
    } catch (error) {
      logOnce(`quota:${failureCode(error)}`, `row-cap check failed code=${failureCode(error)}`);
      noteWriteOutcome("check", verdictOf(error));
      return isTimeout(error) ? "timeout" : "failed";
    }
    if (granted === -1) {
      if (attempt >= DIAG_QUOTA_BUSY_RETRIES) return "busy";
      await sleep(DIAG_QUOTA_BUSY_BACKOFF_MS * (1 + Math.random()));
    }
  }
  if (granted === 0) {
    if (fullUntil.size >= QUOTA_MEMORY_MAX) fullUntil.clear();
    fullUntil.set(key, clock() + DIAG_QUOTA_FULL_MEMORY_MS);
  }
  lease.left += Math.floor(granted);
  return granted;
}

/**
 * Rows granted (0 = full), "busy" (another server held the night's counter at
 * that instant, even after retries), "timeout" or "failed" (see BlockOutcome).
 */
async function takeRows(nightId: string, source: DiagSource, want: number): Promise<BlockOutcome> {
  const bucket = bucketOf(source);
  const key = `${nightId}|${bucket}`;
  // One phone's share of its kind (memory only): no database call needed to refuse a flood.
  let deviceKey: string | null = null;
  if (source.kind === "player" || source.kind === "tap") {
    deviceKey = `${nightId}|${source.kind}|${source.deviceId}`;
    want = Math.min(want, DIAG_DEVICE_ROW_CAPS[source.kind] - (deviceUsed.get(deviceKey) ?? 0));
    if (want <= 0) return 0;
  }
  const blockedUntil = fullUntil.get(key);
  if (blockedUntil !== undefined) {
    if (clock() < blockedUntil) return 0;
    fullUntil.delete(key);
  }
  let lease = leases.get(key);
  if (!lease) {
    if (leases.size >= QUOTA_MEMORY_MAX) leases.clear();
    lease = { left: 0 };
    leases.set(key, lease);
  }
  while (lease.left < want) {
    let shared = asking.get(key);
    if (!shared) {
      shared = askForBlock(key, nightId, source, lease, Math.max(want - lease.left, DIAG_QUOTA_LEASE_ROWS[source.kind])).finally(
        () => asking.delete(key),
      );
      asking.set(key, shared);
    }
    const outcome = await shared;
    if (typeof outcome === "string") return outcome;
    if (outcome === 0) break; // full
  }
  const give = Math.min(want, lease.left);
  lease.left -= give;
  if (deviceKey && give > 0) {
    if (deviceUsed.size >= DEVICE_MEMORY_MAX) deviceUsed.clear();
    deviceUsed.set(deviceKey, (deviceUsed.get(deviceKey) ?? 0) + give);
  }
  return give;
}

/**
 * Store rows for a verified source, within the night's row caps. Rows past a
 * cap are dropped and counted. Never throws.
 */
export async function recordDiagRows(
  table: DiagTable,
  rows: Record<string, unknown>[],
  nightId: string,
  source: DiagSource,
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const granted = await takeRows(nightId, source, rows.length);
    if (granted === "failed") {
      pending.failed += 1;
      return;
    }
    if (granted === "timeout") {
      pending.timedOut += 1;
      return;
    }
    if (granted === "busy") {
      pending.busy += 1;
      logOnce("busy", "row-cap check busy: dropping log rows instead of waiting");
      return;
    }
    if (granted < rows.length) {
      pending.capped += rows.length - granted;
      logOnce("capped", "row cap reached: not storing more log rows for a night or source");
    }
    if (granted > 0) await insertDiagRows(table, rows.slice(0, granted));
  } catch {
    // ignore
  }
}

// ─── the 45-day cleanup ───────────────────────────────────────────────
const CLEANUP_CALL_TIMEOUT_MS = 10_000;

export type DiagCleanupResult =
  | { ok: true; removed: number; batches: number; more: boolean }
  | { ok: false; code: string; removed: number; batches: number };

/**
 * Runs cleanup_diagnostic_logs(45, 5000) over and over until it removes
 * nothing, up to DIAG_CLEANUP_MAX_BATCHES calls or DIAG_CLEANUP_BUDGET_MS. Each
 * call is its own small database transaction, so progress is kept even if a
 * run is cut short, and a big backlog is finished by the next day's run
 * (`more` says it was not finished). The day count is fixed here, never taken
 * from a request. Used only by the protected daily cron route. A failure
 * prints one short line and is returned, never thrown.
 */
export async function runDiagCleanup(): Promise<DiagCleanupResult> {
  const startedAt = Date.now();
  let removed = 0;
  let batches = 0;
  while (batches < DIAG_CLEANUP_MAX_BATCHES) {
    if (batches > 0 && Date.now() - startedAt > DIAG_CLEANUP_BUDGET_MS) {
      return { ok: true, removed, batches, more: true };
    }
    try {
      const result = await withDeadline(CLEANUP_CALL_TIMEOUT_MS, async (signal) => {
        const call = admin().rpc("cleanup_diagnostic_logs", {
          p_days: DIAG_RETENTION_DAYS,
          p_batch: DIAG_CLEANUP_BATCH_ROWS,
        });
        return await (typeof call.abortSignal === "function" ? call.abortSignal(signal) : call);
      });
      if (result && result.error) {
        const code = failureCode(result.error);
        logOnce(`cleanup:${code}`, `cleanup failed code=${code}`);
        return { ok: false, code, removed, batches };
      }
      const n = Number(result?.data ?? 0);
      batches += 1;
      if (!Number.isFinite(n) || n <= 0) return { ok: true, removed, batches, more: false };
      removed += n;
    } catch (error) {
      const code = failureCode(error);
      logOnce(`cleanup:${code}`, `cleanup failed code=${code}`);
      return { ok: false, code, removed, batches };
    }
  }
  return { ok: true, removed, batches, more: true };
}

// ─── cached id lookups ────────────────────────────────────────────────
// A found id is remembered for ten minutes. A burst of taps for one question
// asks the same thing at once, so concurrent asks share one in-flight lookup.
// A lookup also stops waiting after DIAG_WRITE_TIMEOUT_MS.
//
// A read that does not answer in DIAG_WRITE_TIMEOUT_MS is given up on by its
// caller, but it is still running at the database, so the job that started it
// keeps its turn until it has returned (the game's reads cannot be given a
// log-only statement timeout; PostgREST's own 8 s limit for every request ends
// it at the latest).
//
// "No such row" is remembered too, but only briefly (a player can join a
// moment after something was asked about them) and in a SEPARATE small list, so
// a flood of made-up ids costs one read each and cannot push the good entries
// out of the main list. A failed or timed-out lookup is never remembered, and
// it throws DiagLookupSlow instead of answering "none" (the job it belongs to
// is counted as "slow" in the minute summary, not as a stranger).
const CACHE_MAX = 500;
const CACHE_TTL_MS = 10 * 60_000;
const MISS_TTL_MS = 30_000;
const PLAYER_MISS_TTL_MS = 10_000;
const MISS_MAX = 1000;
const cache = new Map<string, { value: string; at: number }>();
const misses = new Map<string, number>();
const inFlight = new Map<string, Promise<string | null>>();

function signalled<Q extends { abortSignal?: (signal: AbortSignal) => Q }>(query: Q, signal: AbortSignal): Q {
  return typeof query.abortSignal === "function" ? query.abortSignal(signal) : query;
}

/** supabase-js hands failures back as `error`; turn one into a throw so it is not taken for "no row". */
function rowOrThrow<T>(result: LooseResult<T>): T | null {
  if (result.error) throw result.error;
  return result.data ?? null;
}

async function cached(
  key: string,
  load: (signal: AbortSignal) => Promise<string | null>,
  missTtlMs = MISS_TTL_MS,
): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const missUntil = misses.get(key);
  if (missUntil !== undefined) {
    if (Date.now() < missUntil) return null;
    misses.delete(key);
  }
  const waiting = inFlight.get(key);
  if (waiting) return waiting;
  const run = (async () => {
    let value: string | null = null;
    try {
      // The caller stops waiting after DIAG_WRITE_TIMEOUT_MS ("too slow to answer"),
      // but the read is still at the database until it returns: the job that
      // started it keeps its turn until then (trackedCall, deadline.ts).
      value = await trackedCall(load, {
        ceilingMs: DIAG_CALL_CEILING_MS,
        holdAfterAbortMs: DIAG_ABORT_HOLD_MS,
        giveUpAfterMs: DIAG_WRITE_TIMEOUT_MS,
      });
    } catch (error) {
      // Too slow, or the database said no. That is NOT "no such row": say so
      // (and do not remember it), so the caller does not take a real player for a stranger.
      // A read in trouble counts toward the pause too (see "a pause", above).
      noteWriteOutcome("read", verdictOf(error));
      throw new DiagLookupSlow();
    }
    if (value !== null) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(key, { value, at: Date.now() });
    } else if (missTtlMs > 0) {
      if (misses.size >= MISS_MAX) misses.delete(misses.keys().next().value as string);
      misses.set(key, Date.now() + missTtlMs);
    }
    return value;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

/**
 * What is already known about a room code WITHOUT asking the database: its night
 * id, `null` (remembered as not a room), or `undefined` (not known yet).
 */
export function peekRoomNight(roomCode: string): string | null | undefined {
  const key = `room-night:${roomCode}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const missUntil = misses.get(key);
  if (missUntil !== undefined && Date.now() < missUntil) return null;
  return undefined;
}

/** question -> category -> game -> night, as ids. */
export async function lookupQuestionContext(
  questionId: string,
): Promise<{ gameId: string | null; nightId: string | null }> {
  const gameId = await cached(`q-game:${questionId}`, async (signal) => {
    const q = rowOrThrow(
      await signalled(admin().from("questions").select("category_id").eq("id", questionId), signal).maybeSingle(),
    );
    const categoryId = q?.category_id;
    if (typeof categoryId !== "string") return null;
    const c = rowOrThrow(
      await signalled(admin().from("categories").select("game_id").eq("id", categoryId), signal).maybeSingle(),
    );
    return typeof c?.game_id === "string" ? c.game_id : null;
  });
  if (!gameId) return { gameId: null, nightId: null };
  return { gameId, nightId: await lookupGameNight(gameId) };
}

export function lookupGameNight(gameId: string): Promise<string | null> {
  return cached(`game-night:${gameId}`, async (signal) => {
    const g = rowOrThrow(
      await signalled(admin().from("games").select("night_id").eq("id", gameId), signal).maybeSingle(),
    );
    return typeof g?.night_id === "string" ? g.night_id : null;
  });
}

/** room code -> night id. Room codes are unique across all nights. */
export function lookupRoomNight(roomCode: string): Promise<string | null> {
  return cached(`room-night:${roomCode}`, async (signal) => {
    const n = rowOrThrow(
      await signalled(admin().from("nights").select("id").eq("room_code", roomCode), signal).maybeSingle(),
    );
    return typeof n?.id === "string" ? n.id : null;
  });
}

export function lookupNightOwner(nightId: string): Promise<string | null> {
  return cached(`night-host:${nightId}`, async (signal) => {
    const n = rowOrThrow(
      await signalled(admin().from("nights").select("host_id").eq("id", nightId), signal).maybeSingle(),
    );
    return typeof n?.host_id === "string" ? n.host_id : null;
  });
}

/** The player row of this device in this night (null when the device never joined it). */
export function lookupPlayerId(nightId: string, deviceId: string): Promise<string | null> {
  return cached(
    `player:${nightId}:${deviceId}`,
    async (signal) => {
      const p = rowOrThrow(
        await signalled(
          admin().from("players").select("id").eq("night_id", nightId).eq("device_id", deviceId),
          signal,
        ).maybeSingle(),
      );
      return typeof p?.id === "string" ? p.id : null;
    },
    PLAYER_MISS_TTL_MS,
  );
}

/** Test hook. */
export function __clearDiagCacheForTests(): void {
  cache.clear();
  misses.clear();
  inFlight.clear();
}
