// POST /api/diag/report — the intake for device reports.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.hoisted(() => ({ getDeviceId: vi.fn(), getAuthedHost: vi.fn() }));
const writeMock = vi.hoisted(() => ({
  scheduleDiagWrite: vi.fn(),
  insertDiagRows: vi.fn(),
  lookupRoomNight: vi.fn(),
  lookupNightOwner: vi.fn(),
  lookupPlayerId: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/diagnostics/write", () => writeMock);

const NIGHT_ID = "33333333-3333-3333-3333-333333333333";
const DEVICE_ID = "66666666-6666-6666-6666-666666666666";
const HOST_ID = "99999999-9999-4999-8999-999999999999";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1";

function report(body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new NextRequest("http://test/api/diag/report", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA, ...headers },
    body: text,
  });
}

function batch(extra: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    surface: "player",
    room: "K9PR4M",
    sid: "abc123def456",
    sent: now,
    ev: [
      { t: now - 2000, k: "device", d: { w: 390, h: 844 }, f: 1 },
      { t: now - 1000, k: "bcast", d: { ev: "reveal", lag: 80 } },
    ],
    ...extra,
  };
}

async function flushScheduled() {
  for (const call of writeMock.scheduleDiagWrite.mock.calls) await (call[0] as () => Promise<void>)();
}

async function loadRoute() {
  vi.resetModules(); // a fresh rate limiter for every test
  return import("@/app/api/diag/report/route");
}

