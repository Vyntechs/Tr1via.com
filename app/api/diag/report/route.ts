// POST /api/diag/report — small batched reports from phones, the TV and the
// host laptop (see lib/diagnostics/reporter.ts).
//
// Always answers at once with an empty response; the database write happens
// after the response (lib/diagnostics/write.ts). It never reads or changes
// game state, and a device ignores every status this returns.
//
//   - Off unless DIAGNOSTIC_LOGGING=on (then it just says 204 and stops).
//   - Size capped (headers first, then the real body), events per batch
//     capped, event types allowlisted, every field rebuilt by ingest.ts.
//   - What a device says about itself is a fixed short list of keys
//     (DIAG_DEVICE_KEYS); the browser family, OS family and device class are
//     read from the request here, and the raw browser text is thrown away.
//   - Who a report is about is decided on the SERVER, never by the device:
//       phone  needs a valid device cookie and a player row in the night
//              named by its room code
//       TV     has no login, so it can only name a real, existing room code;
//              the night is looked up from that code (a night id sent by a TV
//              is ignored), and each room has its own small allowance
//       host   needs a signed-in host who owns the night it names
//   - Rate limited in this instance's memory, in three layers that all apply:
//     per network address (a loose backstop sized for a full venue, applied
//     to EVERY request so minting free device cookies does not get around
//     it), per device cookie / page load, and per room for the TV.
//     The address is never stored.

import { type NextRequest } from "next/server";
import { getAuthedHost, getDeviceId } from "@/lib/api/auth";
import { isValidRoomCode, parseRoomCode } from "@/lib/game/room-code";
import { DIAG_MAX_BODY_BYTES, diagnosticsEnabled } from "@/lib/diagnostics/config";
import { createRateLimiter, sanitizeBatch, summarizeDevice } from "@/lib/diagnostics/ingest";
import {
  insertDiagRows,
  lookupNightOwner,
  lookupPlayerId,
  lookupRoomNight,
  scheduleDiagWrite,
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
// The venue TV has no cookie and no login. All page loads of one room's TV
// share this small allowance, so inventing page-load ids for a real room code
// cannot fill that night's log.
const perTvRoom = createRateLimiter({ capacity: 12, refillMs: 5_000 });

function empty(status: number) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
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

    // Who is this about? Only the host names a night id (and must own it).
    // A phone or TV names a room code, and the night is looked up from it.
    let roomCode: string | null = null;
    let hostNightId: string | null = null;
    let hostId: string | null = null;
    if (batch.surface === "host") {
      if (!batch.night) return empty(400);
      hostNightId = batch.night;
      const auth = await getAuthedHost();
      if (!auth.ok) return empty(401);
      hostId = auth.host.id;
    } else {
      const code = batch.room ? parseRoomCode(batch.room) : null;
      if (!code || !isValidRoomCode(code)) return empty(400);
      roomCode = code;
      if (batch.surface === "player" && !deviceId) return empty(401);
      if (batch.surface === "tv" && !perTvRoom.allow(`tv:${code}`)) return empty(429);
    }

    const receivedAt = Date.now();
    // Read once, reduced to three short words, and never stored as text.
    const device = summarizeDevice(req.headers.get("user-agent"), batch.surface);

    scheduleDiagWrite(async () => {
      let nightId: string | null;
      if (hostNightId) {
        nightId = hostNightId;
        if ((await lookupNightOwner(nightId)) !== hostId) return;
      } else {
        // A room code that does not exist (or was made up) stores nothing.
        nightId = roomCode ? await lookupRoomNight(roomCode) : null;
        if (!nightId) return;
        if (batch.surface === "player" && deviceId && !(await lookupPlayerId(nightId, deviceId))) return;
      }

      const offset = receivedAt - batch.sentAt;
      await insertDiagRows(
        "diag_device_events",
        batch.events.map((event) => ({
          night_id: nightId,
          surface: batch.surface,
          session_id: batch.sid,
          device_id: batch.surface === "tv" ? null : deviceId,
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
      );
    });
    return empty(204);
  } catch {
    // Reporting is optional. Nothing here may surface as an error.
    return empty(204);
  }
}
