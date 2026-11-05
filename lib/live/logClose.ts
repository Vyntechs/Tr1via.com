// One log line per question close, so a post-show query can say who closed each
// question and how far from the deadline. Written only by the caller that really
// closed it, after its broadcast. The late-refusal line sits beside it so the
// same query can count answers the deadline really turned away. Neither throws:
// by then the request has its result, and a log line must not change it.
//
// No "server-only" here: the phone and TV import CLOSE_CALLER_HEADER from this
// file. Everything else is plain code with no secrets.

export const CLOSE_CALLER_HEADER = "x-tr1via-close-caller";

export type TimerCaller = "phone" | "tv";
export type TickCaller = "snapshot-tick" | "tv-tick";
export type ClosedBy = TimerCaller | TickCaller | "host" | "host-auto" | "unknown";

export interface CloseEvent {
  kind: "close";
  questionId: string;
  roomCode: string;
  closedBy: ClosedBy;
  /** Close time minus the due time. Negative is early; null is not known. */
  lateMs: number | null;
}

export interface LateRefusalEvent {
  kind: "late_refusal";
  questionId: string;
  /** How far past the deadline or the close. Null is not known. */
  lateMs: number | null;
}

/** LIVE_CLOSE_MODE=shadow: this tick would have closed the question, and didn't. */
export interface CloseShadowEvent {
  kind: "close_shadow";
  questionId: string;
  roomCode: string;
  source: TickCaller;
  lateMs: number | null;
}

export type LiveLogSink = (line: string) => void;

const liveServerLogSink: LiveLogSink = (line) => {
  console.info(line);
};

function writeLine(
  event: CloseEvent | CloseShadowEvent | LateRefusalEvent,
  sink: LiveLogSink,
) {
  try {
    sink(JSON.stringify(event));
  } catch {
    // See the top of this file.
  }
}

/** /resolve is anonymous, so only known values reach the log. */
export function closeCallerFrom(req: Request): ClosedBy {
  const caller = req.headers.get(CLOSE_CALLER_HEADER);
  return caller === "phone" || caller === "tv" ? caller : "unknown";
}

export function closeLateMs(
  closedAtMs: number,
  dueAtMs: number | null,
): number | null {
  if (dueAtMs === null || !Number.isFinite(dueAtMs)) return null;
  return closedAtMs - dueAtMs;
}

export function logClose(
  close: Omit<CloseEvent, "kind">,
  sink: LiveLogSink = liveServerLogSink,
): void {
  writeLine({ kind: "close", ...close }, sink);
}

export function logCloseShadow(
  shadow: Omit<CloseShadowEvent, "kind">,
  sink: LiveLogSink = liveServerLogSink,
): void {
  writeLine({ kind: "close_shadow", ...shadow }, sink);
}

export function logLateRefusal(
  refusal: Omit<LateRefusalEvent, "kind">,
  sink: LiveLogSink = liveServerLogSink,
): void {
  writeLine({ kind: "late_refusal", ...refusal }, sink);
}