describe("POST /api/diag/report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("DIAGNOSTIC_LOGGING", "on");
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);
    authMock.getAuthedHost.mockResolvedValue({ ok: true, host: { id: HOST_ID } });
    writeMock.lookupRoomNight.mockResolvedValue(NIGHT_ID);
    writeMock.lookupNightOwner.mockResolvedValue(HOST_ID);
    writeMock.lookupPlayerId.mockResolvedValue("player-1");
  });

  it("does nothing at all while logging is off", async () => {
    vi.stubEnv("DIAGNOSTIC_LOGGING", "off");
    const { POST } = await loadRoute();
    const res = await POST(report(batch()));
    expect(res.status).toBe(204);
    expect(authMock.getDeviceId).not.toHaveBeenCalled();
    expect(writeMock.scheduleDiagWrite).not.toHaveBeenCalled();
  });

  it("answers 204 at once and writes the rows afterwards, with the clock drift worked out", async () => {
    const { POST } = await loadRoute();
    const res = await POST(report(batch()));
    expect(res.status).toBe(204);
    expect(writeMock.insertDiagRows).not.toHaveBeenCalled(); // not before the response
    await flushScheduled();
    expect(writeMock.insertDiagRows).toHaveBeenCalledTimes(1);
    const [table, rows] = writeMock.insertDiagRows.mock.calls[0] as [string, Record<string, unknown>[]];
    expect(table).toBe("diag_device_events");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      night_id: NIGHT_ID,
      surface: "player",
      session_id: "abc123def456",
      device_id: DEVICE_ID,
      kind: "device",
      forced: true,
    });
    // The server reads the device description from the request, not the body.
    expect((rows[0]!.data as Record<string, unknown>).uas).toBe("iPhone · iOS 17.5 · Safari 17.5");
    expect(rows[1]).toMatchObject({ kind: "bcast", forced: false });
    expect(typeof rows[1]!.at_est).toBe("string");
    expect(typeof rows[1]!.offset_ms).toBe("number");
  });

  it("refuses an oversized body by its declared size and by its real size", async () => {
    const { POST } = await loadRoute();
    expect((await POST(report(batch(), { "content-length": "999999" }))).status).toBe(413);
    const huge = batch({ junk: "z".repeat(30_000) });
    expect((await POST(report(huge))).status).toBe(413);
    expect(writeMock.scheduleDiagWrite).not.toHaveBeenCalled();
  });

  it("rate limits a device that reports too fast", async () => {
    const { POST } = await loadRoute();
    const statuses: number[] = [];
    for (let i = 0; i < 15; i++) statuses.push((await POST(report(batch()))).status);
    expect(statuses.slice(0, 12).every((s) => s === 204)).toBe(true);
    expect(statuses.slice(12)).toEqual([429, 429, 429]);
  });

  describe("a whole venue behind one network address", () => {
    const TEN_MINUTES_OF_REPORTS = 60; // one every 10 seconds

    function fromVenue(body: unknown, headers: Record<string, string> = {}) {
      return report(body, { "x-forwarded-for": "203.0.113.7", ...headers });
    }

    it("never turns away the TV, the host laptop and the host phone (no cookies) over ten minutes", async () => {
      vi.useFakeTimers();
      try {
        authMock.getDeviceId.mockResolvedValue(null); // none of the three has a device cookie
        const { POST } = await loadRoute();
        const bad: number[] = [];
        for (let i = 0; i < TEN_MINUTES_OF_REPORTS; i++) {
          for (const [surface, sid, extra] of [
            ["tv", "tv-page-load-1", { room: "K9PR4M" }],
            ["host", "host-laptop-1", { room: undefined, night: NIGHT_ID }],
            ["host", "host-phone-01", { room: undefined, night: NIGHT_ID }],
          ] as const) {
            const res = await POST(fromVenue(batch({ surface, sid, ...extra })));
            if (res.status !== 204) bad.push(res.status);
          }
          vi.advanceTimersByTime(10_000);
        }
        expect(bad).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("never turns away 40 phones sharing one address (they have cookies) over ten minutes", async () => {
      vi.useFakeTimers();
      try {
        const { POST } = await loadRoute();
        const bad: number[] = [];
        for (let i = 0; i < TEN_MINUTES_OF_REPORTS; i++) {
          for (let phone = 0; phone < 40; phone++) {
            authMock.getDeviceId.mockResolvedValue(`00000000-0000-4000-8000-${String(phone).padStart(12, "0")}`);
            const res = await POST(fromVenue(batch({ sid: `phone-session-${phone}` })));
            if (res.status !== 204) bad.push(res.status);
          }
          vi.advanceTimersByTime(10_000);
        }
        expect(bad).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("still stops a cookie-less sender that keeps inventing new page-load ids", async () => {
      authMock.getDeviceId.mockResolvedValue(null);
      const { POST } = await loadRoute();
      const statuses: number[] = [];
      for (let i = 0; i < 80; i++) {
        statuses.push((await POST(fromVenue(batch({ surface: "tv", sid: `invented-${i}-xyz` })))).status);
      }
      expect(statuses.filter((s) => s === 204)).toHaveLength(60);
      expect(statuses.slice(60).every((s) => s === 429)).toBe(true);
    });
  });

  it("rejects malformed JSON and bad shapes without storing anything", async () => {
    const { POST } = await loadRoute();
    expect((await POST(report("{not json"))).status).toBe(400);
    expect((await POST(report({ surface: "player" }))).status).toBe(400);
    expect((await POST(report(batch({ room: "bad/code" })))).status).toBe(400);
    expect(writeMock.scheduleDiagWrite).not.toHaveBeenCalled();
  });

  it("needs a device cookie from a phone, and a signed-in host from the host laptop", async () => {
    const { POST } = await loadRoute();
    authMock.getDeviceId.mockResolvedValue(null);
    expect((await POST(report(batch()))).status).toBe(401);

    authMock.getAuthedHost.mockResolvedValue({ ok: false, status: 401, error: "not signed in" });
    const hostBatch = batch({ surface: "host", room: undefined, night: NIGHT_ID });
    expect((await POST(report(hostBatch))).status).toBe(401);
    expect(writeMock.scheduleDiagWrite).not.toHaveBeenCalled();
  });

  it("drops a host report for a night that host does not own, and a phone not in the night", async () => {
    const { POST } = await loadRoute();
    writeMock.lookupNightOwner.mockResolvedValue("someone-else");
    await POST(report(batch({ surface: "host", room: undefined, night: NIGHT_ID })));
    await flushScheduled();
    expect(writeMock.insertDiagRows).not.toHaveBeenCalled();

    writeMock.scheduleDiagWrite.mockClear();
    writeMock.lookupPlayerId.mockResolvedValue(null);
    await POST(report(batch()));
    await flushScheduled();
    expect(writeMock.insertDiagRows).not.toHaveBeenCalled();
  });

  it("takes TV reports without a cookie and stores no device id for them", async () => {
    authMock.getDeviceId.mockResolvedValue(null);
    const { POST } = await loadRoute();
    expect((await POST(report(batch({ surface: "tv" })))).status).toBe(204);
    await flushScheduled();
    const rows = writeMock.insertDiagRows.mock.calls[0]![1] as Record<string, unknown>[];
    expect(rows[0]!.device_id).toBeNull();
  });

  it("never turns an internal problem into an error for the device", async () => {
    authMock.getDeviceId.mockRejectedValue(new Error("cookies unavailable"));
    const { POST } = await loadRoute();
    expect((await POST(report(batch()))).status).toBe(204);
  });
});
