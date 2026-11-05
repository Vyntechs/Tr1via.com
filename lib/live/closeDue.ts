// The server's backstop for a question whose timer-zero calls never landed.
// Any snapshot read by a phone or TV after the deadline plus a grace period can
// close the question, so a lost laptop or a dead zero call doesn't leave the
// room waiting. It runs only after the deadline, so it can never end one early.
// Legacy nights only. Off unless LIVE_CLOSE_MODE says otherwise.

import { broadcastFireworks, broadcastToRoom } from "@/lib/api/broadcast";
import {
  closeLateMs,
  logClose,
  logCloseShadow,
  type LiveLogSink,
  type TickCaller,
} from "@/lib/live/logClose";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";
import { questionDurationFor } from "@/lib/theme/lockInCeremony";
import type { ThemeKey } from "@/lib/theme/tokens";

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

export const CLOSE_DUE_AFTER_MS = 1_200;
const MAX_QUESTION_AGE_MS = 10 * 60_000;
const RETRY_WAIT_MS = 500;
const TICK_CAP_MS = 1_500;
const ATTEMPT_SPACING_MS = 500;
const RAISED_EXCEPTION = "P0001";

export type LiveCloseMode = "off" | "shadow" | "on";

export type CloseOutcome =
  | "off"
  | "not-overdue"
  | "too-old"
  | "stale-played-at"
  | "already-finished"
  | "lost-race"
  | "refused"
  | "shadow"
  | "closed"
  | "error";

export type TickOutcome = CloseOutcome | "throttled" | "capped";

export interface CloseRequest {
  questionId: string;
  expectedPlayedAt: string;
  roomCode: string;
  source: TickCaller;
  themeKey: ThemeKey | undefined;
}

type ResolvePayload = {
  questionId: string;
  correctIndex: number;
  refetch: true;
  serverNow: string;
};

export interface CloseDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  broadcastResolve?: (roomCode: string, payload: ResolvePayload) => Promise<void>;
  broadcastSalvo?: (roomCode: string, questionId: string) => Promise<void>;
  sink?: LiveLogSink;
}

// Both switches are read per call. Vercel applies a new value only with a new
// deployment, so they change between shows, never during one.
export function liveCloseMode(): LiveCloseMode {
  const mode = process.env.LIVE_CLOSE_MODE;
  return mode === "on" || mode === "shadow" ? mode : "off";
}

