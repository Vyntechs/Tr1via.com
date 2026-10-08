// POST /api/diag/report — small batched reports from phones, the TV and the
// host laptop (see lib/diagnostics/reporter.ts).
//
// Always answers at once with an empty response; every check that needs the
// database or the sign-in service, and the database write itself, happens
// AFTER the response (lib/diagnostics/write.ts). It never reads or changes
// game state, and a device ignores every status this returns.
//
//   - Off unless DIAGNOSTIC_LOGGING=on (then it just says 204 and stops).
//   - Size capped (headers first, then the real body), events per batch
//     capped, and EVERY event is rebuilt by ingest.ts from a fixed list of
//     kinds and fields for the screen it came from.
//   - What a device says about itself is a fixed short list of keys
//     (DIAG_DEVICE_KEYS); the browser family, OS family and device class are
//     read from the request here, and the raw browser text is thrown away.
//   - Who a report is about is decided on the SERVER, never by the device, and
//     only a verified source is stored (anything else stores nothing and is
//     only counted):
//       phone  a valid device cookie that belongs to a player of the night its
//              room code names
//       TV     the signed pass the server gave the TV page when it loaded
//              (lib/diagnostics/tvPass.ts). The night comes from the pass; a
//              room code or night id sent by a TV is ignored. No pass, a forged
//              or an expired one: nothing stored.
//       host   a signed-in host who owns the night it names. This is checked
//              AFTER the response (the host laptop never waits on the sign-in
//              service), STRICTLY READ-ONLY (lib/diagnostics/hostSession.ts):
//              it never renews a session and never touches a cookie, because
//              a renewal from here could use up the host's refresh token and
//              leave the browser unable to renew its own. An access token that
//              is already expired is dropped without any network call. A
//              session that passed in the last few minutes is remembered by a
//              fingerprint of its cookies, so a host screen does not add a
//              sign-in call to every report. A session the sign-in service
//              turned down is remembered for 30 s as well, and the number of
//              NEW sessions that may start a check is limited per address and
//              per server copy, all before anything is scheduled: forged
//              cookies cost no log turn and (past a handful) no sign-in call.
//   - Limits, in this order of cheapness: in this instance's memory (per
//     network address, per device cookie / page load, per TV night), only as a
//     first filter. The real ceilings are in the database and hold across all
//     instances: each night and each source inside it has a row cap
//     (write.ts recordDiagRows, config.ts DIAG_NIGHT_ROW_CAP). The address is
//     never stored.

import { createHash } from "node:crypto";
import { type NextRequest } from "next/server";
import { getDeviceId } from "@/lib/api/auth";
import { isValidRoomCode, parseRoomCode } from "@/lib/game/room-code";
import { DIAG_MAX_BODY_BYTES, diagnosticsEnabled } from "@/lib/diagnostics/config";
import { createRateLimiter, sanitizeBatch, summarizeDevice, type CleanBatch } from "@/lib/diagnostics/ingest";
import {
  accessTokenFromCookies,
  sessionCookiesOf,
  verifyHostSessionReadOnly,
  type SessionCookie,
} from "@/lib/diagnostics/hostSession";
import { verifyTvPass } from "@/lib/diagnostics/tvPass";
import { DiagLookupSlow } from "@/lib/diagnostics/deadline";
import {
  lookupNightOwner,
  lookupPlayerId,
  lookupRoomNight,
  noteIgnored,
  recordDiagRows,
  scheduleDiagWrite,
  type DiagSource,
} from "@/lib/diagnostics/write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A device reports about every 10 s. Each page load (or each phone's device
// cookie) gets a burst of 12, then one report per 5 s.
const perSession = createRateLimiter({ capacity: 12, refillMs: 5_000 });
// Everything at a venue shares one network address, so this is only a loose
// backstop: a burst of 120, then 10 a second. A full room (about 45 devices
// reporting every ~10 s is 4 a second; 80 phones flushing together after a
// question is about 13 a second for a few seconds) fits comfortably, while one
// address inventing cookies or page-load ids is held to 10 a second.
const perAddress = createRateLimiter({ capacity: 120, refillMs: 100 });
// All page loads of one night's TV share this allowance (a burst of 30, then
// one every 2 s: room for several TVs and a few reloads, since one TV reports
// about every 10 s).
const perTvNight = createRateLimiter({ capacity: 30, refillMs: 2_000 });

