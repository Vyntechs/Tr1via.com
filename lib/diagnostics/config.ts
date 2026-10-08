// Diagnostic logging: the one switch and the shared limits.
//
// Off unless the DIAGNOSTIC_LOGGING env var is exactly "on" (any case).
// Unset, "off", or anything else = off, and every wrapper goes straight to
// the original code. The server reads the value on every request (not once at
// start-up), but Vercel hands a running deployment the settings it was built
// with, so changing the value in Vercel only takes effect on a NEW deployment.
// That is why it cannot be flipped in the middle of a show.

export function diagnosticsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.DIAGNOSTIC_LOGGING?.trim().toLowerCase() === "on";
}

/** Rows older than this are removed by cleanup_diagnostic_logs(). */
export const DIAG_RETENTION_DAYS = 45;

// The daily cleanup deletes in small batches (each batch is its own database
// transaction, so progress is kept even if a run is cut short), up to a cap
// per run. A run that hits the cap says so and the next day's run continues.
export const DIAG_CLEANUP_BATCH_ROWS = 5_000;
export const DIAG_CLEANUP_MAX_BATCHES = 20;
export const DIAG_CLEANUP_BUDGET_MS = 20_000;

// Device report limits (also enforced by the intake route).
export const DIAG_MAX_BODY_BYTES = 24_000;
export const DIAG_MAX_EVENTS_PER_BATCH = 60;

// Database write limits (lib/diagnostics/write.ts). Logging must never compete
// with real answers for the database, so:
//   - a log write that takes longer than DIAG_WRITE_TIMEOUT_MS is given up on;
//   - at most DIAG_MAX_WRITES_IN_FLIGHT log jobs touch the database at once on
//     one server (a small budget, so a burst of taps at timer-end cannot take
//     the connections real answers need); the rest wait their turn in a short
//     queue of DIAG_WRITE_QUEUE_MAX jobs;
//   - a job that waited DIAG_QUEUE_WAIT_MS without getting a turn is dropped
//     (and counted), and so is any job arriving to a full queue;
//   - one job stops at DIAG_JOB_DEADLINE_MS: inside a job no database call may
//     start after that, and none may run past it (deadline.ts), and the job
//     keeps its turn until it has really stopped, so the database never sees
//     more than DIAG_MAX_WRITES_IN_FLIGHT log calls at once.
export const DIAG_WRITE_TIMEOUT_MS = 2_000;
export const DIAG_MAX_WRITES_IN_FLIGHT = 5;
export const DIAG_WRITE_QUEUE_MAX = 200;
export const DIAG_QUEUE_WAIT_MS = 8_000;
export const DIAG_JOB_DEADLINE_MS = 5_000;

// Row caps. A night is capped as a whole, and each KIND of source is capped
// inside it, so one noisy kind cannot use up the others' room. Both live in the
// database (table diag_quota, function diag_take_rows), so they hold across every
// server instance:
//   "phones"  every player phone's reports together
//   "tv"      the venue TV(s) of the night, reports
//   "host"    the host laptop / phone, reports
//   "taps"    every player phone's taps and timer-end calls together (server rows)
//   "press"   the host's button presses (server rows)
// The server's own rows (taps, timer-end calls, presses) are the evidence the
// whole thing exists for, and device reports are chatty, so reports stop at
// DIAG_NIGHT_ROW_CAP and the server's rows may go on up to the higher
// DIAG_NIGHT_SERVER_ROW_CAP: a night full of reports never blocks a late tap.
// Rough size of a busy 40-phone night: phones 10,000 to 20,000 report rows
// (half the phones record routine events), TV(s) 2,500 each, host screens
// about 1,500 each, taps and timer calls about 5,000, presses a few hundred.
// Worst case a night stores 60,000 small rows, about 25 MB.
export const DIAG_NIGHT_ROW_CAP = 40_000;
export const DIAG_NIGHT_SERVER_ROW_CAP = 60_000;
export const DIAG_BUCKET_ROW_CAPS = {
  player: 30_000,
  tv: 8_000,
  host: 8_000,
  tap: 20_000,
  press: 2_000,
} as const;
/**
 * One phone's share, kept in each server's memory (NOT in the database): a
 * single phone cannot use up its whole kind's room. It is deliberately not a
 * database row per phone: that would be one extra database call per phone the
 * first time each is seen (60 at once at the first timer-end), all queuing on the
 * night's counter. A verified phone that floods can therefore get at most this
 * much per server, and the kind and night caps above still hold for everyone.
 */