/** Unset or blank means no filter: LIVE_CLOSE_MODE alone then decides. */
export function liveCloseNightAllowed(nightId: string): boolean {
  const nights = (process.env.LIVE_CLOSE_NIGHTS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return nights.length === 0 || nights.includes(nightId);
}

export async function broadcastLegacyResolveBestEffort(
  roomCode: string,
  payload: ResolvePayload,
): Promise<void> {
  try {
    await broadcastToRoom(roomCode, "resolve", payload);
  } catch {
    // A timeout can mean Supabase accepted the broadcast but its acknowledgement
    // was lost. Do not retry and amplify one commit into two room-wide refetches;
    // durable Postgres Changes and snapshot recovery cover a truly missed signal.
    console.warn("broadcast resolve failed");
  }
}

function deadlineMs(playedAt: string, themeKey: ThemeKey | undefined): number {
  return Date.parse(playedAt) + questionDurationFor(themeKey) * 1_000;
}

function dueState(
  playedAt: string,
  themeKey: ThemeKey | undefined,
  nowMs: number,
): "due" | "not-overdue" | "too-old" {
  const playedAtMs = Date.parse(playedAt);
  if (!Number.isFinite(playedAtMs)) return "too-old";
  if (nowMs - playedAtMs >= MAX_QUESTION_AGE_MS) return "too-old";
  return nowMs >= deadlineMs(playedAt, themeKey) + CLOSE_DUE_AFTER_MS
    ? "due"
    : "not-overdue";
}

async function readDueQuestion(
  admin: AdminClient,
  request: CloseRequest,
  nowMs: number,
): Promise<{ correctIndex: number } | { stop: CloseOutcome }> {
  const { data, error } = await admin
    .from("questions")
    .select("played_at, finished_at, correct_index")
    .eq("id", request.questionId)
    .maybeSingle();
  if (error) return { stop: "error" };
  // An undo clears played_at and a fresh reveal replaces it. Either way this
  // tick was about a clock that no longer exists.
  if (
    !data?.played_at ||
    Date.parse(data.played_at) !== Date.parse(request.expectedPlayedAt)
  ) {
    return { stop: "stale-played-at" };
  }
  if (data.finished_at) return { stop: "already-finished" };
  const due = dueState(data.played_at, request.themeKey, nowMs);
  return due === "due" ? { correctIndex: data.correct_index } : { stop: due };
}

export async function closeQuestionIfDue(
  admin: AdminClient,
  request: CloseRequest,
  deps: CloseDeps = {},
): Promise<CloseOutcome> {
  const mode = liveCloseMode();
  if (mode === "off") return "off";
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  const { questionId, roomCode, source } = request;
  const lateMsAt = (atMs: number) =>
    closeLateMs(atMs, deadlineMs(request.expectedPlayedAt, request.themeKey));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_WAIT_MS);

    let due: Awaited<ReturnType<typeof readDueQuestion>>;
    try {
      due = await readDueQuestion(admin, request, now());
    } catch {
      return "error";
    }
    if ("stop" in due) return due.stop;

    if (mode === "shadow") {
      logCloseShadow({ questionId, roomCode, source, lateMs: lateMsAt(now()) }, deps.sink);
      return "shadow";
    }

    // No PGRST202 fallback, unlike /resolve: without the row-locked wrapper
    // there is no sole winner, so the safe answer is to leave it to the phones.
    let result: { data: unknown; error: { code?: string } | null };
    try {
      result = await admin.rpc("resolve_question_once", { p_question_id: questionId });
    } catch {
      result = { data: null, error: {} };
    }
    if (result.error?.code === RAISED_EXCEPTION) return "refused";
    if (result.error) continue;
    if (result.data !== true) return "lost-race";

    const closedAtMs = now();
    await (deps.broadcastResolve ?? broadcastLegacyResolveBestEffort)(roomCode, {
      questionId,
      correctIndex: due.correctIndex,
      refetch: true,
      serverNow: new Date(closedAtMs).toISOString(),
    });
    try {
      await (deps.broadcastSalvo ?? salvo)(roomCode, questionId);
    } catch {
      console.warn("broadcast fireworks(salvo) failed");
    }
    logClose({ questionId, roomCode, closedBy: source, lateMs: lateMsAt(closedAtMs) }, deps.sink);
    return "closed";
  }
  return "error";
}

function salvo(roomCode: string, questionId: string): Promise<void> {
  return broadcastFireworks(roomCode, "salvo", questionId);
}

// Per instance on purpose: 50 phones polling one instance should cost one read,
// and the row lock already picks one winner across instances.
const lastAttemptAt = new Map<string, number>();

function claimAttempt(questionId: string, nowMs: number): boolean {
  const last = lastAttemptAt.get(questionId);
  if (last !== undefined && nowMs - last < ATTEMPT_SPACING_MS) return false;
  for (const [id, at] of lastAttemptAt) {
    if (nowMs - at >= ATTEMPT_SPACING_MS) lastAttemptAt.delete(id);
  }
  lastAttemptAt.set(questionId, nowMs);
  return true;
}

/**
 * One snapshot's chance to close. Awaited inline, because whether after() work
 * finishes when the reply can't be delivered is unverified. The cap bounds how
 * long a snapshot reply can wait; the close itself carries on past it.
 */
export async function tickCloseIfDue(
  admin: AdminClient,
  tick: CloseRequest & { nightId: string },
  deps: CloseDeps = {},
): Promise<TickOutcome> {
  if (liveCloseMode() === "off" || !liveCloseNightAllowed(tick.nightId)) return "off";
  const nowMs = (deps.now ?? Date.now)();
  const due = dueState(tick.expectedPlayedAt, tick.themeKey, nowMs);
  if (due !== "due") return due;
  if (!claimAttempt(tick.questionId, nowMs)) return "throttled";

  let cap: ReturnType<typeof setTimeout> | undefined;
  const capped = new Promise<"capped">((done) => {
    cap = setTimeout(() => done("capped"), TICK_CAP_MS);
  });
  const closing = closeQuestionIfDue(admin, tick, deps).catch(() => "error" as const);
  try {
    return await Promise.race([closing, capped]);
  } finally {
    clearTimeout(cap);
  }
}
