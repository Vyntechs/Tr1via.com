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
//   - Rate limited in this instance's memory: per device cookie for phones,
//     per page load for the TV and host laptop (which have no cookie), plus
//     a loose per-address backstop for cookie-less reports. The address is
//     never stored.
//   - Phones need a valid device cookie and a player row in the night; the
//     host laptop needs a signed-in host who owns the night.

import { type NextRequest } from "next/server";
import { getAuthedHost, getDeviceId } from "@/lib/api/auth";
import { isValidRoomCode, parseRoomCode } from "@/lib/game/room-code";
import { DIAG_MAX_BODY_BYTES, diagnosticsEnabled } from "@/lib/diagnostics/config";
import { createRateLimiter, sanitizeBatch, summarizeUserAgent } from "@/lib/diagnostics/ingest";
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
// The venue TV and the host laptop have no device cookie, and everything at a
// venue shares one network address. So an address only gets a loose backstop
// (about 1 report a second after a burst of 60), and ONLY for reports without
// a device cookie; 40 phones behind one router are told apart by cookie.
const perAddress = createRateLimiter({ capacity: 60, refillMs: 1_000 });

function empty(status: number) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  if (!diagnosticsEnabled()) return empty(204);
  try {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > DIAG_MAX_BODY_BYTES) return empty(413);

    const deviceId = await getDeviceId();
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    // Cheap checks first, before the body is read.
    if (deviceId ? !perSession.allow(`device:${deviceId}`) : !perAddress.allow(`net:${forwarded ?? "unknown"}`)) {
      return empty(429);
    }

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

    const code = batch.room ? parseRoomCode(batch.room) : null;
    if (code !== null && !isValidRoomCode(code)) return empty(400);

    let hostId: string | null = null;
    if (batch.surface === "player" && !deviceId) return empty(401);
    if (batch.surface === "host") {
      const auth = await getAuthedHost();
      if (!auth.ok) return empty(401);
      hostId = auth.host.id;
    }

    const receivedAt = Date.now();
    const ua = req.headers.get("user-agent")?.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160) ?? null;

    scheduleDiagWrite(async () => {
      const nightId = batch.night ?? (code ? await lookupRoomNight(code) : null);
      if (!nightId) return;
      if (batch.surface === "host" && (await lookupNightOwner(nightId)) !== hostId) return;
      if (batch.surface === "player" && deviceId && !(await lookupPlayerId(nightId, deviceId))) return;

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
          // The first report of a page load says what the device is; the
          // server reads that from the request, not from the device.
          data: event.k === "device" ? { ...event.d, ua, uas: summarizeUserAgent(ua) } : event.d,
        })),
      );
    });
    return empty(204);
  } catch {
    // Reporting is optional. Nothing here may surface as an error.
    return empty(204);
  }
}
