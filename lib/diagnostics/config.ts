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
//   - the DATABASE cancels a slow log write by itself: the log functions
//     (diag_insert_rows, diag_take_rows) carry a statement timeout of
//     DIAG_DB_STATEMENT_TIMEOUT_MS in the migration (a function-level setting, so
//     it applies to those functions only and to no other query), and
//     diag_insert_rows gives up on a table lock after DIAG_DB_LOCK_TIMEOUT_MS.
//     The values here must equal the migration's; a test checks that they agree;
//   - and the DATABASE limits log writes across ALL server copies: it hands out
//     only DIAG_FLEET_WRITE_SLOTS write slots (try-locks, never waited for). The
//     per-server limit below is per copy; ten copies are fifty, and PostgREST has
//     about ten connections for everything. When every slot is taken the
//     function answers "busy" at once; the caller backs off a few times (never
//     holding a connection) and then drops the write, instead of queuing for a
//     connection the game needs. "Busy" is ordinary contention, never trouble;
//   - at most DIAG_MAX_WRITES_IN_FLIGHT log jobs touch the database at once on
//     one server (a small budget, so a burst of taps at timer-end cannot take
//     the connections real answers need); the rest wait their turn in a short
//     queue of DIAG_WRITE_QUEUE_MAX jobs;
//   - a job that waited DIAG_QUEUE_WAIT_MS without getting a turn is dropped
//     (and counted), and so is any job arriving to a full queue;
//   - a job starts no database call after DIAG_JOB_DEADLINE_MS, and it keeps
//     its turn until every call it made has RETURNED. Cancelling an HTTP
//     request does not stop the statement behind it, so a call is cancelled by
//     us only at DIAG_CALL_CEILING_MS (above PostgREST's own 10 s wait for a
//     free connection plus the statement timeout), and even then the turn is
//     held DIAG_ABORT_HOLD_MS longer. So the database never sees more than
//     DIAG_MAX_WRITES_IN_FLIGHT log calls at once from one server;
//   - a lookup or a sign-in check that does not answer in DIAG_WRITE_TIMEOUT_MS
//     is called "too slow" (counted as slow, not as a stranger);
//   - when the database keeps cancelling log writes for being slow, logging
//     stops asking it for a while (the pause below): even five stalled log
//     statements at a time would keep half of PostgREST's connections busy, and
//     those are the connections real answers and the question-close calls need.
//     During a pause new log jobs are dropped and counted; after it one job
//     tries again, and a good answer ends the pause.
export const DIAG_WRITE_TIMEOUT_MS = 2_000;
export const DIAG_DB_STATEMENT_TIMEOUT_MS = 500;
export const DIAG_DB_LOCK_TIMEOUT_MS = 100;
export const DIAG_FLEET_WRITE_SLOTS = 3;
export const DIAG_CALL_CEILING_MS = 12_000;
export const DIAG_ABORT_HOLD_MS = DIAG_DB_STATEMENT_TIMEOUT_MS + 500;
/** This many log writes in a row cancelled as too slow start a pause. */
export const DIAG_PAUSE_AFTER_TIMEOUTS = 2;
/** How long a pause lasts before one log job is let through to try again. */
export const DIAG_PAUSE_MS = 10_000;
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
//   "press"   the host's button presses (server rows, with their own reserve)
// The server's own rows (taps, timer-end calls, presses) are the evidence the
// whole thing exists for, and device reports are chatty, so reports stop at
// DIAG_NIGHT_ROW_CAP, taps and timer-end calls may go on up to the higher
// DIAG_NIGHT_SERVER_ROW_CAP, and host presses have a small reserve of their
// own above THAT (DIAG_NIGHT_PRESS_ROW_CAP = the taps' cap plus the whole press
// allowance). Everything that is not a press stops at 60,000 for the night, so
// the room between 60,000 and 62,000 can only ever be used by presses: a
// night full of reports, or four times the expected taps, never blocks a late
// tap or a press (a press always gets its full 2,000).
// Rough size of a busy 40-phone night: phones 10,000 to 20,000 report rows
// (half the phones record routine events), TV(s) 2,500 each, host screens
// about 1,500 each, taps and timer calls about 5,000, presses a few hundred.
// Worst case a night stores 62,000 small rows, about 26 MB.
export const DIAG_NIGHT_ROW_CAP = 40_000;
export const DIAG_NIGHT_SERVER_ROW_CAP = 60_000;
export const DIAG_BUCKET_ROW_CAPS = {
  player: 30_000,
  tv: 8_000,
  host: 8_000,
  tap: 20_000,
  press: 2_000,
} as const;
export const DIAG_NIGHT_PRESS_ROW_CAP = DIAG_NIGHT_SERVER_ROW_CAP + DIAG_BUCKET_ROW_CAPS.press;
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
 * "Busy" answers. The row-cap check never waits for a lock, and the insert never
 * waits for a write slot: if another server holds the night's counter (or all
 * DIAG_FLEET_WRITE_SLOTS slots) at that instant, the database says "busy" at
 * once, having written nothing and holding no connection. That is ordinary
 * contention (a healthy insert holds a slot for a few milliseconds), most of all
 * at timer-end, when many server copies log in the same instant. So the caller
 * backs off (holding no connection) and asks again, up to DIAG_BUSY_RETRIES more
 * times: the wait starts at DIAG_BUSY_BACKOFF_MS, doubles each time up to
 * DIAG_BUSY_BACKOFF_MAX_MS, and each wait is a random 50-100% of that so the
 * copies do not collide again together. Then the rows are dropped and counted. A
 * "busy" answer is never counted as trouble (it does not start a pause).
 *
 * A "busy" answer is cheap for the database but NOT free: every call, busy or
 * not, is a request through the same gateway and the same few connections the
 * game's own reads use. Measured: with five retries per job and no limit, a
 * flood kept about 160 requests in flight from 40 copies (14 to 90 before) and a
 * plain game read through the API went from about 3 ms to about 70 ms; see
 * docs/diagnostics/night-timeline.md. So retries are rationed
 * ACROSS all the jobs of one server copy: a shared budget of DIAG_RETRY_BUDGET
 * retries that refills at DIAG_RETRY_REFILL_PER_SEC a second. A healthy burst
 * (a timer-end) fits inside the budget; a sustained flood runs it dry, and then
 * a job that hears "busy" gives its rows up at once instead of asking again.
 * (Host presses, which are rare, do not draw on the budget.)
 */
