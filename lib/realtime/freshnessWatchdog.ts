// lib/realtime/freshnessWatchdog.ts
// Pure decision logic for the realtime freshness watchdog (the 4th defense
// layer in useRoom). No React, no I/O — just "given these timings, should we
// rebuild the connection?" so it can be unit-tested in isolation.
//
// Two independent signals:
//   - stale:  channels claim SUBSCRIBED but no realtime message has arrived
//             for STALE_MS. Catches a zombie socket with no detectable sleep.
//   - slept:  a watchdog tick fired far later than its interval WHILE the tab
//             is in the foreground => the machine slept with the tab in front
//             (the exact case visibilitychange/online never fire for).

/** Watchdog tick cadence. */
export const WATCHDOG_INTERVAL_MS = 1_000;
/** Silence backstop. Above the longest legitimate between-question pause seen
 *  in show data (64s in Game 1) so a normal lull never triggers recovery. */
export const STALE_MS = 90_000;
/** A tick this much later than WATCHDOG_INTERVAL_MS means the machine slept. */
export const SLEEP_GAP_MS = 5_000;
/** Minimum time between two hard reconnects, so a rebuild can't loop. */
export const HARD_RECONNECT_COOLDOWN_MS = 10_000;

export interface FreshnessInput {
  /** Epoch ms "now". */
  now: number;
  /** Epoch ms of the last RECEIVED realtime event (broadcast or db change). */
  lastMessageAt: number;
  /** Epoch ms of the previous watchdog tick. */
  lastTickAt: number;
  /** True if our channels currently report SUBSCRIBED. */
  subscribed: boolean;
  /** True if document.visibilityState === "visible". */
  visible: boolean;
  /** Override for tests. Defaults to STALE_MS. */
  staleMs?: number;
  /** Override for tests. Defaults to SLEEP_GAP_MS. */
  sleepGapMs?: number;
}

export interface FreshnessVerdict {
  stale: boolean;
  slept: boolean;
  shouldRecover: boolean;
}

export function evaluateFreshness(input: FreshnessInput): FreshnessVerdict {
  const staleMs = input.staleMs ?? STALE_MS;
  const sleepGapMs = input.sleepGapMs ?? SLEEP_GAP_MS;
  const slept = input.visible && input.now - input.lastTickAt > sleepGapMs;
  const stale = input.subscribed && input.now - input.lastMessageAt > staleMs;
  return { stale, slept, shouldRecover: stale || slept };
}
