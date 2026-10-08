// Server-side diagnostic logging for the answer route and the host controls.
//
//   withAnswerLog(handler)         records EVERY answer tap.
//   withActionLog(name, handler)   records a host control press (or a
//                                  timer-end resolve call).
//
// Both wrap an existing route handler and hand back a handler with the same
// signature. They never read the request body, never change the response,
// and never let a logging problem reach the caller:
//
//   - flag off (the default)  -> the original handler runs, nothing else
//   - flag on                 -> the handler runs inside a trace (see
//     trace.ts), the response is returned untouched, and the row is built and
//     written AFTER the response has gone out (lib/diagnostics/write.ts).
//   - an exception thrown by the handler is logged, then re-thrown unchanged.
//
// WHO GETS A ROW. These routes can be called by anyone, so a row is stored
// only for a caller the server has verified:
//   - an answer tap: a signed device cookie that belongs to a player of the
//     night the tap is about (late, duplicate and turned-down taps from real
//     players are stored, which is the whole point);
//   - a host press: a signed-in host who owns the night;
//   - a timer-end call (resolve / finalize): a player of that night. The venue
//     TV sends these without any login, so its calls are not stored (the TV's
//     own reports show them).
// Anything else stores NOTHING: it is only counted, and one summary line a
// minute is printed (noteIgnored in write.ts). Rows go through recordDiagRows,
// which keeps each night and each source inside a row cap kept in the database.
// These server rows have their own sources ("tap", "press") with room above the
// cap on device reports, so chatty reports can never crowd them out.
//
// The routes are wrapped with a one-line `export const POST = withActionLog(...)`
// (or withAnswerLog); with DIAGNOSTIC_LOGGING off that is the original handler.

import "server-only";

import { verifyDeviceCookie } from "@/lib/auth/device-cookie";
import { isValidRoomCode, parseRoomCode } from "@/lib/game/room-code";
import {
  classifyActionResponse,
  classifyAnswerResponse,
  readBodyHint,
  type ResponseBodyHint,
} from "./classify";
import { diagnosticsEnabled } from "./config";
import { elapsedMs, runInTrace, serverContext, startTrace, type DiagTrace } from "./trace";
import {
  lookupGameNight,
  lookupNightOwner,
  lookupPlayerId,
  lookupQuestionContext,
  lookupRoomNight,
  noteIgnored,
  recordDiagRows,
  scheduleDiagWrite,
  type DiagSource,
} from "./write";

// ─── helpers ──────────────────────────────────────────────────────────
function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An id column takes a real uuid or nothing; a junk value must not sink the row. */
function uid(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}
function int(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}
function iso(value: unknown): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** The phone's own tap timing, sent as headers so the body schema is untouched. */
export function parseTapHeaders(headers: Headers): {
  tapAt: string | null;
  sentAt: string | null;
  attempt: number | null;
} {
  const epoch = (name: string): string | null => {
    const raw = headers.get(name);
    if (!raw || !/^\d{10,14}$/.test(raw)) return null;
    const ms = Number(raw);
    // Between 2020 and 2100 is believable. A phone with a broken clock is
    // still useful, so there is no "close to now" check.
    if (ms < 1_577_836_800_000 || ms > 4_102_444_800_000) return null;
    return new Date(ms).toISOString();
  };
  const attemptRaw = headers.get("x-tr1via-attempt");
  const attempt =
    attemptRaw && /^\d{1,2}$/.test(attemptRaw) ? Number(attemptRaw) : null;
  return {
    tapAt: epoch("x-tr1via-tap-at"),
    sentAt: epoch("x-tr1via-sent-at"),
    attempt,
  };
}

/**
 * The route's own receipt time if it is a believable ms-epoch (it is taken after
 * the wrapper's stamp, never more than a few seconds later), else the wrapper's.
 */
export function routeReceiptMs(noted: unknown, wrapperMs: number): number {
  if (typeof noted !== "number" || !Number.isFinite(noted)) return wrapperMs;
  const ms = Math.round(noted);
  return ms >= wrapperMs && ms - wrapperMs <= 60_000 ? ms : wrapperMs;
}

function stepsOf(trace: DiagTrace, total: number): Record<string, number> {
  return { ...trace.marks, total };
}

/** Run `fn`, never throw. */
function quietly(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging must not change what the caller sees.
  }
}

// ─── answers ──────────────────────────────────────────────────────────
type Handler<A extends unknown[]> = (...args: A) => Promise<Response>;

export function withAnswerLog<A extends [Request, ...unknown[]]>(
  handler: Handler<A>,
): Handler<A> {
  return async (...args: A): Promise<Response> => {
    if (!diagnosticsEnabled()) return handler(...args);

    let trace: DiagTrace;
    let tapHeaders: ReturnType<typeof parseTapHeaders>;
    try {
      trace = startTrace();
      tapHeaders = parseTapHeaders(args[0].headers);
    } catch {
      return handler(...args);
    }

    let res: Response;
    try {
      res = await runInTrace(trace, () => handler(...args));
    } catch (err) {
      quietly(() => finishAnswer(trace, tapHeaders, null, err));
      throw err;
    }
    quietly(() => finishAnswer(trace, tapHeaders, res, null));
    return res;
  };
}

