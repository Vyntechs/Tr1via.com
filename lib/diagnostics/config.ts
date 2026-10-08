// Diagnostic logging: the one switch and the shared limits.
//
// Off unless the DIAGNOSTIC_LOGGING env var is exactly "on" (any case).
// Unset, "off", or anything else = off, and every wrapper goes straight to
// the original code. Changing the value on Vercel needs a redeploy, so it
// cannot be flipped in the middle of a show.

export function diagnosticsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.DIAGNOSTIC_LOGGING?.trim().toLowerCase() === "on";
}

/** Rows older than this are removed by cleanup_diagnostic_logs(). */
export const DIAG_RETENTION_DAYS = 45;

// Device report limits (also enforced by the intake route).
export const DIAG_MAX_BODY_BYTES = 24_000;
export const DIAG_MAX_EVENTS_PER_BATCH = 60;
export const DIAG_MAX_EVENT_BYTES = 1_000;

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
