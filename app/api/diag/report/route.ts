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
//              service), and a session that passed in the last few minutes is
//              remembered by a fingerprint of its cookies, so a host screen does
//              not add a sign-in call to every report.
//   - Limits, in this order of cheapness: in this instance's memory (per
//     network address, per device cookie / page load, per TV night), only as a
//     first filter. The real ceilings are in the database and hold across all
//     instances: each night and each source inside it has a row cap
//     (write.ts recordDiagRows, config.ts DIAG_NIGHT_ROW_CAP). The address is
//     never stored.

import { createHash } from "node:crypto";
import { type NextRequest } from "next/server";
import { getAuthedHost, getDeviceId } from "@/lib/api/auth";
import { isValidRoomCode, parseRoomCode } from "@/lib/game/room-code";
import { isSupabaseSessionCookie } from "@/lib/auth/session-cookies";
import { DIAG_MAX_BODY_BYTES, diagnosticsEnabled } from "@/lib/diagnostics/config";
import { createRateLimiter, sanitizeBatch, summarizeDevice, type CleanBatch } from "@/lib/diagnostics/ingest";
import { verifyTvPass } from "@/lib/diagnostics/tvPass";
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

function sessionFingerprint(req: NextRequest): string | null {
  const parts = req.cookies
    .getAll()
    .filter((c) => isSupabaseSessionCookie(c.name))
    .map((c) => `${c.name}=${c.value}`)
    .sort();
  if (parts.length === 0) return null;
  return createHash("sha256").update(parts.join(";")).digest("hex");
}

async function verifiedHostId(fingerprint: string): Promise<string | null> {
  const seen = hostSessions.get(fingerprint);
  if (seen && Date.now() - seen.at < HOST_SESSION_MEMORY_MS) return seen.hostId;
  hostSessions.delete(fingerprint);
  const auth = await getAuthedHost();
  if (!auth.ok) return null;
  if (hostSessions.size >= HOST_SESSION_MAX) hostSessions.delete(hostSessions.keys().next().value as string);
  hostSessions.set(fingerprint, { hostId: auth.host.id, at: Date.now() });
  return auth.host.id;
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
      const fingerprint = sessionFingerprint(req);
      if (!fingerprint || !batch.night) {
        noteIgnored("report");
        return empty(401);
      }
      const nightId = batch.night;
      // Answer now; the sign-in and ownership checks run after the response.
      scheduleDiagWrite(async () => {
        const hostId = await verifiedHostId(fingerprint);
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
