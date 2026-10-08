// Getting diagnostic rows into the database without ever getting in the way.
//
//   scheduleDiagWrite(task)   runs the task AFTER the response has gone out
//                             (Next's after(), which Vercel keeps the
//                             function alive for). Every failure is
//                             swallowed: logging can never break or slow a
//                             request. At most DIAG_MAX_WRITES_IN_FLIGHT tasks
//                             run at once; extra ones are dropped and counted.
//   insertDiagRows(table, r)  one insert with the service-role client, given
//                             up on after DIAG_WRITE_TIMEOUT_MS. A failed
//                             insert prints ONE short line to the server
//                             console so a test or a reader can see that
//                             logging is failing (and never changes a response).
//   lookup*                   small cached id lookups used to fill in the
//                             night / player on rows whose handler returned
//                             before it knew them (a late tap is turned away
//                             before the player is even looked up).
//
// Dropped and failed writes are counted. The counts are written as one
// `diag_server_actions` row (actor "system", action "diag_drops") as soon as
// the database accepts a write again, so a gap in a night's evidence says so.
//
// Server only. Tables are not in the generated types yet, so the client is
// cast to a narrow shape (same pattern as lib/api/gameDelivery.ts).

import "server-only";

import { after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { DIAG_MAX_WRITES_IN_FLIGHT, DIAG_RETENTION_DAYS, DIAG_WRITE_TIMEOUT_MS } from "./config";

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

// ─── a deadline for anything that waits on the database ──────────────
class DiagTimeout extends Error {
  constructor() {
    super("timeout");
    this.name = "DiagTimeout";
  }
}

/**
 * Run `work`, but stop waiting after `ms`. The signal is aborted at the
 * deadline so the request itself is cancelled where the client supports it;
 * the race guarantees we stop waiting even where it does not.
 */
function withDeadline<T>(ms: number, work: (signal: AbortSignal) => PromiseLike<T> | T): Promise<T> {
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

// ─── counters, and one short console line per kind of failure ────────
const pending = { dropped: 0, failed: 0 };
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
  lastLine.clear();
  lastCounterFlushAt = 0;
  counterFlushRunning = false;
  writesInFlight = 0;
  clock = options.now ?? (() => Date.now());
}

/** Test hook: how many writes were dropped / failed and not yet recorded. */
export function __diagWriteCountersForTests(): { dropped: number; failed: number; inFlight: number } {
  return { dropped: pending.dropped, failed: pending.failed, inFlight: writesInFlight };
}

// ─── scheduling, with a cap on how many run at once ──────────────────
let writesInFlight = 0;
// A task that never reports back must not hold its slot forever.
const SLOT_SAFETY_MS = DIAG_WRITE_TIMEOUT_MS * 5;

/** Never throws. */
export function scheduleDiagWrite(task: () => Promise<void>): void {
  try {
    if (writesInFlight >= DIAG_MAX_WRITES_IN_FLIGHT) {
      pending.dropped += 1;
      logOnce("drop", "dropping log writes: too many in flight");
      return;
    }
    writesInFlight += 1;
    let released = false;
    let safety: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      if (released) return;
      released = true;
      writesInFlight -= 1;
      if (safety) clearTimeout(safety);
    };
    safety = setTimeout(release, SLOT_SAFETY_MS);
    (safety as { unref?: () => void }).unref?.();

    const guarded = async () => {
      try {
        await withDeadline(SLOT_SAFETY_MS - 1_000, () => task());
      } catch {
        // timed out or failed: the failure was already counted where it happened
      } finally {
        release();
      }
      void flushCounters();
    };
    try {
      scheduler(guarded);
    } catch {
      release();
    }
  } catch {
    // A broken scheduler must not reach the caller.
  }
}

