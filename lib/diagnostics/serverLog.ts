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

import "server-only";

import {
  classifyActionResponse,
  classifyAnswerResponse,
  readBodyHint,
  type ResponseBodyHint,
} from "./classify";
import { diagnosticsEnabled } from "./config";
import { elapsedMs, runInTrace, serverContext, startTrace, type DiagTrace } from "./trace";
import {
  insertDiagRows,
  lookupGameNight,
  lookupPlayerId,
  lookupQuestionContext,
  lookupRoomNight,
  scheduleDiagWrite,
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
  const n = trace.notes;

  scheduleDiagWrite(async () => {
    const hint: ResponseBodyHint | null = await readBodyHint(bodyCopy);
    const verdict = err
      ? { outcome: "error" as const, reason: "exception" }
      : classifyAnswerResponse(status, hint, "insert" in trace.marks);

    let nightId = uid(n.nightId);
    let gameId = uid(n.gameId);
    const questionId = uid(n.questionId);
    const deviceId = uid(n.deviceId);
    let playerId = uid(n.playerId);
    if (questionId && (!nightId || !gameId)) {
      const found = await lookupQuestionContext(questionId);
      nightId = nightId ?? found.nightId;
      gameId = gameId ?? found.gameId;
    }
    if (!playerId && nightId && deviceId) {
      playerId = await lookupPlayerId(nightId, deviceId);
    }

    const playedAt = iso(n.questionPlayedAt);
    const receivedMs = trace.receivedAt.getTime();
    await insertDiagRows("diag_answer_events", [
      {
        received_at: trace.receivedAt.toISOString(),
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
    ]);
  });
}

// ─── host controls and timer-end resolves ─────────────────────────────
export type ActionIdKind = "game" | "question" | "night" | "room";

export interface ActionLogOptions {
  /** host = a signed-in host pressed it; timer = a phone/TV asked at clock zero. */
  actor?: "host" | "timer" | "system";
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

function finishAction(
  action: string,
  options: ActionLogOptions,
  trace: DiagTrace,
  args: unknown[],
  res: Response | null,
  err: unknown,
): void {
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
  const n = trace.notes;
  const m = trace.marks;
  // The route params are a promise the route already awaited.
  const paramsPromise = routeParams(args);

  scheduleDiagWrite(async () => {
    const hint = await readBodyHint(bodyCopy);
    const verdict = err
      ? { outcome: "error", reason: "exception" }
      : classifyActionResponse(status, hint);

    const params = await paramsPromise;
    const id = str(params.id) ?? str(params.code);
    let nightId = uid(n.nightId);
    let gameId = uid(n.gameId);
    let questionId = uid(n.questionId);
    if (id) {
      if (options.idKind === "game") gameId = gameId ?? uid(id);
      if (options.idKind === "question") questionId = questionId ?? uid(id);
      if (options.idKind === "night") nightId = nightId ?? uid(id);
      if (options.idKind === "room") nightId = nightId ?? (await lookupRoomNight(id));
    }
    if (!nightId && gameId) nightId = await lookupGameNight(gameId);
    if (!nightId && questionId) {
      const found = await lookupQuestionContext(questionId);
      nightId = found.nightId;
      gameId = gameId ?? found.gameId;
    }

    const auth = m.auth_done_last ?? m.auth_done ?? null;
    await insertDiagRows("diag_server_actions", [
      {
        received_at: trace.receivedAt.toISOString(),
        action,
        actor: options.actor ?? "host",
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
    ]);
  });
}