function empty(status: number) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

// ─── host sessions that were checked recently ────────────────────────
// Keyed by a fingerprint (a hash) of the sign-in cookies, kept in memory only.
// A hit means "this exact session passed the sign-in check a moment ago". It
// only decides whether a host's own timing report is stored, so a few minutes
// is plenty fresh.
const HOST_SESSION_MEMORY_MS = 5 * 60_000;
const HOST_SESSION_MAX = 200;
const hostSessions = new Map<string, { hostId: string; at: number }>();

// A session the sign-in service turned down (forged, signed out, not a host) is
// remembered for a short while too, so the same cookie sent again and again costs
// nothing. A definite "no" is remembered for 30 s. "Could not check" (the sign-in
// service is slow or down) is remembered only for HOST_UNCHECKED_MEMORY_MS: long
// enough that one cookie cannot make a sign-in call per log job while the service
// is struggling, short enough that a real host is asked about again within seconds
// of the service coming back (her reports in that gap are not stored: logging only).
const HOST_FAILURE_MEMORY_MS = 30_000;
const HOST_UNCHECKED_MEMORY_MS = 5_000;
const HOST_FAILURE_MAX = 500;
const hostFailures = new Map<string, number>();
const hostUnchecked = new Map<string, number>();

// Checks that are already running, so reports from one session that arrive
// together share ONE sign-in call.
const hostChecks = new Map<string, Promise<string | null>>();
// A new session that has been let through to a check is "claimed" until its job
// has had time to run, so the reports that follow it while it waits for a log
// turn (up to 8 s) do not each spend the allowance below.
const HOST_CLAIM_MS = 10_000;
const hostClaims = new Map<string, number>();

// A forger can send a different fake token every time, so remembering failures
// is not enough on its own: the number of sign-in checks a session NOT already
// in memory may start is limited too, per network address and per server copy.
// A genuine host screen needs one check per cookie change (at most a few an
// hour: the first report of a page load, then after each sign-in token renewal),
// so a venue with three host screens fits easily; a flood from one address is
// held to 6, then one every 10 s, and never reaches the sign-in service or takes
// a log turn. Turned-away reports get a 429 (a real host screen tries again later).
const checksPerAddress = createRateLimiter({ capacity: 6, refillMs: 10_000 });
const checksPerCopy = createRateLimiter({ capacity: 30, refillMs: 1_000 });
// Every report from a session that is NOT yet known good (not remembered), even
// one that rides on a check already claimed or running, spends from this
// allowance first, per network address: a burst of 12, then one a second. So one
// forged cookie sent over and over is held to this many log jobs, not one per
// report, and a genuine host screen (a handful of reports while its first check
// runs) never notices it.
const unverifiedPerAddress = createRateLimiter({ capacity: 12, refillMs: 1_000 });

function sessionFingerprint(cookies: SessionCookie[]): string | null {
  if (cookies.length === 0) return null;
  const parts = cookies.map((c) => `${c.name}=${c.value}`).sort();
  return createHash("sha256").update(parts.join(";")).digest("hex");
}

function rememberedHost(fingerprint: string): string | null {
  const seen = hostSessions.get(fingerprint);
  if (seen && Date.now() - seen.at < HOST_SESSION_MEMORY_MS) return seen.hostId;
  hostSessions.delete(fingerprint);
  return null;
}

function recentlyFailed(fingerprint: string): boolean {
  const until = hostFailures.get(fingerprint);
  if (until === undefined) return false;
  if (Date.now() < until) return true;
  hostFailures.delete(fingerprint);
  return false;
}

function recentlyUnchecked(fingerprint: string): boolean {
  const until = hostUnchecked.get(fingerprint);
  if (until === undefined) return false;
  if (Date.now() < until) return true;
  hostUnchecked.delete(fingerprint);
  return false;
}