/** Write the drop / failure counts once the database is taking writes again. */
async function flushCounters(): Promise<void> {
  try {
    if (counterFlushRunning) return;
    if (pending.dropped === 0 && pending.failed === 0) return;
    const now = clock();
    if (lastCounterFlushAt !== 0 && now - lastCounterFlushAt < COUNTER_FLUSH_EVERY_MS) return;
    counterFlushRunning = true;
    lastCounterFlushAt = now;
    const { dropped, failed } = pending;
    try {
      const ok = await insertCore("diag_server_actions", [
        {
          received_at: new Date().toISOString(),
          action: "diag_drops",
          actor: "system",
          http_status: 0,
          outcome: "gap",
          reason: `dropped=${dropped} failed=${failed}`,
          steps: { dropped, failed },
          region: process.env.VERCEL_REGION?.slice(0, 32) ?? null,
          deployment: process.env.VERCEL_DEPLOYMENT_ID?.slice(0, 64) ?? null,
        },
      ]);
      if (ok) {
        pending.dropped = Math.max(0, pending.dropped - dropped);
        pending.failed = Math.max(0, pending.failed - failed);
        if (dropped > 0) logOnce("dropped", `dropped ${dropped} log writes (too many at once)`);
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

// ─── the 45-day cleanup ───────────────────────────────────────────────
const CLEANUP_TIMEOUT_MS = 25_000;

/**
 * Runs cleanup_diagnostic_logs(45) once. The day count is fixed here, never
 * taken from a request. Used only by the protected daily cron route. A failure
 * prints one short line and is returned, never thrown.
 */
export async function runDiagCleanup(): Promise<{ ok: true; removed: number } | { ok: false; code: string }> {
  try {
    const result = await withDeadline(CLEANUP_TIMEOUT_MS, async (signal) => {
      const call = admin().rpc("cleanup_diagnostic_logs", { p_days: DIAG_RETENTION_DAYS });
      return await (typeof call.abortSignal === "function" ? call.abortSignal(signal) : call);
    });
    if (result && result.error) {
      const code = failureCode(result.error);
      logOnce(`cleanup:${code}`, `cleanup failed code=${code}`);
      return { ok: false, code };
    }
    const removed = Number(result?.data ?? 0);
    return { ok: true, removed: Number.isFinite(removed) ? removed : 0 };
  } catch (error) {
    const code = failureCode(error);
    logOnce(`cleanup:${code}`, `cleanup failed code=${code}`);
    return { ok: false, code };
  }
}

// ─── cached id lookups ────────────────────────────────────────────────
// Remembered for ten minutes. A burst of taps for one question asks the same
// thing at once, so concurrent asks share one in-flight lookup. A lookup also
// stops waiting after DIAG_WRITE_TIMEOUT_MS.
const CACHE_MAX = 500;
const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { value: string | null; at: number }>();
const inFlight = new Map<string, Promise<string | null>>();

function signalled<Q extends { abortSignal?: (signal: AbortSignal) => Q }>(query: Q, signal: AbortSignal): Q {
  return typeof query.abortSignal === "function" ? query.abortSignal(signal) : query;
}

async function cached(
  key: string,
  load: (signal: AbortSignal) => Promise<string | null>,
  /** Remember "no such row" for this long (omit to never remember a miss). */
  missTtlMs = 0,
): Promise<string | null> {
  const hit = cache.get(key);
  if (hit) {
    const ttl = hit.value === null ? missTtlMs : CACHE_TTL_MS;
    if (Date.now() - hit.at < ttl) return hit.value;
  }
  const waiting = inFlight.get(key);
  if (waiting) return waiting;
  const run = (async () => {
    let value: string | null = null;
    try {
      value = await withDeadline(DIAG_WRITE_TIMEOUT_MS, load);
    } catch {
      return null;
    }
    // A miss may be a row that doesn't exist yet, so it is only remembered
    // when the caller asked for that, and then only briefly.
    if (value !== null || missTtlMs > 0) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(key, { value, at: Date.now() });
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
    const q = await signalled(
      admin().from("questions").select("category_id").eq("id", questionId),
      signal,
    ).maybeSingle();
    const categoryId = q.data?.category_id;
    if (typeof categoryId !== "string") return null;
    const c = await signalled(
      admin().from("categories").select("game_id").eq("id", categoryId),
      signal,
    ).maybeSingle();
    return typeof c.data?.game_id === "string" ? c.data.game_id : null;
  });
  if (!gameId) return { gameId: null, nightId: null };
  return { gameId, nightId: await lookupGameNight(gameId) };
}

export function lookupGameNight(gameId: string): Promise<string | null> {
  return cached(`game-night:${gameId}`, async (signal) => {
    const g = await signalled(admin().from("games").select("night_id").eq("id", gameId), signal).maybeSingle();
    return typeof g.data?.night_id === "string" ? g.data.night_id : null;
  });
}

/**
 * room code -> night id. Room codes are unique across all nights. A code that
 * does not exist is remembered for 30 seconds, so someone sending reports for
 * made-up codes cannot make the database look each one up again and again.
 */
export function lookupRoomNight(roomCode: string): Promise<string | null> {
  return cached(
    `room-night:${roomCode}`,
    async (signal) => {
      const n = await signalled(admin().from("nights").select("id").eq("room_code", roomCode), signal).maybeSingle();
      return typeof n.data?.id === "string" ? n.data.id : null;
    },
    30_000,
  );
}

export function lookupNightOwner(nightId: string): Promise<string | null> {
  return cached(`night-host:${nightId}`, async (signal) => {
    const n = await signalled(admin().from("nights").select("host_id").eq("id", nightId), signal).maybeSingle();
    return typeof n.data?.host_id === "string" ? n.data.host_id : null;
  });
}

export function lookupPlayerId(nightId: string, deviceId: string): Promise<string | null> {
  return cached(`player:${nightId}:${deviceId}`, async (signal) => {
    const p = await signalled(
      admin().from("players").select("id").eq("night_id", nightId).eq("device_id", deviceId),
      signal,
    ).maybeSingle();
    return typeof p.data?.id === "string" ? p.data.id : null;
  });
}

/** Test hook. */
export function __clearDiagCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