export const DIAG_DEVICE_ROW_CAPS = { player: 2_500, tap: 1_500 } as const;
/**
 * Rows a server instance asks the database for at a time. The high-volume
 * kinds ask in big blocks, so a timer-end burst of ~120 rows is one call per
 * server, not one per row (or per phone).
 */
export const DIAG_QUOTA_LEASE_ROWS = { player: 100, tap: 100, tv: 25, host: 25, press: 25 } as const;
/**
 * The row-cap check never waits for a lock: if another server is updating the
 * same night's counter at that instant, the database answers "busy" at once.
 * The caller backs off for a moment (with no database connection held) and asks
 * again, up to this many times, then drops the rows and counts them.
 */
export const DIAG_QUOTA_BUSY_RETRIES = 2;
export const DIAG_QUOTA_BUSY_BACKOFF_MS = 25;
/** A source found to be full is not asked about again for this long. */
export const DIAG_QUOTA_FULL_MEMORY_MS = 60_000;

// The venue TV has no login, so the server hands the TV page a signed pass
// when the page loads. It names one night and stops working after this long.
export const DIAG_TV_PASS_TTL_MS = 8 * 60 * 60_000;

/** Event types a device may report. Anything else is dropped. */
export const DIAG_DEVICE_KINDS = [
  "device", // once per page load: what the device is
  "net", // online / offline / connection type changed
  "vis", // tab hidden / shown
  "bcast", // a game-change broadcast was heard
  "snap", // a room re-download (snapshot fetch)
  "res", // another API call that was slow or failed
  "ribbon", // the connection ribbon / "switch to a hotspot" state changed
  "chan", // the realtime channel status changed
  "reach", // the server-reachable signal changed
  "tap", // an answer tap, as the phone saw it
  "tapx", // a tap the phone ignored (question already closed)
  "lt", // main-thread stalls in the last window
  "fps", // TV scene frame rate
] as const;
export type DiagDeviceKind = (typeof DIAG_DEVICE_KINDS)[number];

export const DIAG_SURFACES = ["player", "tv", "host"] as const;
export type DiagSurface = (typeof DIAG_SURFACES)[number];

/**
 * Which kinds each screen may report. A kind a screen never produces is
 * refused (taps only come from phones, frame rates only from the TV and the
 * host laptop), so a crafted report cannot pose as something it is not.
 */
export const DIAG_SURFACE_KINDS: Record<DiagSurface, readonly DiagDeviceKind[]> = {
  player: ["device", "net", "vis", "bcast", "snap", "res", "ribbon", "chan", "reach", "tap", "tapx", "lt"],
  tv: ["device", "net", "vis", "bcast", "snap", "res", "ribbon", "chan", "reach", "lt", "fps"],
  host: ["device", "net", "vis", "bcast", "snap", "res", "ribbon", "chan", "reach", "lt", "fps"],
};

/**
 * Exactly what is stored about a device, by event kind. The server rebuilds
 * these two kinds from this list, so a crafted request or an old cached page
 * cannot get anything else into the table (no exact screen size, no memory or
 * CPU-core numbers, no raw user-agent text).
 *
 *   br   browser family + major version, from the request ("Safari 17")
 *   os   operating-system family only ("iOS", "Android", "macOS")
 *   dc   device class: phone, tablet, laptop or tv (unknown if no browser text)
 *   sc   coarse screen class from the window width: s, m, l, xl
 *   ol   the browser said it was online
 *   rm   "reduce motion" is on (the October scene draws less, so frame
 *        rates are not comparable with a phone that has it off)
 *   theme the night's theme key (which scene was drawing)
 *   et   connection type as the browser rounds it: slow-2g, 2g, 3g, 4g
 *   ty   connection medium when the browser tells us: wifi, cellular, ...
 *   rtt  round-trip estimate in ms, rounded by the browser itself
 *   dl   download estimate in Mbit/s, rounded by the browser itself
 *
 * rtt and dl are kept on purpose: they are the browser's own rough read on
 * how good the connection is, which is the first thing to check when one
 * phone lags. They are rounded by the browser and cannot identify a phone.
 */
export const DIAG_DEVICE_KEYS = ["br", "os", "dc", "sc", "ol", "rm", "theme", "et", "ty", "rtt", "dl"] as const;

/** Keys a `net` event (online / offline / connection changed) may carry. */
export const DIAG_NET_KEYS = ["ev", "ol", "et", "ty", "rtt", "dl"] as const;

export const DIAG_SCREEN_CLASSES = ["s", "m", "l", "xl"] as const;
export const DIAG_DEVICE_CLASSES = ["phone", "tablet", "laptop", "tv", "unknown"] as const;