/**
 * What to do with a host report, decided in the request, BEFORE anything is
 * scheduled (a forged report must not take a log turn):
 *   ok      a remembered good session, or an unknown one that the address's
 *           allowance lets through: a check already running or claimed, or a new
 *           session that may start a check
 *   bad     remembered as turned down or as "could not check" a moment ago, or
 *           no usable token (none, unreadable, already run out): nothing to ask
 *           anyone
 *   limited the address or this copy has used up its allowance
 * The order matters: everything that is not a remembered good session is charged
 * to the address's allowance BEFORE a claim or a running check can wave it through.
 */
function hostCheckDecision(fingerprint: string, cookies: SessionCookie[], address: string): "ok" | "bad" | "limited" {
  if (rememberedHost(fingerprint)) return "ok";
  if (recentlyFailed(fingerprint) || recentlyUnchecked(fingerprint)) return "bad";
  // No network call is needed to see that there is no usable token.
  if (!accessTokenFromCookies(cookies)) return "bad";
  if (!unverifiedPerAddress.allow(`host-unverified:${address}`)) return "limited";
  if (hostChecks.has(fingerprint)) return "ok";
  const claimedUntil = hostClaims.get(fingerprint);
  if (claimedUntil !== undefined && Date.now() < claimedUntil) return "ok";
  if (!checksPerAddress.allow(`host-check:${address}`) || !checksPerCopy.allow("host-check")) return "limited";
  if (hostClaims.size >= HOST_FAILURE_MAX) hostClaims.delete(hostClaims.keys().next().value as string);
  hostClaims.set(fingerprint, Date.now() + HOST_CLAIM_MS);
  return "ok";
}

function rememberFailure(fingerprint: string): void {
  if (hostFailures.size >= HOST_FAILURE_MAX) hostFailures.delete(hostFailures.keys().next().value as string);
  hostFailures.set(fingerprint, Date.now() + HOST_FAILURE_MEMORY_MS);
}

/** Read-only (see hostSession.ts): the cookies are copied out before the reply, nothing is written back. */
async function verifiedHostId(fingerprint: string, cookies: SessionCookie[]): Promise<string | null> {
  const known = rememberedHost(fingerprint);
  if (known) return known;
  if (recentlyFailed(fingerprint)) return null;
  let running = hostChecks.get(fingerprint);
  if (!running) {
    // "Could not check" a moment ago: do not ask again yet (see HOST_UNCHECKED_MEMORY_MS).
    if (recentlyUnchecked(fingerprint)) throw new DiagLookupSlow();
    running = (async () => {
      let hostId: string | null;
      try {
        hostId = await verifyHostSessionReadOnly(cookies);
      } catch (error) {
        // The sign-in service could not answer in time: remembered only briefly, and not as a "no".
        if (hostUnchecked.size >= HOST_FAILURE_MAX) hostUnchecked.delete(hostUnchecked.keys().next().value as string);
        hostUnchecked.set(fingerprint, Date.now() + HOST_UNCHECKED_MEMORY_MS);
        throw error;
      }
      if (!hostId) {
        rememberFailure(fingerprint);
        return null;
      }
      if (hostSessions.size >= HOST_SESSION_MAX) hostSessions.delete(hostSessions.keys().next().value as string);
      hostSessions.set(fingerprint, { hostId, at: Date.now() });
      return hostId;
    })().finally(() => hostChecks.delete(fingerprint));
    hostChecks.set(fingerprint, running);
  }
  return running;
}