function finishAnswer(
  trace: DiagTrace,
  tap: ReturnType<typeof parseTapHeaders>,
  res: Response | null,
  err: unknown,
): void {
  const n = trace.notes;
  // The route notes the device id only after it verified the signed cookie. No
  // cookie, or a bad one: this is not a player, so nothing is stored.
  const deviceId = uid(n.deviceId);
  if (!deviceId) {
    noteIgnored("answer");
    return;
  }
  const total = elapsedMs(trace);
  const status = res ? res.status : 500;
  // Clone now (cheap, before the body goes out); read it after the response.
  let bodyCopy: Response | null = null;
  if (res && status !== 204) {
    try {
      bodyCopy = res.clone();
    } catch {
      bodyCopy = null;
    }
  }
  const ctx = serverContext(trace);

  scheduleDiagWrite(async () => {
    let nightId = uid(n.nightId);
    let gameId = uid(n.gameId);
    const questionId = uid(n.questionId);
    // A 404 means the route did not find the question (or its game): a made-up
    // id, which the junk check below turns away. Looking it up again would only
    // add a game-table read for it (a free device cookie could make 100 of them).
    if (questionId && (!nightId || !gameId) && status !== 404) {
      const found = await lookupQuestionContext(questionId);
      nightId = nightId ?? found.nightId;
      gameId = gameId ?? found.gameId;
    }
    // A tap about a question, game or night that does not exist is junk.
    if (!nightId) {
      noteIgnored("answer");
      return;
    }
    // The cookie is genuine, but is this device a player of THIS night?
    const playerId = uid(n.playerId) ?? (await lookupPlayerId(nightId, deviceId));
    if (!playerId) {
      noteIgnored("answer");
      return;
    }

    const hint: ResponseBodyHint | null = await readBodyHint(bodyCopy);
    const verdict = err
      ? { outcome: "error" as const, reason: "exception" }
      : classifyAnswerResponse(status, hint, "insert" in trace.marks);

    const playedAt = iso(n.questionPlayedAt);
    // The legacy route notes the exact instant its 25-second rule used (the
    // wrapper's own stamp is taken a hair earlier). Prefer it, so the row shows
    // the number the rule really compared; fall back to the wrapper's stamp. The
    // resilient engine's deadline is decided by the database clock, not this.
    const receivedMs = routeReceiptMs(n.deadlineReceivedAtMs, trace.receivedAt.getTime());
    await recordDiagRows(
      "diag_answer_events",
      [
        {
          received_at: new Date(receivedMs).toISOString(),
          engine: n.engine === "legacy" || n.engine === "resilient_v1" ? n.engine : "unknown",
          night_id: nightId,
          game_id: gameId,
          question_id: questionId,
          play_id: uid(n.playId),
          player_id: playerId,
          device_id: deviceId,
          slot_chosen: int(n.slotChosen),
          chosen_index: int(n.chosenIndex),
          client_tap_at: tap.tapAt,
          client_sent_at: tap.sentAt,
          client_attempt: tap.attempt,
          question_played_at: playedAt,
          question_finished_at: iso(n.questionFinishedAt),
          ms_after_open: playedAt ? receivedMs - new Date(playedAt).getTime() : null,
          deadline_s: int(n.deadlineS),
          outcome: verdict.outcome,
          reason: verdict.reason,
          http_status: status,
          total_ms: total,
          steps: stepsOf(trace, total),
          ...ctx,
        },
      ],
      nightId,
      { kind: "tap", deviceId },
    );
  });
}

// ─── host controls and timer-end resolves ─────────────────────────────
export type ActionIdKind = "game" | "question" | "night" | "room";

export interface ActionLogOptions {
  /**
   * host = a signed-in host pressed it (stored only when that host owns the
   * night); timer = a phone or the TV asked at clock zero (stored only when a
   * player of the night asked).
   */
  actor?: "host" | "timer";
  /** What the route's `[id]` segment is, so the night can be filled in. */
  idKind?: ActionIdKind;
}

export function withActionLog<A extends [Request, ...unknown[]]>(
  action: string,
  handler: Handler<A>,
  options: ActionLogOptions = {},
): Handler<A> {
  return async (...args: A): Promise<Response> => {
    if (!diagnosticsEnabled()) return handler(...args);

    let trace: DiagTrace;
    try {
      trace = startTrace();
    } catch {
      return handler(...args);
    }

    let res: Response;
    try {
      res = await runInTrace(trace, () => handler(...args));
    } catch (err) {
      quietly(() => finishAction(action, options, trace, args, null, err));
      throw err;
    }
    quietly(() => finishAction(action, options, trace, args, res, null));
    return res;
  };
}

