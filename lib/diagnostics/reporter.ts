// The device reporter: a tiny batched flight recorder for one page load.
//
// Runs on a player's phone, the venue TV and the host laptop, but only when
// the server rendered <DiagnosticsMount /> (DIAGNOSTIC_LOGGING on). It
// collects a few small facts, holds them in memory, and sends them to
// /api/diag/report about every 10 seconds, but only BETWEEN questions (reveal,
// lobby, board) and when the page is hidden.
//
// What it will never do:
//   - change anything the person sees, or add any button
//   - send anything while a question is live on this screen, or before the
//     room has finished its first download (until then nobody knows whether a
//     question is live). Everything is held in memory (capped at MAX_QUEUE
//     events; when full the oldest ROUTINE event goes first, and slow or failed
//     ones are kept longest, also when a failed send is put back) and goes out
//     after the question closes, after a random 2-8 s wait so a whole room
//     doesn't report in the same instant. There is NO exception for a hidden
//     page: a phone locking its screen mid-question keeps its events in memory
//     and sends them once it is awake and the question has closed. (A tab
//     closed in the middle of a question loses what it was holding, on
//     purpose: quiet comes first.) A page that is hidden or closed between
//     questions hands what it holds to the browser's send-on-exit
//     (sendBeacon) so it isn't lost.
//     "Live question" comes from the room state (useRoom / useTVRoom), not
//     from this file, so a phone that has already locked its answer in still
//     counts as inside the question until the question closes.
//   - throw: every callback is wrapped, and a failed send is quietly retried
//     (routine events 3 times, slow or failed ones 10) or dropped
//   - touch theme code. The October frame-rate check reads the page from the
//     outside (the world's own data-* markers) and never calls into the theme.
//
// The venue TV also needs the signed pass its page was given (see tvPass.ts);
// without one it holds everything and sends nothing.
//
// What it records, by kind (see config.ts): device, net, vis, bcast, snap,
// res, ribbon, chan, reach, tap, tapx, lt, fps. Slow or failed events are
// always kept ("forced"); routine ones are kept for about half of player
// phones (decided once per page load) and always on the TV and host laptop.

import { DIAG_MAX_EVENTS_PER_BATCH, type DiagDeviceKind, type DiagSurface } from "./config";
import { getDiagTvPass, pathTemplate, setDiagSink, type DiagData } from "./client";

export interface ReporterOptions {
  surface: DiagSurface;
  /** Room code (phones, TV). */
  room?: string;
  /** Night id (host laptop / host phone). */
  night?: string;
  /** Test hooks. */
  sampleRate?: number;
  endpoint?: string;
}

interface QueuedEvent {
  t: number;
  k: DiagDeviceKind;
  d?: DiagData;
  f: 0 | 1;
  /** Failed sends so far. */
  r: number;
}

const ENDPOINT = "/api/diag/report";
const FLUSH_EVERY_MS = 10_000;
const MAX_QUEUE = 200;
const MAX_RETRIES = 3;
// Slow or failed events are the evidence; they get more tries.
const MAX_RETRIES_FORCED = 10;
const SAMPLE_RATE_PLAYER = 0.5;
const FRAME_CHECK_EVERY_MS = 10_000;
const FRAME_WINDOW_MS = 2_000;

