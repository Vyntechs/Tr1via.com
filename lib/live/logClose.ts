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
/** The server's own closers: the reveal's alarm, and the two snapshot ticks. */
export type CloseSource = "alarm" | "room-tick" | "tv-tick";
export type ClosedBy = TimerCaller | CloseSource | "host" | "host-auto" | "unknown";

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

export interface WouldCloseEvent {
  kind: "would_close";
  questionId: string;
  roomCode: string;
  source: CloseSource;
  lateMs: number | null;
}

export interface AlarmWakeEvent {
  kind: "alarm_wake";
  questionId: string;
  outcome: string;
  /** Wake time minus the time the alarm was set for. */
  lateMs: number;
}

export interface RepairEvent {
  kind: "score_repair";
  questionId: string;
  rows: number;
  /** True in shadow mode: these rows were found, not written. */
  dryRun: boolean;
}

export interface LateScoredEvent {
  kind: "late_scored";
  questionId: string;
  answerId: string;
  /** How far past finished_at the answer's locked_at sits. */
  msPastClose: number;
}

export interface PhoneStatsEvent {
  kind: "phone_stats";
  nightId: string;
  resendCount: number;
  longestReplyWaitMs: number;
  secondsAtZero: number;
}

type LiveEvent =
  | CloseEvent
  | LateRefusalEvent
  | WouldCloseEvent
  | AlarmWakeEvent
  | RepairEvent
  | LateScoredEvent
  | PhoneStatsEvent;

export type LiveLogSink = (line: string) => void;

const liveServerLogSink: LiveLogSink = (line) => {
  console.info(line);
};

function writeLine(event: LiveEvent, sink: LiveLogSink) {
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

export function logLateRefusal(
  refusal: Omit<LateRefusalEvent, "kind">,
  sink: LiveLogSink = liveServerLogSink,
): void {
  writeLine({ kind: "late_refusal", ...refusal }, sink);
}

export function logWouldClose(event: Omit<WouldCloseEvent, "kind">): void {
  writeLine({ kind: "would_close", ...event }, liveServerLogSink);
}

export function logAlarmWake(event: Omit<AlarmWakeEvent, "kind">): void {
  writeLine({ kind: "alarm_wake", ...event }, liveServerLogSink);
}

export function logRepair(event: Omit<RepairEvent, "kind">): void {
  writeLine({ kind: "score_repair", ...event }, liveServerLogSink);
}

export function logLateScored(event: Omit<LateScoredEvent, "kind">): void {
  writeLine({ kind: "late_scored", ...event }, liveServerLogSink);
}

export function logPhoneStats(event: Omit<PhoneStatsEvent, "kind">): void {
  writeLine({ kind: "phone_stats", ...event }, liveServerLogSink);
}
