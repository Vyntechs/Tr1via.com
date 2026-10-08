// Getting diagnostic rows into the database without ever getting in the way.
//
//   scheduleDiagWrite(task)   runs the task AFTER the response has gone out
//                             (Next's after(), which Vercel keeps the
//                             function alive for). Every failure is
//                             swallowed: logging can never break or slow a
//                             request.
//   insertDiagRows(table, r)  one insert with the service-role client.
//   lookup*                   small cached id lookups used to fill in the
//                             night / player on rows whose handler returned
//                             before it knew them (a late tap is turned away
//                             before the player is even looked up).
//
// Server only. Tables are not in the generated types yet, so the client is
// cast to a narrow shape (same pattern as lib/api/gameDelivery.ts).

import "server-only";

import { after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

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

/** Never throws. */
export function scheduleDiagWrite(task: () => Promise<void>): void {
  try {
    scheduler(task);
  } catch {
    // A broken scheduler must not reach the caller.
  }
}

interface LooseResult<T> {
  data?: T | null;
  error?: unknown;
}
interface LooseQuery<T> extends PromiseLike<LooseResult<T>> {
  select(columns: string): LooseQuery<T>;
  eq(column: string, value: string): LooseQuery<T>;
  maybeSingle(): PromiseLike<LooseResult<T>>;
}
interface LooseAdmin {
  from(table: string): LooseQuery<Record<string, unknown>> & {
    insert(rows: Record<string, unknown> | Record<string, unknown>[]): PromiseLike<LooseResult<unknown>>;
  };
}

function admin(): LooseAdmin {
  return getSupabaseAdmin() as unknown as LooseAdmin;
}

/** One insert. Errors (including a missing table) are ignored. */
export async function insertDiagRows(
  table: DiagTable,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;
  try {
    await admin().from(table).insert(rows);
  } catch {
    // ignore
  }
}

// ─── cached id lookups ────────────────────────────────────────────────
// Remembered for ten minutes. A burst of taps for one question asks the same
// thing at once, so concurrent asks share one in-flight lookup.
const CACHE_MAX = 500;
const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { value: string | null; at: number }>();
const inFlight = new Map<string, Promise<string | null>>();

async function cached(
  key: string,
  load: () => Promise<string | null>,
): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const run = (async () => {
    let value: string | null = null;
    try {
      value = await load();
    } catch {
      return null;
    }
    // Only remember answers; a miss may be a row that doesn't exist yet.
    if (value !== null) {
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
  const gameId = await cached(`q-game:${questionId}`, async () => {
    const q = await admin()
      .from("questions")
      .select("category_id")
      .eq("id", questionId)
      .maybeSingle();
    const categoryId = q.data?.category_id;
    if (typeof categoryId !== "string") return null;
    const c = await admin()
      .from("categories")
      .select("game_id")
      .eq("id", categoryId)
      .maybeSingle();
    return typeof c.data?.game_id === "string" ? c.data.game_id : null;
  });
  if (!gameId) return { gameId: null, nightId: null };
  return { gameId, nightId: await lookupGameNight(gameId) };
}

export function lookupGameNight(gameId: string): Promise<string | null> {
  return cached(`game-night:${gameId}`, async () => {
    const g = await admin().from("games").select("night_id").eq("id", gameId).maybeSingle();
    return typeof g.data?.night_id === "string" ? g.data.night_id : null;
  });
}

export function lookupRoomNight(roomCode: string): Promise<string | null> {
  return cached(`room-night:${roomCode}`, async () => {
    const n = await admin().from("nights").select("id").eq("room_code", roomCode).maybeSingle();
    return typeof n.data?.id === "string" ? n.data.id : null;
  });
}

export function lookupNightOwner(nightId: string): Promise<string | null> {
  return cached(`night-host:${nightId}`, async () => {
    const n = await admin().from("nights").select("host_id").eq("id", nightId).maybeSingle();
    return typeof n.data?.host_id === "string" ? n.data.host_id : null;
  });
}

export function lookupPlayerId(nightId: string, deviceId: string): Promise<string | null> {
  return cached(`player:${nightId}:${deviceId}`, async () => {
    const p = await admin()
      .from("players")
      .select("id")
      .eq("night_id", nightId)
      .eq("device_id", deviceId)
      .maybeSingle();
    return typeof p.data?.id === "string" ? p.data.id : null;
  });
}

/** Test hook. */
export function __clearDiagCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