// Endpoints worth a routine (sampled) record. Others only appear when slow or failed.
const ROUTINE_PATHS = [/^\/api\/answers/, /^\/api\/questions\/:id\/resolve/, /^\/api\/games\//];
// The snapshot downloads are reported with more detail by their own hooks.
const SKIP_PATHS = [/^\/api\/diag\//, /^\/api\/room\/:code\/snapshot/, /^\/api\/tv\/:code\/snapshot/];

/** Connection type and the browser's own rounded quality estimate. Nothing else. */
function connectionInfo(): DiagData | undefined {
  const c = (navigator as unknown as { connection?: Record<string, unknown> }).connection;
  if (!c) return undefined;
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  return {
    et: typeof c.effectiveType === "string" ? c.effectiveType : undefined,
    dl: num(c.downlink),
    rtt: num(c.rtt),
    ty: typeof c.type === "string" ? c.type : undefined,
  };
}

/** A coarse screen size class from the window width (the exact size is never sent). */
function screenClass(width: number): string {
  if (width < 480) return "s";
  if (width < 900) return "m";
  if (width < 1440) return "l";
  return "xl";
}

function randomId(): string {
  try {
    const bytes = new Uint8Array(9);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 14);
  } catch {
    return Math.random().toString(36).slice(2, 16).padEnd(8, "0");
  }
}

export function startDeviceReporter(options: ReporterOptions): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};

  const { surface } = options;
  const endpoint = options.endpoint ?? ENDPOINT;
  const sid = randomId();
  const sampleRate = options.sampleRate ?? SAMPLE_RATE_PLAYER;
  const sampled = surface !== "player" || Math.random() < sampleRate;

  let stopped = false;
  let queue: QueuedEvent[] = [];
  let questionIsOpen = false;
  let roomReady = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let soonTimer: ReturnType<typeof setTimeout> | null = null;
  let frameTimer: ReturnType<typeof setInterval> | null = null;
  const cleanups: Array<() => void> = [];
  const lt = { n: 0, max: 0, sum: 0, since: Date.now() };
  let frameRoutineCount = 0;

  // ─── queue ──────────────────────────────────────────────────────────
  /** Over the cap: routine events go first (oldest first); slow or failed ones are kept longest. */
  function trim(): void {
    while (queue.length > MAX_QUEUE) {
      const routine = queue.findIndex((e) => e.f === 0);
      queue.splice(routine === -1 ? 0 : routine, 1);
    }
  }

  function push(kind: DiagDeviceKind, data: DiagData | undefined, forced: boolean): void {
    if (stopped) return;
    if (!forced && !sampled) return;
    queue.push({ t: Date.now(), k: kind, d: data, f: forced ? 1 : 0, r: 0 });
    trim();
  }

  /**
   * May anything be sent right now? Not while a question is live, not before
   * the room has finished its first download, and (TV) not without the pass.
   * This is the one rule every send goes through, hidden page or not.
   */
  function canSend(): boolean {
    if (questionIsOpen || !roomReady) return false;
    if (surface === "tv" && !getDiagTvPass()) return false;
    return true;
  }

  function takeWindowStats(): void {
    if (lt.n === 0) {
      lt.since = Date.now();
      return;
    }
    push("lt", { n: lt.n, max: Math.round(lt.max), sum: Math.round(lt.sum), win: Date.now() - lt.since }, lt.max >= 250);
    lt.n = 0;
    lt.max = 0;
    lt.sum = 0;
    lt.since = Date.now();
  }

  // ─── sending ────────────────────────────────────────────────────────
  function requeue(batch: QueuedEvent[]): void {
    const keep = batch
      .filter((e) => e.r < (e.f ? MAX_RETRIES_FORCED : MAX_RETRIES))
      .map((e) => ({ ...e, r: e.r + 1 }));
    queue = [...keep, ...queue];
    trim();
  }

  function flush(viaBeacon: boolean): void {
    if (stopped && queue.length === 0) return;
    takeWindowStats();
    if (queue.length === 0) return;
    const batch = queue.slice(0, DIAG_MAX_EVENTS_PER_BATCH);
    queue = queue.slice(batch.length);
    const body = JSON.stringify({
      surface,
      room: options.room,
      night: options.night,
      tok: surface === "tv" ? (getDiagTvPass() ?? undefined) : undefined,
      sid,
      sent: Date.now(),
      ev: batch.map((e) => ({ t: e.t, k: e.k, d: e.d, f: e.f })),
    });
    try {
      if (viaBeacon && typeof navigator.sendBeacon === "function") {
        const queued = navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
        if (!queued) requeue(batch);
      } else {
        void fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          credentials: "same-origin",
          keepalive: true,
        })
          .then((res) => {
            // 5xx and 429 are worth one more try later; other answers are final.
            if (res.status >= 500 || res.status === 429) requeue(batch);
          })
          .catch(() => requeue(batch));
      }
    } catch {
      requeue(batch);
    }
    // A big backlog drains over several batches rather than one huge one.
    if (queue.length >= DIAG_MAX_EVENTS_PER_BATCH && !soonTimer) scheduleSoon(500, 1500);
  }

  function scheduleNext(): void {
    if (stopped) return;
    const delay = FLUSH_EVERY_MS * (0.7 + Math.random() * 0.6);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      try {
        // Stay quiet while a question is live (or before the room has loaded),
        // however big the backlog is: the queue is capped. No exceptions.
        if (canSend()) flush(false);
      } catch {
        // ignore
      }
      scheduleNext();
    }, delay);
  }

  /** A one-off send after a short random wait (after a question closes, after coming back online). */
  function scheduleSoon(minMs: number, maxMs: number): void {
    if (stopped || soonTimer) return;
    soonTimer = setTimeout(
      () => {
        soonTimer = null;
        try {
          if (canSend()) flush(false);
        } catch {
          // ignore
        }
      },
      minMs + Math.random() * (maxMs - minMs),
    );
  }

  // ─── the doorway used by game code ──────────────────────────────────
  setDiagSink({
    event: (kind, data, forced) => push(kind, data, forced),
    questionOpen: (open) => {
      const wasOpen = questionIsOpen;
      questionIsOpen = open;
      if (wasOpen && !open) scheduleSoon(2000, 8000);
    },
    roomReady: () => {
      roomReady = true;
    },
  });
  cleanups.push(() => setDiagSink(null));

  // ─── what is this device? (once per page load) ─────────────────────
  try {
    const media = (q: string) => typeof window.matchMedia === "function" && window.matchMedia(q).matches;
    // A short summary only (see DIAG_DEVICE_KEYS in config.ts). The browser,
    // OS and device class are added by the server from the request. The exact
    // screen size, memory and CPU-core counts are NOT collected: the long-task
    // and frame-rate events measure lag directly.
    push(
      "device",
      {
        sc: screenClass(window.innerWidth),
        ol: navigator.onLine,
        rm: media("(prefers-reduced-motion: reduce)"),
        theme: document.documentElement.getAttribute("data-theme") ?? undefined,
        ...connectionInfo(),
      },
      true,
    );
  } catch {
    // ignore
  }

  // ─── connection and visibility ─────────────────────────────────────
  const onOnline = () => {
    push("net", { ev: "online", ol: true, ...connectionInfo() }, true);
    scheduleSoon(1000, 4000);
  };
  const onOffline = () => push("net", { ev: "offline", ol: false }, true);
  const onVisibility = () => {
    const hidden = document.visibilityState === "hidden";
    push("vis", { ev: hidden ? "hidden" : "visible" }, true);
    // A locked screen mid-question sends nothing: it is held, in memory.
    if (hidden && canSend()) flush(true);
  };
  const onPageHide = () => {
    if (canSend()) flush(true);
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  cleanups.push(() => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
  });

  const conn = (navigator as unknown as { connection?: EventTarget }).connection;
  if (conn && typeof conn.addEventListener === "function") {
    const onConn = () => push("net", { ev: "conn", ...connectionInfo() }, true);
    conn.addEventListener("change", onConn);
    cleanups.push(() => conn.removeEventListener("change", onConn));
  }

  // ─── passive timing of API calls and main-thread stalls ────────────
  try {
    if (typeof PerformanceObserver === "function") {
      const origin = window.location.origin;
      const resources = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          try {
            const e = entry as PerformanceResourceTiming;
            if (e.initiatorType !== "fetch" && e.initiatorType !== "xmlhttprequest" && e.initiatorType !== "beacon") continue;
            if (!e.name.startsWith(origin + "/api/")) continue;
            const p = pathTemplate(e.name);
            if (SKIP_PATHS.some((re) => re.test(p))) continue;
            const status = (e as unknown as { responseStatus?: number }).responseStatus;
            const failed = status === 0 || (typeof status === "number" && status >= 400);
            const slow = e.duration > 5000;
            const routine = ROUTINE_PATHS.some((re) => re.test(p));
            if (!failed && !slow && !routine && e.duration < 1500) continue;
            push(
              "res",
              {
                p,
                ms: Math.round(e.duration),
                ttfb: e.responseStart > 0 && e.requestStart > 0 ? Math.round(e.responseStart - e.requestStart) : undefined,
                st: status,
              },
              failed || slow,
            );
          } catch {
            // ignore one bad entry
          }
        }
      });
      resources.observe({ type: "resource", buffered: false });
      cleanups.push(() => resources.disconnect());
    }
  } catch {
    // unsupported browser
  }
  try {
    if (typeof PerformanceObserver === "function" && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      const longTasks = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          lt.n += 1;
          lt.sum += entry.duration;
          if (entry.duration > lt.max) lt.max = entry.duration;
        }
      });
      longTasks.observe({ type: "longtask", buffered: false });
      cleanups.push(() => longTasks.disconnect());
    }
  } catch {
    // unsupported browser
  }

  // ─── TV scene frame rate (October world), measured from outside ─────
  // The world marks itself in the page (data-world-pack, data-world-tier,
  // data-world-off). We only read those markers. A 2-second burst every 10
  // seconds, and only while the world is drawing at full tier.
  if (surface === "tv" || surface === "host") {
    const measureFrames = () => {
      try {
        if (document.visibilityState !== "visible") return;
        const world = document.querySelector('[data-world-pack]:not([data-world-off="true"])');
        if (!world || !document.querySelector('[data-world-tier="full"]')) return;
        const pack = world.getAttribute("data-world-pack") ?? "world";
        const started = performance.now();
        let last = started;
        let frames = 0;
        let slow = 0;
        let worst = 0;
        const step = (now: number) => {
          if (stopped) return;
          frames += 1;
          const gap = now - last;
          last = now;
          if (frames > 1) {
            if (gap > 50) slow += 1;
            if (gap > worst) worst = gap;
          }
          if (now - started < FRAME_WINDOW_MS) {
            requestAnimationFrame(step);
            return;
          }
          const fps = Math.round(((frames - 1) / ((now - started) / 1000)) * 10) / 10;
          const bad = fps < 45 || slow >= 3 || worst > 250;
          // Healthy readings are kept about one in three.
          if (bad || ++frameRoutineCount % 3 === 0) {
            push("fps", { scene: pack, fps, slow, worst: Math.round(worst), n: frames }, bad);
          }
        };
        requestAnimationFrame(step);
      } catch {
        // ignore
      }
    };
    frameTimer = setInterval(measureFrames, FRAME_CHECK_EVERY_MS);
    cleanups.push(() => {
      if (frameTimer) clearInterval(frameTimer);
    });
  }

  scheduleNext();

  return () => {
    if (stopped) return;
    try {
      if (canSend()) flush(true);
    } catch {
      // ignore
    }
    stopped = true;
    if (flushTimer) clearTimeout(flushTimer);
    if (soonTimer) clearTimeout(soonTimer);
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {
        // ignore
      }
    }
  };
}
