// hostPollLoop — a read that repeats without ever piling up.
//
// setInterval fires on schedule whether or not the last read came back. On bad
// WiFi that stacks up requests behind the browser's connection limit, and they
// all release at once when the signal returns. This loop runs one read at a time,
// aborts it at 4s, and starts the next one about 2s after the last one ended.

export const HOST_POLL_GAP_MS = 2_000;
export const HOST_POLL_ABORT_MS = 4_000;
/** Each gap lands within this fraction either side of HOST_POLL_GAP_MS. */
export const HOST_POLL_SPREAD = 0.15;

export interface HostPollLoop {
  /** Read now. If a read is running, one more follows it as soon as it ends. */
  kick: () => void;
  stop: () => void;
}

export function startHostPollLoop(
  read: (signal: AbortSignal) => Promise<void>,
  rand: () => number = Math.random,
): HostPollLoop {
  let stopped = false;
  let running: AbortController | null = null;
  let readAgain = false;
  let nextRun: ReturnType<typeof setTimeout> | null = null;

  async function run() {
    if (stopped) return;
    if (running) {
      readAgain = true;
      return;
    }
    if (nextRun !== null) clearTimeout(nextRun);
    nextRun = null;

    const controller = new AbortController();
    running = controller;
    const abortTimer = setTimeout(() => controller.abort(), HOST_POLL_ABORT_MS);
    // A read that ignores its signal still can't hold the loop past the abort.
    const aborted = new Promise<void>((resolve) => {
      controller.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    try {
      await Promise.race([read(controller.signal), aborted]);
    } catch (err) {
      console.error("[host] poll read failed:", err);
    }
    clearTimeout(abortTimer);
    running = null;
    if (stopped) return;

    if (readAgain) {
      readAgain = false;
      void run();
      return;
    }
    const spread = (rand() * 2 - 1) * HOST_POLL_SPREAD;
    nextRun = setTimeout(() => void run(), HOST_POLL_GAP_MS * (1 + spread));
  }

  void run();

  return {
    kick: () => void run(),
    stop: () => {
      stopped = true;
      if (nextRun !== null) clearTimeout(nextRun);
      running?.abort();
    },
  };
}
