// A per-request stopwatch for the diagnostic log.
//
// A wrapped route handler runs inside a trace. Code anywhere underneath it
// (the sign-in check, the broadcast sender, the route itself) can drop a
// named time mark or a note on the trace with diagMark / diagNote. Outside a
// trace (logging off, or an unwrapped route) both calls do nothing, so they
// are safe to leave in shared code.
//
// Marks are milliseconds since the request arrived. First write wins unless
// you ask to overwrite, so "auth_done" keeps the first sign-in check and
// "auth_done_last" the final one.

import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

export interface DiagTrace {
  /** Wall clock when the request reached the wrapper. */
  receivedAt: Date;
  /** performance.now() at the same moment. */
  t0: number;
  /** True when this was the first request this instance served. */
  cold: boolean;
  marks: Record<string, number>;
  notes: Record<string, unknown>;
}

const store = new AsyncLocalStorage<DiagTrace>();

// ─── where this code is running ───────────────────────────────────────
// The first request an instance serves also pays for loading the code, so
// "first request" is the cold-start flag. Cheap and good enough to spot a
// pattern; the instance id lets you see how many requests one instance took.
const instanceId = Math.random().toString(36).slice(2, 8);
let firstRequestPending = true;

export function serverContext(trace: DiagTrace): {
  cold_start: boolean;
  instance_id: string;
  region: string | null;
  deployment: string | null;
} {
  return {
    cold_start: trace.cold,
    instance_id: instanceId,
    region: process.env.VERCEL_REGION?.slice(0, 32) ?? null,
    deployment: process.env.VERCEL_DEPLOYMENT_ID?.slice(0, 64) ?? null,
  };
}

export function startTrace(): DiagTrace {
  const cold = firstRequestPending;
  firstRequestPending = false;
  return { receivedAt: new Date(), t0: performance.now(), cold, marks: {}, notes: {} };
}

export function runInTrace<T>(trace: DiagTrace, fn: () => T): T {
  return store.run(trace, fn);
}

export function currentTrace(): DiagTrace | undefined {
  return store.getStore();
}

/** Milliseconds since the request arrived, rounded. */
export function elapsedMs(trace: DiagTrace): number {
  return Math.round(performance.now() - trace.t0);
}

export function diagMark(name: string, overwrite = false): void {
  const trace = store.getStore();
  if (!trace) return;
  if (!overwrite && name in trace.marks) return;
  trace.marks[name] = elapsedMs(trace);
}

export function diagNote(fields: Record<string, unknown>): void {
  const trace = store.getStore();
  if (trace) Object.assign(trace.notes, fields);
}

/** Test hook: act like a freshly started instance. */
export function __resetColdStartForTests(): void {
  firstRequestPending = true;
}