export const DIAG_BUSY_RETRIES = 5;
export const DIAG_BUSY_BACKOFF_MS = 20;
export const DIAG_BUSY_BACKOFF_MAX_MS = 160;
export const DIAG_RETRY_BUDGET = 40;
export const DIAG_RETRY_REFILL_PER_SEC = 5;
/**
 * If one insert heard "busy" with no retry left, the slots are saturated (a
 * stall, or a real flood). For DIAG_SLOT_BRAKE_MS the server copy's inserts are
 * rationed hard: at most ONE try every DIAG_BRAKE_PROBE_MS (a little random
 * either way), no retries, and every other job gives its rows up at once, WITHOUT
 * calling the database (counted as "slots"). A try that finds a free slot still
 * stores its rows and ends the brake. So a saturated database is asked at most
 * a few times a second by each copy, and the game's reads never queue behind
 * logging. Host presses, which are rare, ignore the brake. This is a brake on
 * calls, NOT the pause for trouble: it never counts as a failure.
 */
export const DIAG_SLOT_BRAKE_MS = 1_500;
export const DIAG_BRAKE_PROBE_MS = 250;
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
  "tz", // the screen has painted the timer reading 0 (host laptop, TV)
  "paint", // the screen has painted the answer reveal (host laptop, TV)
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
  tv: ["device", "net", "vis", "bcast", "snap", "res", "ribbon", "chan", "reach", "lt", "tz", "paint", "fps"],
  host: ["device", "net", "vis", "bcast", "snap", "res", "ribbon", "chan", "reach", "lt", "tz", "paint", "fps"],
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
 *   rel  which deployment this page was built by (Vercel's deployment id, the
 *        same value the server stamps on its own rows), so a device left open
 *        across a deploy shows up by comparison
 *   sha  the first 12 characters of the git commit of that build
 *   et   connection type as the browser rounds it: slow-2g, 2g, 3g, 4g
 *   ty   connection medium when the browser tells us: wifi, cellular, ...
 *   rtt  round-trip estimate in ms, rounded by the browser itself
 *   dl   download estimate in Mbit/s, rounded by the browser itself
 *
 * rtt and dl are kept on purpose: they are the browser's own rough read on
 * how good the connection is, which is the first thing to check when one
 * phone lags. They are rounded by the browser and cannot identify a phone.
 */
export const DIAG_DEVICE_KEYS = ["br", "os", "dc", "sc", "ol", "rm", "theme", "rel", "sha", "et", "ty", "rtt", "dl"] as const;

/** Keys a `net` event (online / offline / connection changed) may carry. */
export const DIAG_NET_KEYS = ["ev", "ol", "et", "ty", "rtt", "dl"] as const;

export const DIAG_SCREEN_CLASSES = ["s", "m", "l", "xl"] as const;
export const DIAG_DEVICE_CLASSES = ["phone", "tablet", "laptop", "tv", "unknown"] as const;
