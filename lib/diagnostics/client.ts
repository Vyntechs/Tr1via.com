// The device-side doorway to diagnostic logging.
//
// Game code (the answer hook, the realtime hooks, the connection hooks) calls
// the small functions here. Until the reporter is started they do nothing at
// all: no listeners, no timers, no memory. The reporter (reporter.ts) is only
// loaded and started when the server renders <DiagnosticsMount /> (which it
// does only when DIAGNOSTIC_LOGGING is on).
//
// Every function is wrapped so that a problem in logging can never throw into
// the game code that called it.

import type { DiagDeviceKind } from "./config";

export type DiagData = Record<string, string | number | boolean | null | undefined>;

export interface DiagSink {
  event(kind: DiagDeviceKind, data: DiagData | undefined, forced: boolean): void;
  /** A player question is on screen (true) or has closed (false). */
  questionOpen(open: boolean): void;
  /** The first room download has finished, so what is on screen is known. */
  roomReady(): void;
}

let sink: DiagSink | null = null;
// Whether a question is live on this device RIGHT NOW. Kept here, with or
// without a reporter, because the reporter is loaded a moment after the page
// (a dynamic import): a phone that opens or reloads in the middle of a
// question would otherwise never be told the question was already open.
let questionOpenNow = false;
// Whether the first room download of this page load has finished. Remembered
// here for the same reason: the reporter may start after the room has loaded.
let roomReadyNow = false;
// The signed pass the server gave the venue TV page (see tvPass.ts). Only the
// TV page sets it; the reporter attaches it to every TV report.
let tvPass: string | null = null;

export function setDiagSink(next: DiagSink | null): void {
  sink = next;
  if (next && questionOpenNow) {
    try {
      next.questionOpen(true);
    } catch {
      // never reaches the caller
    }
  }
  if (next && roomReadyNow) {
    try {
      next.roomReady();
    } catch {
      // never reaches the caller
    }
  }
}

/** The room has downloaded for the first time (or failed for good). The reporter sends nothing before this. */
export function diagRoomReady(): void {
  if (roomReadyNow) return;
  roomReadyNow = true;
  if (!sink) return;
  try {
    sink.roomReady();
  } catch {
    // never reaches the caller
  }
}

export function setDiagTvPass(pass: string | null): void {
  tvPass = pass;
}

export function getDiagTvPass(): string | null {
  return tvPass;
}

/** True once the reporter is running. */
export function diagActive(): boolean {
  return sink !== null;
}

/** `forced` events (slow or failed) are always kept; others are sampled. */
export function diagEvent(kind: DiagDeviceKind, data?: DiagData, forced = false): void {
  if (!sink) return;
  try {
    sink.event(kind, data, forced);
  } catch {
    // never reaches the caller
  }
}

/**
 * A question is live on this device (true) or is not (false). The reporter
 * sends nothing while it is true and sends what it held once it turns false.
 * Works before the reporter has started: the value is remembered.
 */
export function diagQuestionOpen(open: boolean): void {
  if (questionOpenNow === open) return;
  questionOpenNow = open;
  if (!sink) return;
  try {
    sink.questionOpen(open);
  } catch {
    // never reaches the caller
  }
}