async function routeParams(args: unknown[]): Promise<Record<string, string>> {
  try {
    const ctx = args[1] as { params?: Promise<Record<string, string>> } | undefined;
    return ctx?.params ? await ctx.params : {};
  } catch {
    return {};
  }
}

const DEVICE_COOKIE = "tr1via_device";

/**
 * The device id from a request's signed device cookie, or null. Checked here
 * without any network call (the cookie carries its own signature). Never throws.
 */
function verifiedDeviceFrom(req: unknown): string | null {
  try {
    const secret = process.env.SESSION_SECRET;
    const header = (req as { headers?: Headers } | undefined)?.headers?.get("cookie");
    if (!secret || !header) return null;
    for (const part of header.split(";")) {
      const eq = part.indexOf("=");
      if (eq < 0 || part.slice(0, eq).trim() !== DEVICE_COOKIE) continue;
      let value = part.slice(eq + 1).trim();
      try {
        value = decodeURIComponent(value);
      } catch {
        // use it as it is
      }
      return uid(verifyDeviceCookie(value, secret));
    }
    return null;
  } catch {
    return null;
  }
}

function finishAction(
  action: string,
  options: ActionLogOptions,
  trace: DiagTrace,
  args: unknown[],
  res: Response | null,
  err: unknown,
): void {
  const n = trace.notes;
  const actor = options.actor ?? "host";
  // Who is asking, as far as the server has verified. A host: the sign-in check
  // noted the host (lib/api/auth.ts getAuthedHost); whether that host owns the
  // night is checked below. A timer-end call: a valid signed device cookie. No
  // proof of either: nothing is stored.
  const hostId = actor === "host" ? uid(n.hostId) : null;
  const deviceId = actor === "timer" ? verifiedDeviceFrom(args[0]) : null;
  if (!hostId && !deviceId) {
    noteIgnored("action");
    return;
  }

  const total = elapsedMs(trace);
  const status = res ? res.status : 500;
  let bodyCopy: Response | null = null;
  if (res && status !== 204) {
    try {
      bodyCopy = res.clone();
    } catch {
      bodyCopy = null;
    }
  }
  const ctx = serverContext(trace);
  const m = trace.marks;
  // The route params are a promise the route already awaited.
  const paramsPromise = routeParams(args);

  scheduleDiagWrite(async () => {
    const params = await paramsPromise;
    const id = str(params.id) ?? str(params.code);
    let nightId = uid(n.nightId);
    let gameId = uid(n.gameId);
    let questionId = uid(n.questionId);
    if (id) {
      if (options.idKind === "game") gameId = gameId ?? uid(id);
      if (options.idKind === "question") questionId = questionId ?? uid(id);
      if (options.idKind === "night") nightId = nightId ?? uid(id);
      if (options.idKind === "room" && !nightId) {
        const code = parseRoomCode(id);
        if (isValidRoomCode(code)) nightId = await lookupRoomNight(code);
      }
    }
    if (!nightId && gameId) nightId = await lookupGameNight(gameId);
    if (!nightId && questionId) {
      const found = await lookupQuestionContext(questionId);
      nightId = found.nightId;
      gameId = gameId ?? found.gameId;
    }
    // Verified against the night itself: the signed-in host must own it, or the
    // cookie's device must be one of its players.
    let source: DiagSource | null = null;
    if (nightId && hostId && (await lookupNightOwner(nightId)) === hostId) source = { kind: "press" };
    else if (nightId && deviceId && (await lookupPlayerId(nightId, deviceId))) source = { kind: "tap", deviceId };
    if (!nightId || !source) {
      noteIgnored("action");
      return;
    }

    const hint = await readBodyHint(bodyCopy);
    const verdict = err
      ? { outcome: "error", reason: "exception" }
      : classifyActionResponse(status, hint);

    const auth = m.auth_done_last ?? m.auth_done ?? null;
    await recordDiagRows(
      "diag_server_actions",
      [
        {
          received_at: trace.receivedAt.toISOString(),
          action,
          actor,
          night_id: nightId,
          game_id: gameId,
          question_id: questionId,
          play_id: uid(n.playId) ?? uid(params.playId),
          http_status: status,
          outcome: verdict.outcome,
          reason: verdict.reason,
          total_ms: total,
          auth_ms: auth,
          // Everything before the broadcast is sign-in + database work.
          db_done_ms: m.db_done ?? m.broadcast_start ?? null,
          broadcast_start_ms: m.broadcast_start ?? null,
          broadcast_done_ms: m.broadcast_done ?? null,
          broadcast_ok: "broadcast_start" in m ? !n.broadcastError : null,
          broadcast_error: str(n.broadcastError),
          steps: stepsOf(trace, total),
          ...ctx,
        },
      ],
      nightId,
      source,
    );
  });
}
