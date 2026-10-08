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
const OTHER_NIGHT_ID = "44444444-4444-4444-4444-444444444444";
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
      { t: now - 2000, k: "device", d: { sc: "s", ol: true, et: "4g" }, f: 1 },
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
    // The server reads the browser, OS and device class from the request, and
    // keeps no raw user-agent text.
    expect(rows[0]!.data).toEqual({ sc: "s", ol: true, et: "4g", br: "Safari 17", os: "iOS", dc: "phone" });
    expect(JSON.stringify(rows)).not.toContain("Mozilla");
    expect(JSON.stringify(rows)).not.toContain("17.5");
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

    it("stops a TV sender that keeps inventing new page-load ids for one room", async () => {
      authMock.getDeviceId.mockResolvedValue(null);
      const { POST } = await loadRoute();
      const statuses: number[] = [];
      for (let i = 0; i < 40; i++) {
        statuses.push((await POST(fromVenue(batch({ surface: "tv", sid: `invented-${i}-xyz` })))).status);
      }
      expect(statuses.filter((s) => s === 204)).toHaveLength(12);
      expect(statuses.slice(12).every((s) => s === 429)).toBe(true);
    });

    it("still holds one address to its allowance when it keeps minting fresh device cookies", async () => {
      // A device cookie is free to get, so having one must not skip the address check.
      const { POST } = await loadRoute();
      let n = 0;
      authMock.getDeviceId.mockImplementation(async () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`);
      const statuses: number[] = [];
      for (let i = 0; i < 300; i++) {
        statuses.push((await POST(fromVenue(batch({ sid: `minted-session-${i}` })))).status);
      }
      const ok = statuses.filter((s) => s === 204).length;
      expect(ok).toBeGreaterThanOrEqual(120); // a whole venue's burst fits...
      expect(ok).toBeLessThan(130); // ...but not an endless stream
      expect(statuses.at(-1)).toBe(429);
      // Nothing was written for the refused ones.
      expect(writeMock.scheduleDiagWrite.mock.calls.length).toBe(ok);
    });

    it("does not let one noisy address use up another address's allowance", async () => {
      const { POST } = await loadRoute();
      authMock.getDeviceId.mockResolvedValue(null);
      for (let i = 0; i < 200; i++) await POST(fromVenue(batch({ surface: "tv", sid: `noisy-${i}-abc` })));
      authMock.getDeviceId.mockResolvedValue(DEVICE_ID);
      const quiet = await POST(report(batch({ sid: "quiet-phone-1" }), { "x-forwarded-for": "198.51.100.9" }));
      expect(quiet.status).toBe(204);
    });
  });

  it("rejects malformed JSON and bad shapes without storing anything", async () => {
    const { POST } = await loadRoute();
    expect((await POST(report("{not json"))).status).toBe(400);
    expect((await POST(report({ surface: "player" }))).status).toBe(400);
    expect((await POST(report(batch({ room: "bad/code" })))).status).toBe(400);
    expect(writeMock.scheduleDiagWrite).not.toHaveBeenCalled();
  });

  it("only a host report may name a night id; phones and TVs must name a room code", async () => {
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);
    const { POST } = await loadRoute();
    expect((await POST(report(batch({ room: undefined, night: NIGHT_ID })))).status).toBe(400); // player
    expect((await POST(report(batch({ surface: "tv", room: undefined, night: NIGHT_ID })))).status).toBe(400); // tv
    expect((await POST(report(batch({ surface: "host", room: "K9PR4M" })))).status).toBe(400); // host without a night
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

  describe("the TV (no login, no cookie)", () => {
    it("takes TV reports without a cookie and stores no device id for them", async () => {
      authMock.getDeviceId.mockResolvedValue(null);
      const { POST } = await loadRoute();
      expect((await POST(report(batch({ surface: "tv" })))).status).toBe(204);
      await flushScheduled();
      const rows = writeMock.insertDiagRows.mock.calls[0]![1] as Record<string, unknown>[];
      expect(rows[0]!.device_id).toBeNull();
      expect(rows[0]!.night_id).toBe(NIGHT_ID);
      expect((rows[0]!.data as Record<string, unknown>).dc).toBe("tv");
    });

    it("ignores a night id sent by a TV: the night comes from the room code, looked up on the server", async () => {
      authMock.getDeviceId.mockResolvedValue(null);
      const { POST } = await loadRoute();
      await POST(report(batch({ surface: "tv", room: "K9PR4M", night: OTHER_NIGHT_ID })));
      await flushScheduled();
      expect(writeMock.lookupRoomNight).toHaveBeenCalledWith("K9PR4M");
      expect(writeMock.lookupNightOwner).not.toHaveBeenCalled();
      const rows = writeMock.insertDiagRows.mock.calls[0]![1] as Record<string, unknown>[];
      expect(rows.every((r) => r.night_id === NIGHT_ID)).toBe(true);
      expect(JSON.stringify(rows)).not.toContain(OTHER_NIGHT_ID);
    });

    it("refuses a TV report that names only a night id, with no room code", async () => {
      authMock.getDeviceId.mockResolvedValue(null);
      const { POST } = await loadRoute();
      expect((await POST(report(batch({ surface: "tv", room: undefined, night: OTHER_NIGHT_ID })))).status).toBe(400);
      expect(writeMock.scheduleDiagWrite).not.toHaveBeenCalled();
    });

    it("stores nothing for a room code that does not exist", async () => {
      authMock.getDeviceId.mockResolvedValue(null);
      writeMock.lookupRoomNight.mockResolvedValue(null);
      const { POST } = await loadRoute();
      expect((await POST(report(batch({ surface: "tv", room: "ZZZZZZ" })))).status).toBe(204);
      await flushScheduled();
      expect(writeMock.lookupRoomNight).toHaveBeenCalledWith("ZZZZZZ");
      expect(writeMock.insertDiagRows).not.toHaveBeenCalled();
    });

    it("accepts a room code written the way it is shown on the screen", async () => {
      authMock.getDeviceId.mockResolvedValue(null);
      const { POST } = await loadRoute();
      expect((await POST(report(batch({ surface: "tv", room: "K9P·R4M" })))).status).toBe(204);
      await flushScheduled();
      expect(writeMock.lookupRoomNight).toHaveBeenCalledWith("K9PR4M");
    });
  });

  it("a phone's night comes from its room code too; a night id it sends is ignored", async () => {
    const { POST } = await loadRoute();
    await POST(report(batch({ night: OTHER_NIGHT_ID })));
    await flushScheduled();
    expect(writeMock.lookupRoomNight).toHaveBeenCalledWith("K9PR4M");
    expect(writeMock.lookupPlayerId).toHaveBeenCalledWith(NIGHT_ID, DEVICE_ID);
    const rows = writeMock.insertDiagRows.mock.calls[0]![1] as Record<string, unknown>[];
    expect(rows.every((r) => r.night_id === NIGHT_ID)).toBe(true);
  });

  it("a host report uses the night it names, after checking the signed-in host owns it", async () => {
    const { POST } = await loadRoute();
    await POST(report(batch({ surface: "host", room: undefined, night: NIGHT_ID, sid: "host-laptop-1" })));
    await flushScheduled();
    expect(writeMock.lookupNightOwner).toHaveBeenCalledWith(NIGHT_ID);
    expect(writeMock.lookupRoomNight).not.toHaveBeenCalled();
    const rows = writeMock.insertDiagRows.mock.calls[0]![1] as Record<string, unknown>[];
    expect(rows[0]!.night_id).toBe(NIGHT_ID);
  });

  it("stores only the short device summary, whatever a device or an old cached page sends", async () => {
    const { POST } = await loadRoute();
    const now = Date.now();
    await POST(
      report(
        batch({
          ev: [
            {
              t: now - 1000,
              k: "device",
              f: 1,
              d: { sc: "m", w: 390, h: 844, dpr: 3, cores: 6, mem: 4, app: true, sd: true, ua: UA, uas: "x", s: "player" },
            },
            { t: now - 900, k: "net", d: { ev: "online", ol: true, w: 390, mem: 4 } },
          ],
        }),
      ),
    );
    await flushScheduled();
    const rows = writeMock.insertDiagRows.mock.calls[0]![1] as Record<string, unknown>[];
    expect(Object.keys(rows[0]!.data as object).sort()).toEqual(["br", "dc", "os", "sc"]);
    expect(rows[1]!.data).toEqual({ ev: "online", ol: true });
    expect(JSON.stringify(rows)).not.toContain("Mozilla");
  });

  it("never turns an internal problem into an error for the device", async () => {
    authMock.getDeviceId.mockRejectedValue(new Error("cookies unavailable"));
    const { POST } = await loadRoute();
    expect((await POST(report(batch()))).status).toBe(204);
  });
});