export async function POST(req: NextRequest) {
  if (!diagnosticsEnabled()) return empty(204);
  try {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > DIAG_MAX_BODY_BYTES) return empty(413);

    // The network-address allowance comes first and applies to everyone: a
    // free device cookie must not buy a way around it.
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (!perAddress.allow(`net:${forwarded ?? "unknown"}`)) return empty(429);
    const deviceId = await getDeviceId();
    if (deviceId && !perSession.allow(`device:${deviceId}`)) return empty(429);

    // The declared length can be missing or wrong: check the real body too.
    const text = await req.text();
    if (text.length > DIAG_MAX_BODY_BYTES) return empty(413);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return empty(400);
    }
    const batch = sanitizeBatch(json);
    if (!batch) return empty(400);
    // No device cookie (TV, host laptop): each page load has its own allowance.
    if (!deviceId && !perSession.allow(`page:${batch.surface}:${batch.sid}`)) return empty(429);
    if (batch.events.length === 0) return empty(204);

    const receivedAt = Date.now();
    // Read once, reduced to three short words, and never stored as text.
    const device = summarizeDevice(req.headers.get("user-agent"), batch.surface);

    if (batch.surface === "host") {
      // No session cookie at all can be turned away without asking anyone.
      const sessionCookies = sessionCookiesOf(req.cookies.getAll());
      const fingerprint = sessionFingerprint(sessionCookies);
      if (!fingerprint || !batch.night) {
        noteIgnored("report");
        return empty(401);
      }
      const nightId = batch.night;
      // A forged, remembered-bad or unusable session, or a flood of new ones from
      // one address, is dealt with here: no log turn, no sign-in call.
      const decision = hostCheckDecision(fingerprint, sessionCookies, forwarded ?? "unknown");
      if (decision === "limited") return empty(429);
      if (decision === "bad") {
        noteIgnored("report");
        return empty(204);
      }
      // Answer now; the sign-in and ownership checks run after the response.
      scheduleDiagWrite(async () => {
        const hostId = await verifiedHostId(fingerprint, sessionCookies);
        if (!hostId || (await lookupNightOwner(nightId)) !== hostId) {
          noteIgnored("report");
          return;
        }
        await store(batch, nightId, { kind: "host" }, null, device, receivedAt);
      });
      return empty(204);
    }

    if (batch.surface === "tv") {
      // The night comes from the pass the server gave this TV page, never from the report.
      const nightId = verifyTvPass(batch.pass);
      if (!nightId) {
        noteIgnored("report");
        return empty(401);
      }
      if (!perTvNight.allow(`tv:${nightId}`)) return empty(429);
      scheduleDiagWrite(() => store(batch, nightId, { kind: "tv" }, null, device, receivedAt));
      return empty(204);
    }

    // A phone: its device cookie, and the room code it was opened with.
    const code = batch.room ? parseRoomCode(batch.room) : null;
    if (!code || !isValidRoomCode(code)) return empty(400);
    if (!deviceId) {
      noteIgnored("report");
      return empty(401);
    }
    scheduleDiagWrite(async () => {
      // A room code that does not exist (or was made up) stores nothing, and
      // the miss is remembered for a short while.
      const nightId = await lookupRoomNight(code);
      // So does a cookie that is not a player of that night.
      if (!nightId || !(await lookupPlayerId(nightId, deviceId))) {
        noteIgnored("report");
        return;
      }
      await store(batch, nightId, { kind: "player", deviceId }, deviceId, device, receivedAt);
    });
    return empty(204);
  } catch {
    // Reporting is optional. Nothing here may surface as an error.
    return empty(204);
  }
}

async function store(
  batch: CleanBatch,
  nightId: string,
  source: DiagSource,
  deviceId: string | null,
  device: ReturnType<typeof summarizeDevice>,
  receivedAt: number,
): Promise<void> {
  const offset = receivedAt - batch.sentAt;
  await recordDiagRows(
    "diag_device_events",
    batch.events.map((event) => ({
      night_id: nightId,
      surface: batch.surface,
      session_id: batch.sid,
      device_id: deviceId,
      kind: event.k,
      device_at: new Date(event.t).toISOString(),
      at_est: new Date(event.t + offset).toISOString(),
      // Stays inside the column's range even for a phone with a very wrong clock.
      offset_ms: Math.max(-2_000_000_000, Math.min(2_000_000_000, Math.round(offset))),
      forced: event.forced,
      // The first report of a page load says what the device is. The
      // browser, OS and device class come from the request, not the body.
      data: event.k === "device" ? { ...event.d, ...device } : event.d,
    })),
    nightId,
    source,
  );
}
