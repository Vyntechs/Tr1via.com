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
//   recordDiagRows(...)       the way every normal row is stored. It first
//                             asks the database for room under the night's
//                             row caps (see "row caps" below), then inserts
//                             only as many rows as were granted.
//   insertDiagRows(table, r)  one insert with the service-role client, given
//                             up on after DIAG_WRITE_TIMEOUT_MS. A failed
//                             insert prints ONE short line to the server
//                             console so a test or a reader can see that
//                             logging is failing (and never changes a response).
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
// Dropped, failed and capped writes are counted. The counts are written as one
// `diag_server_actions` row (actor "system", action "diag_drops") as soon as
// the database accepts a write again, so a gap in a night's evidence says so.
//
// Server only. Tables are not in the generated types yet, so the client is
// cast to a narrow shape (same pattern as lib/api/gameDelivery.ts).

import "server-only";

import { after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { DiagLookupSlow, DiagTimeout, withDeadline } from "./deadline";
import {
  DIAG_BUCKET_ROW_CAPS,
  DIAG_CLEANUP_BATCH_ROWS,
  DIAG_CLEANUP_BUDGET_MS,
  DIAG_CLEANUP_MAX_BATCHES,
  DIAG_JOB_DEADLINE_MS,
  DIAG_MAX_WRITES_IN_FLIGHT,
  DIAG_NIGHT_ROW_CAP,
  DIAG_NIGHT_SERVER_ROW_CAP,
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
const pending = { dropped: 0, failed: 0, capped: 0 };
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
  pending.dropped = 0;
  pending.failed = 0;
  pending.capped = 0;
  ignored.clear();
  lastIgnoredLineAt = 0;
  leases.clear();
  fullUntil.clear();
  lastLine.clear();
  lastCounterFlushAt = 0;
  counterFlushRunning = false;
  running = 0;
  outstanding = 0;
  for (const waiter of waiters.splice(0)) clearTimeout(waiter.timer);
  clock = options.now ?? (() => Date.now());
}

/** Test hook: how many writes were dropped / failed / capped and not yet recorded. */
export function __diagWriteCountersForTests(): {
  dropped: number;
  failed: number;
  capped: number;
  inFlight: number;
  queued: number;
  ignored: number;
} {
  let ignoredTotal = 0;
  for (const n of ignored.values()) ignoredTotal += n;
  return {
    dropped: pending.dropped,
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
      pending.dropped += 1;
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
          pending.dropped += 1;
          logOnce("drop", "dropping log writes: waited too long for a turn");
          return;
        }
        try {
          await withDeadline(DIAG_JOB_DEADLINE_MS, () => task());
        } catch (error) {
          // A lookup that could not be answered in time is counted, not taken for a stranger.
          if (error instanceof DiagLookupSlow) noteIgnored("slow");
          // Anything else was already counted where it happened.
        } finally {
          releaseTurn();
        }
      } finally {
        finish();
      }
      void flushCounters();
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

/** Write the drop / failure counts once the database is taking writes again. */
async function flushCounters(): Promise<void> {
  try {
    if (counterFlushRunning) return;
    if (pending.dropped === 0 && pending.failed === 0 && pending.capped === 0) return;
    const now = clock();
    if (lastCounterFlushAt !== 0 && now - lastCounterFlushAt < COUNTER_FLUSH_EVERY_MS) return;
    counterFlushRunning = true;
    lastCounterFlushAt = now;
    const { dropped, failed, capped } = pending;
    try {
      const ok = await insertCore("diag_server_actions", [
        {
          received_at: new Date().toISOString(),
          action: "diag_drops",
          actor: "system",
          http_status: 0,
          outcome: "gap",
          reason: `dropped=${dropped} failed=${failed} capped=${capped}`,
          steps: { dropped, failed, capped },
          region: process.env.VERCEL_REGION?.slice(0, 32) ?? null,
          deployment: process.env.VERCEL_DEPLOYMENT_ID?.slice(0, 64) ?? null,
        },
      ]);
      if (ok) {
        pending.dropped = Math.max(0, pending.dropped - dropped);
        pending.failed = Math.max(0, pending.failed - failed);
        pending.capped = Math.max(0, pending.capped - capped);
        if (dropped > 0) logOnce("dropped", `dropped ${dropped} log writes (too many waiting at once)`);
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

/** One insert with a deadline. True when the database accepted it. */
async function insertCore(table: DiagTable, rows: Record<string, unknown>[]): Promise<boolean> {
  try {
    const result = await withDeadline(DIAG_WRITE_TIMEOUT_MS, async (signal) => {
      const builder = admin().from(table).insert(rows);
      return await (typeof builder.abortSignal === "function" ? builder.abortSignal(signal) : builder);
    });
    // supabase-js hands failures back as `error` instead of throwing.
    if (result && result.error) {
      logOnce(`${table}:${failureCode(result.error)}`, `insert failed table=${table} code=${failureCode(result.error)}`);
      return false;
    }
    return true;
  } catch (error) {
    logOnce(`${table}:${failureCode(error)}`, `insert failed table=${table} code=${failureCode(error)}`);
    return false;
  }
}

/** One insert. Errors (including a missing table) never reach the caller. */
export async function insertDiagRows(
  table: DiagTable,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;
  try {
    if (!(await insertCore(table, rows))) pending.failed += 1;
  } catch {
    // ignore
  }
}

// ─── row caps ─────────────────────────────────────────────────────────
// Every normal row is stored through recordDiagRows(), which first asks the
// database (function diag_take_rows, table diag_quota) how many rows this
// night and this source may still have. The answer holds across every server
// instance. To keep it cheap, an instance asks for a block of rows at a time
// (DIAG_QUOTA_LEASE_ROWS), spends them from memory, and a source found to be
// full is not asked about again for a minute. A block that is never spent
// (an instance that goes away) just counts toward the cap, which is the safe
// direction.
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

function bucketOf(source: DiagSource): string {
  if (source.kind === "player") return `p:${source.deviceId}`;
  if (source.kind === "tap") return `a:${source.deviceId}`;
  return source.kind;
}

/** Reports stop at the night cap; the server's own rows have room above it. */
function nightCapOf(source: DiagSource): number {
  return source.kind === "tap" || source.kind === "press" ? DIAG_NIGHT_SERVER_ROW_CAP : DIAG_NIGHT_ROW_CAP;
}

const leases = new Map<string, { left: number }>();
const fullUntil = new Map<string, number>();
const QUOTA_MEMORY_MAX = 2000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Rows granted (0 = full), "busy" (another server held the night's counter at
 * that instant, even after retries), or null when the database could not be asked.
 */
async function takeRows(nightId: string, source: DiagSource, want: number): Promise<number | "busy" | null> {
  const bucket = bucketOf(source);
  const key = `${nightId}|${bucket}`;
  const now = clock();
  const blockedUntil = fullUntil.get(key);
  if (blockedUntil !== undefined) {
    if (now < blockedUntil) return 0;
    fullUntil.delete(key);
  }
  let lease = leases.get(key);
  if (!lease) {
    if (leases.size >= QUOTA_MEMORY_MAX) leases.clear();
    lease = { left: 0 };
    leases.set(key, lease);
  }
  if (lease.left < want) {
    const ask = Math.max(want - lease.left, DIAG_QUOTA_LEASE_ROWS);
    let granted = -1;
    for (let attempt = 0; granted === -1; attempt += 1) {
      try {
        const result = await withDeadline(DIAG_WRITE_TIMEOUT_MS, async (signal) => {
          const call = admin().rpc("diag_take_rows", {
            p_night_id: nightId,
            p_bucket: bucket,
            p_want: ask,
            p_bucket_cap: DIAG_BUCKET_ROW_CAPS[source.kind],
            p_night_cap: nightCapOf(source),
          });
          return await (typeof call.abortSignal === "function" ? call.abortSignal(signal) : call);
        });
        if (result && result.error) {
          logOnce(`quota:${failureCode(result.error)}`, `row-cap check failed code=${failureCode(result.error)}`);
          return null;
        }
        granted = Number(result?.data);
        if (!Number.isFinite(granted) || granted < -1) return null;
      } catch (error) {
        logOnce(`quota:${failureCode(error)}`, `row-cap check failed code=${failureCode(error)}`);
        return null;
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
  }
  const give = Math.min(want, lease.left);
  lease.left -= give;
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
    if (granted === null) {
      pending.failed += 1;
      return;
    }
    if (granted === "busy") {
      pending.dropped += 1;
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
      value = await withDeadline(DIAG_WRITE_TIMEOUT_MS, load);
    } catch {
      // Too slow, or the database said no. That is NOT "no such row": say so
      // (and do not remember it), so the caller does not take a real player for a stranger.
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