// ─── helpers for the call sites ───────────────────────────────────────
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** "/api/games/<uuid>/advance?x=1" -> "/api/games/:id/advance". */
export function pathTemplate(url: string): string {
  let path = url;
  try {
    path = new URL(url, "http://local").pathname;
  } catch {
    path = url.split(/[?#]/)[0] ?? url;
  }
  return path
    .replace(UUID_RE, ":id")
    .replace(/\/(room|tv)\/[^/]+/, "/$1/:code")
    .slice(0, 80);
}

let snapCounter = 0;

/**
 * A room re-download (snapshot fetch). Slow, retried or failed ones are always
 * kept (forced); quick ones are thinned to about 1 in 8 so a 4-second TV poll
 * doesn't flood the log.
 */
export function diagSnap(
  url: string,
  ms: number,
  ok: boolean,
  attempts: number,
  error?: string,
): void {
  if (!sink) return;
  const forced = !ok || ms > 5000 || attempts > 1;
  if (!forced && ms <= 1000 && ++snapCounter % 8 !== 0) return;
  const template = pathTemplate(url);
  diagEvent(
    "snap",
    {
      w: template.startsWith("/api/tv/") ? "tv" : template.startsWith("/api/room/") ? "room" : template,
      ms: Math.round(ms),
      ok,
      n: attempts,
      err: error,
    },
    forced,
  );
}

/** A game-change broadcast reached this device. */
const HEARD_EVENTS = new Set([
  "reveal",
  "undo",
  "resolve",
  "advance",
  "end-early",
  "game-started",
  "game-ended",
  "live-room-event",
]);

export function diagBroadcastHeard(message: { event?: unknown; payload?: unknown }): void {
  if (!sink) return;
  try {
    const event = typeof message.event === "string" ? message.event : "";
    if (!HEARD_EVENTS.has(event)) return;
    const payload = (message.payload ?? {}) as Record<string, unknown>;
    // Every confirmed answer emits answer_progress; the phones skip it too.
    if (event === "live-room-event" && payload.kind === "answer_progress") return;
    const serverNow = typeof payload.serverNow === "string" ? Date.parse(payload.serverNow) : NaN;
    const lag = Number.isFinite(serverNow) ? Date.now() - serverNow : undefined;
    diagEvent(
      "bcast",
      {
        ev: event === "live-room-event" && typeof payload.kind === "string" ? payload.kind : event,
        srv: Number.isFinite(serverNow) ? serverNow : undefined,
        lag,
      },
      // Heard more than 2 s after the server sent it (or a clock far off).
      lag !== undefined && Math.abs(lag) > 2000,
    );
  } catch {
    // ignore
  }
}

// ─── "this screen really drew it" (timer at zero, the reveal) ─────────
// The host laptop and the venue TV draw the same state machine. When it commits
// the frame that shows the timer at 0, or the answer reveal, the screen says so
// once the browser has actually PAINTED it: two animation frames after the
// commit (the first runs before the paint, the second after it). A hidden tab
// never runs animation frames, so nothing is claimed for a frame nobody could
// see. The event is held in memory like every other and sent after the question
// closes, with the device's own clock (the server moves it onto its own).
const drawnSeen = new Set<string>();
const DRAWN_SEEN_MAX = 200;

/**
 * `tz` = the timer reading 0 was drawn for question `questionId`; `paint` = the
 * answer reveal was drawn for it. At most once per kind and question (a remount
 * during the reveal hold does not repeat it). Returns a function that cancels a
 * draw that has not happened yet (the effect is cleaned up). Does nothing, and
 * schedules nothing, while the reporter is not running.
 */
export function diagDrawn(kind: "tz" | "paint", questionId: string): () => void {
  if (!sink || typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return () => {};
  const key = `${kind}:${questionId}`;
  if (drawnSeen.has(key)) return () => {};
  try {
    if (document.visibilityState === "hidden") return () => {};
    let first = 0;
    let second = 0;
    first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => {
        try {
          // Hidden in the meantime, or already reported by another instance: say nothing.
          if (document.visibilityState === "hidden" || drawnSeen.has(key)) return;
          if (drawnSeen.size >= DRAWN_SEEN_MAX) drawnSeen.clear();
          drawnSeen.add(key);
          diagEvent(kind, { q: questionId }, true);
        } catch {
          // never reaches the caller
        }
      });
    });
    return () => {
      try {
        window.cancelAnimationFrame(first);
        window.cancelAnimationFrame(second);
      } catch {
        // ignore
      }
    };
  } catch {
    return () => {};
  }
}

let lastRibbon: string | undefined;

/** The connection ribbon / hotspot screen changed state. First call is the baseline. */
export function diagRibbon(
  status: string,
  context: { channel?: string; reach?: string; backup?: boolean; online?: boolean },
): void {
  if (!sink) return;
  const from = lastRibbon;
  if (from === status) return;
  lastRibbon = status;
  // The first look is only a baseline, unless the room already starts in trouble.
  if (from === undefined && status === "online") return;
  diagEvent(
    "ribbon",
    {
      from: from ?? "start",
      to: status,
      chan: context.channel,
      reach: context.reach,
      bk: context.backup,
      ol: context.online,
    },
    true,
  );
}

/** Test hook. */
export function __resetDiagClientForTests(): void {
  sink = null;
  questionOpenNow = false;
  roomReadyNow = false;
  tvPass = null;
  snapCounter = 0;
  lastRibbon = undefined;
  drawnSeen.clear();
}
