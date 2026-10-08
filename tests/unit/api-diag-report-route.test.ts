// POST /api/diag/report — the intake for device reports.
//
// Promises under test: the device always gets an instant empty answer; only a
// VERIFIED source is stored (phone with a cookie that is a player of the night,
// host who owns the night, TV with the signed pass its page was given) and
// everything else stores nothing; every event is rebuilt from a fixed list; the
// host never waits on the sign-in service, and checking a host can never renew
// her session or write a cookie.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.hoisted(() => ({ getDeviceId: vi.fn(), getAuthedHost: vi.fn() }));
// What the host check may touch: the sign-in service's "who is this token?" call
// and the host lookup. Everything that could renew or change a session is here
// only so the tests can prove it is never called.
const signIn = vi.hoisted(() => ({
  getUser: vi.fn(),
  refreshSession: vi.fn(),
  setSession: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  createClient: vi.fn(),
  createServerClient: vi.fn(),
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
  cookiesFn: vi.fn(),
  hostRow: vi.fn(),
}));
const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const writeMock = vi.hoisted(() => ({
  scheduleDiagWrite: vi.fn(),
  recordDiagRows: vi.fn(),
  noteIgnored: vi.fn(),
  lookupRoomNight: vi.fn(),
  lookupNightOwner: vi.fn(),
  lookupPlayerId: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/diagnostics/write", () => writeMock);
vi.mock("@supabase/supabase-js", () => ({ createClient: signIn.createClient }));
vi.mock("@supabase/ssr", () => ({ createServerClient: signIn.createServerClient }));
vi.mock("next/headers", () => ({ cookies: signIn.cookiesFn }));
vi.mock("@/lib/supabase/admin", () => adminMock);

import { signTvPass } from "@/lib/diagnostics/tvPass";

const SECRET = "test-session-secret-0123456789";
const NIGHT_ID = "33333333-3333-3333-3333-333333333333";
const OTHER_NIGHT_ID = "44444444-4444-4444-4444-444444444444";
const DEVICE_ID = "66666666-6666-6666-6666-666666666666";
const HOST_ID = "99999999-9999-4999-8999-999999999999";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1";
const USER_ID = "11111111-aaaa-4aaa-8aaa-111111111111";
const ACCESS_TOKEN = "eyJhbGciOiJIUzI1NiJ9.host-laptop-token.signature";

/** The sign-in cookie a browser really holds, with an access token good for an hour (or as given). */
function hostCookie(token = ACCESS_TOKEN, expiresInSeconds = 3600, project = "localproj") {
  const session = {
    access_token: token,
    refresh_token: "the-browsers-own-refresh-token",
    token_type: "bearer",
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    user: { id: USER_ID },
  };
  return { cookie: `sb-${project}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}` };
}
const HOST_COOKIE = hostCookie();

function report(body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new NextRequest("http://test/api/diag/report", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA, ...headers },
    body: text,
  });
}

const events = (now = Date.now()) => [
  { t: now - 2000, k: "device", d: { sc: "s", ol: true, et: "4g" }, f: 1 },
  { t: now - 1000, k: "bcast", d: { ev: "reveal", lag: 80 } },
];

/** A phone's report. */
function batch(extra: Record<string, unknown> = {}) {
  return { surface: "player", room: "K9PR4M", sid: "abc123def456", sent: Date.now(), ev: events(), ...extra };
}
/** The TV's report, carrying the pass its page was given. */
function tvBatch(extra: Record<string, unknown> = {}, night = NIGHT_ID) {
  return { surface: "tv", tok: signTvPass(night), sid: "tv-page-load-1", sent: Date.now(), ev: events(), ...extra };
}
/** The host laptop's report. */
function hostBatch(extra: Record<string, unknown> = {}) {
  return { surface: "host", night: NIGHT_ID, sid: "host-laptop-1", sent: Date.now(), ev: events(), ...extra };
}

async function flushScheduled() {
  for (const call of writeMock.scheduleDiagWrite.mock.calls) await (call[0] as () => Promise<void>)();
}

async function loadRoute() {
  vi.resetModules(); // a fresh rate limiter and host-session memory for every test
  return import("@/app/api/diag/report/route");
}

function stored() {
  return writeMock.recordDiagRows.mock.calls.map((c) => ({
    table: c[0] as string,
    rows: c[1] as Record<string, unknown>[],
    night: c[2] as string,
    source: c[3] as { kind: string; deviceId?: string },
  }));
}

describe("POST /api/diag/report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("DIAGNOSTIC_LOGGING", "on");
    vi.stubEnv("SESSION_SECRET", SECRET);
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);
    authMock.getAuthedHost.mockResolvedValue({ ok: true, host: { id: HOST_ID } });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    signIn.createClient.mockImplementation(() => ({
      auth: {
        getUser: signIn.getUser,
        refreshSession: signIn.refreshSession,
        setSession: signIn.setSession,
        getSession: signIn.getSession,
        signOut: signIn.signOut,
      },
    }));
    signIn.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    signIn.hostRow.mockResolvedValue({ data: { id: HOST_ID }, error: null });
    signIn.cookiesFn.mockImplementation(async () => ({
      get: () => undefined,
      getAll: () => [],
      set: signIn.cookieSet,
      delete: signIn.cookieDelete,
    }));
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: () => {
        const chain = { select: () => chain, eq: () => chain, maybeSingle: () => signIn.hostRow() };
        return chain;
      },
    });
    writeMock.lookupRoomNight.mockResolvedValue(NIGHT_ID);
    writeMock.lookupNightOwner.mockResolvedValue(HOST_ID);
    writeMock.lookupPlayerId.mockResolvedValue("player-1");
  });

  afterEach(() => vi.useRealTimers());

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
    expect(writeMock.recordDiagRows).not.toHaveBeenCalled(); // not before the response
    await flushScheduled();
    expect(writeMock.recordDiagRows).toHaveBeenCalledTimes(1);
    const { table, rows, night, source } = stored()[0]!;
    expect(table).toBe("diag_device_events");
    expect(night).toBe(NIGHT_ID);
    expect(source).toEqual({ kind: "player", deviceId: DEVICE_ID });
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

    it("never turns away the TV, the host laptop and the host phone (no device cookies) over ten minutes", async () => {
      vi.useFakeTimers();
      authMock.getDeviceId.mockResolvedValue(null); // none of the three has a device cookie
      const { POST } = await loadRoute();
      const bad: number[] = [];
      for (let i = 0; i < TEN_MINUTES_OF_REPORTS; i++) {
        const sent = [
          fromVenue(tvBatch({ sid: "tv-page-load-1", sent: Date.now(), ev: events() })),
          fromVenue(hostBatch({ sid: "host-laptop-1", sent: Date.now(), ev: events() }), HOST_COOKIE),
          fromVenue(hostBatch({ sid: "host-phone-01", sent: Date.now(), ev: events() }), HOST_COOKIE),
        ];
        for (const request of sent) {
          const res = await POST(request);
          if (res.status !== 204) bad.push(res.status);
        }
        vi.advanceTimersByTime(10_000);
      }
      expect(bad).toEqual([]);
    });

    it("never turns away 40 phones sharing one address (they have cookies) over ten minutes", async () => {
      vi.useFakeTimers();
      const { POST } = await loadRoute();
      const bad: number[] = [];
      for (let i = 0; i < TEN_MINUTES_OF_REPORTS; i++) {
        for (let phone = 0; phone < 40; phone++) {
          authMock.getDeviceId.mockResolvedValue(`00000000-0000-4000-8000-${String(phone).padStart(12, "0")}`);
          const res = await POST(fromVenue(batch({ sid: `phone-session-${phone}`, sent: Date.now(), ev: events() })));
          if (res.status !== 204) bad.push(res.status);
        }
        vi.advanceTimersByTime(10_000);
      }
      expect(bad).toEqual([]);
    });

    it("stops a TV sender that keeps inventing new page-load ids for one night", async () => {
      authMock.getDeviceId.mockResolvedValue(null);
      const { POST } = await loadRoute();
      const statuses: number[] = [];
      for (let i = 0; i < 40; i++) {
        statuses.push((await POST(fromVenue(tvBatch({ sid: `invented-${i}-xyz` })))).status);
      }
      expect(statuses.filter((s) => s === 204)).toHaveLength(30);
      expect(statuses.slice(30).every((s) => s === 429)).toBe(true);
    });

    it("never turns away three TVs on one night (and a TV that reloads) over ten minutes", async () => {
      vi.useFakeTimers();
      authMock.getDeviceId.mockResolvedValue(null);
      const { POST } = await loadRoute();
      const bad: number[] = [];
      for (let i = 0; i < 60; i++) {
        for (const sid of ["tv-page-load-1", "tv-page-load-2", "tv-page-load-3"]) {
          // every so often a TV reloads and starts a new page load
          const id = i % 15 === 0 ? `${sid}-reload-${i}` : sid;
          const res = await POST(fromVenue(tvBatch({ sid: id, sent: Date.now(), ev: events() })));
          if (res.status !== 204) bad.push(res.status);
        }
        vi.advanceTimersByTime(10_000);
      }
      expect(bad).toEqual([]);
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
      // Nothing was scheduled for the refused ones.
      expect(writeMock.scheduleDiagWrite.mock.calls.length).toBe(ok);
    });

    it("does not let one noisy address use up another address's allowance", async () => {
      const { POST } = await loadRoute();
      authMock.getDeviceId.mockResolvedValue(null);
      for (let i = 0; i < 200; i++) await POST(fromVenue(tvBatch({ sid: `noisy-${i}-abc` })));
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

  describe("a phone", () => {
    it("needs a device cookie; without one nothing is stored (it is only counted)", async () => {
      authMock.getDeviceId.mockResolvedValue(null);
      const { POST } = await loadRoute();
      expect((await POST(report(batch()))).status).toBe(401);
      expect(writeMock.scheduleDiagWrite).not.toHaveBeenCalled();
      expect(writeMock.noteIgnored).toHaveBeenCalledWith("report");
    });

    it("names its night by its room code only; a night id it sends is ignored", async () => {
      const { POST } = await loadRoute();
      await POST(report(batch({ night: OTHER_NIGHT_ID })));
      await flushScheduled();
      expect(writeMock.lookupRoomNight).toHaveBeenCalledWith("K9PR4M");
      expect(writeMock.lookupPlayerId).toHaveBeenCalledWith(NIGHT_ID, DEVICE_ID);
      expect(stored()[0]!.rows.every((r) => r.night_id === NIGHT_ID)).toBe(true);
      expect(JSON.stringify(stored())).not.toContain(OTHER_NIGHT_ID);
      // a report with only a night id and no room code names nothing
      expect((await POST(report(batch({ room: undefined, night: NIGHT_ID })))).status).toBe(400);
    });

    it("accepts a room code written the way it is shown on the screen", async () => {
      const { POST } = await loadRoute();
      expect((await POST(report(batch({ room: "K9P·R4M" })))).status).toBe(204);
      await flushScheduled();
      expect(writeMock.lookupRoomNight).toHaveBeenCalledWith("K9PR4M");
    });

    it("stores nothing when its cookie is not a player of that night, or the room does not exist", async () => {
      const { POST } = await loadRoute();
      writeMock.lookupPlayerId.mockResolvedValue(null);
      await POST(report(batch()));
      await flushScheduled();
      expect(writeMock.recordDiagRows).not.toHaveBeenCalled();
      expect(writeMock.noteIgnored).toHaveBeenCalledWith("report");

      writeMock.scheduleDiagWrite.mockClear();
      writeMock.noteIgnored.mockClear();
      writeMock.lookupRoomNight.mockResolvedValue(null);
      await POST(report(batch({ sid: "another-load-1" })));
      await flushScheduled();
      expect(writeMock.recordDiagRows).not.toHaveBeenCalled();
      expect(writeMock.noteIgnored).toHaveBeenCalledWith("report");
    });

    it("a room or player check that is too slow to answer is 'could not check' (counted as slow by the scheduler), not a stranger", async () => {
      const { POST } = await loadRoute();
      writeMock.lookupPlayerId.mockRejectedValue(Object.assign(new Error("slow"), { name: "DiagLookupSlow" }));
      expect((await POST(report(batch()))).status).toBe(204); // the reply is the same
      await flushScheduled().catch(() => {});
      expect(writeMock.recordDiagRows).not.toHaveBeenCalled();
      expect(writeMock.noteIgnored).not.toHaveBeenCalled();
    });

    it("cannot send the kinds only the TV and host laptop produce, or any field off the list", async () => {
      const { POST } = await loadRoute();
      const now = Date.now();
      await POST(
        report(
          batch({
            ev: [
              { t: now - 500, k: "fps", d: { fps: 60, scene: "october" } },
              { t: now - 400, k: "bcast", d: { ev: "reveal", lag: 5, planted: "x".repeat(900), cookie: "secret" } },
              { t: now - 300, k: "tap", d: { q: "11111111-1111-1111-1111-111111111111", slot: 2, ok: true, extra: 1 } },
            ],
          }),
        ),
      );
      await flushScheduled();
      const rows = stored()[0]!.rows;
      expect(rows.map((r) => r.kind)).toEqual(["bcast", "tap"]);
      expect(rows[0]!.data).toEqual({ ev: "reveal", lag: 5 });
      expect(rows[1]!.data).toEqual({ q: "11111111-1111-1111-1111-111111111111", slot: 2, ok: true });
      expect(JSON.stringify(rows)).not.toContain("secret");
    });
  });

  describe("the TV (no login, no cookie): it needs the signed pass its page was given", () => {
    beforeEach(() => authMock.getDeviceId.mockResolvedValue(null));

    it("takes a TV report with a good pass; the night comes from the pass, no device id is stored", async () => {
      const { POST } = await loadRoute();
      expect((await POST(report(tvBatch()))).status).toBe(204);
      await flushScheduled();
      const { table, rows, night, source } = stored()[0]!;
      expect(table).toBe("diag_device_events");
      expect(night).toBe(NIGHT_ID);
      expect(source).toEqual({ kind: "tv" });
      expect(rows[0]!.device_id).toBeNull();
      expect(rows.every((r) => r.night_id === NIGHT_ID && r.surface === "tv")).toBe(true);
      expect((rows[0]!.data as Record<string, unknown>).dc).toBe("tv");
      // The TV needs no database lookup for its night at all.
      expect(writeMock.lookupRoomNight).not.toHaveBeenCalled();
      expect(writeMock.lookupNightOwner).not.toHaveBeenCalled();
    });

    it("ignores any room code or night id a TV sends: only the pass names the night", async () => {
      const { POST } = await loadRoute();
      await POST(report(tvBatch({ room: "K9PR4M", night: OTHER_NIGHT_ID })));
      await flushScheduled();
      expect(stored()[0]!.night).toBe(NIGHT_ID);
      expect(JSON.stringify(stored())).not.toContain(OTHER_NIGHT_ID);
    });

    it("refuses a report with no pass, even for a real room code or night", async () => {
      const { POST } = await loadRoute();
      for (const extra of [{ tok: undefined, room: "K9PR4M" }, { tok: undefined, night: NIGHT_ID }, { tok: undefined }]) {
        expect((await POST(report(tvBatch(extra)))).status).toBe(400);
      }
      expect(writeMock.scheduleDiagWrite).not.toHaveBeenCalled();
    });

    it("refuses a forged pass, a pass for another night with this night's signature, and a pass signed with another secret", async () => {
      const { POST } = await loadRoute();
      const good = signTvPass(NIGHT_ID)!;
      const parts = good.split(".");
      const forged = [
        `${parts[0]}.${parts[1]}.${parts[2]}.${"A".repeat(43)}`, // wrong signature
        `${parts[0]}.${OTHER_NIGHT_ID}.${parts[2]}.${parts[3]}`, // moved to another night
        `${parts[0]}.${parts[1]}.${(Math.floor(Date.now() / 1000) + 90_000_000).toString(36)}.${parts[3]}`, // longer life
        "v1.not.a.pass-at-all-but-long-enough-to-pass-the-shape-check",
      ];
      vi.stubEnv("SESSION_SECRET", "a-different-secret-entirely-0123456789");
      forged.push(signTvPass(NIGHT_ID)!); // signed by someone with a different secret
      vi.stubEnv("SESSION_SECRET", SECRET);
      let n = 0;
      for (const tok of forged) {
        const res = await POST(report(tvBatch({ tok, sid: `forged-pass-${n++}-abc` })));
        expect(res.status, tok).toBe(401);
      }
      expect(writeMock.scheduleDiagWrite).not.toHaveBeenCalled();
      expect(writeMock.noteIgnored).toHaveBeenCalledWith("report");
    });

    it("stops working when the pass runs out (8 hours)", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-07T23:00:00Z"));
      const { POST } = await loadRoute();
      const tok = signTvPass(NIGHT_ID)!;
      expect((await POST(report(tvBatch({ tok, sent: Date.now(), ev: events() })))).status).toBe(204);
      vi.setSystemTime(new Date("2026-10-08T06:59:00Z")); // just under 8 hours later
      expect((await POST(report(tvBatch({ tok, sent: Date.now(), ev: events() })))).status).toBe(204);
      vi.setSystemTime(new Date("2026-10-08T07:01:00Z"));
      expect((await POST(report(tvBatch({ tok, sent: Date.now(), ev: events(), sid: "tv-page-load-2" })))).status).toBe(401);
    });

    it("a pass is no use to a phone", async () => {
      const { POST } = await loadRoute();
      authMock.getDeviceId.mockResolvedValue(DEVICE_ID);
      expect((await POST(report(batch({ tok: signTvPass(NIGHT_ID), room: undefined })))).status).toBe(400);
    });

    it("cannot use up the allowance of a night it has no pass for", async () => {
      const { POST } = await loadRoute();
      for (let i = 0; i < 40; i++) await POST(report(tvBatch({ sid: `flood-${i}-abcd` })));
      // another night's TV is untouched (another address, so only the per-night limit is in play)
      const other = await POST(
        report(tvBatch({ sid: "other-night-tv" }, OTHER_NIGHT_ID), { "x-forwarded-for": "198.51.100.77" }),
      );
      expect(other.status).toBe(204);
    });

    it("cannot send phone-only kinds, and everything it sends is rebuilt from the fixed lists", async () => {
      const { POST } = await loadRoute();
      const now = Date.now();
      await POST(
        report(
          tvBatch({
            ev: [
              { t: now - 500, k: "tap", d: { slot: 1 } },
              { t: now - 400, k: "fps", d: { fps: 58.26, slow: 1, worst: 90, n: 120, scene: "october", note: "hello" } },
              { t: now - 300, k: "chan", d: { from: "SUBSCRIBED", to: "x".repeat(300), other: "x" } },
            ],
          }),
        ),
      );
      await flushScheduled();
      const rows = stored()[0]!.rows;
      expect(rows.map((r) => r.kind)).toEqual(["fps", "chan"]);
      expect(rows[0]!.data).toEqual({ fps: 58.3, slow: 1, worst: 90, n: 120, scene: "october" });
      expect(rows[1]!.data).toEqual({ from: "SUBSCRIBED", to: "x".repeat(24) });
    });
  });

  describe("the host laptop and phone", () => {
    beforeEach(() => authMock.getDeviceId.mockResolvedValue(null));

    it("answers 204 BEFORE any sign-in check runs: the host screen never waits on the sign-in service", async () => {
      const { POST } = await loadRoute();
      const res = await POST(report(hostBatch(), HOST_COOKIE));
      expect(res.status).toBe(204);
      expect(signIn.getUser).not.toHaveBeenCalled();
      expect(adminMock.getSupabaseAdmin).not.toHaveBeenCalled();
      expect(writeMock.lookupNightOwner).not.toHaveBeenCalled();
      expect(writeMock.recordDiagRows).not.toHaveBeenCalled();
      await flushScheduled();
      expect(signIn.getUser).toHaveBeenCalledTimes(1);
      expect(signIn.getUser).toHaveBeenCalledWith(ACCESS_TOKEN); // the browser's own token, as it is
      expect(writeMock.lookupNightOwner).toHaveBeenCalledWith(NIGHT_ID);
      expect(stored()[0]).toMatchObject({ night: NIGHT_ID, source: { kind: "host" } });
      expect(stored()[0]!.rows[0]).toMatchObject({ night_id: NIGHT_ID, surface: "host", device_id: null });
    });

    it("with no sign-in cookie at all it is turned away without asking anyone", async () => {
      const { POST } = await loadRoute();
      expect((await POST(report(hostBatch()))).status).toBe(401);
      expect(writeMock.scheduleDiagWrite).not.toHaveBeenCalled();
      expect(signIn.getUser).not.toHaveBeenCalled();
      expect(writeMock.noteIgnored).toHaveBeenCalledWith("report");
      // a device cookie is not a sign-in cookie
      expect((await POST(report(hostBatch({ sid: "host-laptop-2" }), { cookie: "tr1via_device=x.y" }))).status).toBe(401);
    });

    it("stores nothing when the sign-in service does not accept the token or the host does not own the night", async () => {
      const { POST } = await loadRoute();
      signIn.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401, name: "AuthApiError" } });
      expect((await POST(report(hostBatch(), HOST_COOKIE))).status).toBe(204); // the reply is the same
      await flushScheduled();
      expect(writeMock.recordDiagRows).not.toHaveBeenCalled();

      writeMock.scheduleDiagWrite.mockClear();
      signIn.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
      writeMock.lookupNightOwner.mockResolvedValue("someone-else");
      await POST(report(hostBatch({ sid: "host-laptop-2" }), hostCookie("another-token")));
      await flushScheduled();
      expect(writeMock.recordDiagRows).not.toHaveBeenCalled();
      expect(writeMock.noteIgnored).toHaveBeenCalledWith("report");
    });

    it("a signed-in user who is not a host stores nothing", async () => {
      const { POST } = await loadRoute();
      signIn.hostRow.mockResolvedValue({ data: null, error: null });
      await POST(report(hostBatch(), HOST_COOKIE));
      await flushScheduled();
      expect(writeMock.recordDiagRows).not.toHaveBeenCalled();
      expect(writeMock.noteIgnored).toHaveBeenCalledWith("report");
    });

    it("an access token that has already run out is dropped and counted, with no call to the sign-in service", async () => {
      const { POST } = await loadRoute();
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      try {
        expect((await POST(report(hostBatch(), hostCookie(ACCESS_TOKEN, -30)))).status).toBe(204); // same quick reply
        await flushScheduled();
        expect(writeMock.recordDiagRows).not.toHaveBeenCalled();
        expect(writeMock.noteIgnored).toHaveBeenCalledWith("report");
        expect(signIn.createClient).not.toHaveBeenCalled();
        expect(signIn.getUser).not.toHaveBeenCalled();
        expect(adminMock.getSupabaseAdmin).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("trouble reaching the sign-in service is counted as 'could not check', not as a stranger, and the reply is unchanged", async () => {
      const { POST } = await loadRoute();
      signIn.getUser.mockResolvedValue({ data: { user: null }, error: { status: 503, name: "AuthApiError" } });
      expect((await POST(report(hostBatch(), HOST_COOKIE))).status).toBe(204);
      const task = writeMock.scheduleDiagWrite.mock.calls[0]![0] as () => Promise<void>;
      // (the route module is freshly loaded for every test, so compare by name)
      await expect(task()).rejects.toMatchObject({ name: "DiagLookupSlow" }); // scheduleDiagWrite counts this as "slow"
      expect(writeMock.recordDiagRows).not.toHaveBeenCalled();
    });

    it("NEVER renews a session or writes an auth cookie, whatever the cookie holds", async () => {
      const { POST } = await loadRoute();
      const cases: Array<[string, Record<string, string>]> = [
        ["a good session", hostCookie()],
        ["a session about to run out", hostCookie(ACCESS_TOKEN, 5)],
        ["a session that has run out", hostCookie(ACCESS_TOKEN, -3600)],
        ["a garbage cookie", { cookie: "sb-localproj-auth-token=base64-%%%" }],
        ["a chunked cookie", { cookie: "sb-localproj-auth-token.0=base64-AAAA; sb-localproj-auth-token.1=BBBB" }],
      ];
      let n = 0;
      for (const [, headers] of cases) {
        await POST(report(hostBatch({ sid: `host-session-${n++}-abc` }), headers));
        await flushScheduled().catch(() => {});
        writeMock.scheduleDiagWrite.mockClear();
      }
      // sign-in service failing, and not accepting the token, too
      signIn.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401, name: "AuthApiError" } });
      await POST(report(hostBatch({ sid: "host-session-x-abc" }), hostCookie("a-different-token")));
      await flushScheduled().catch(() => {});

      for (const spy of [
        signIn.refreshSession,
        signIn.setSession,
        signIn.getSession,
        signIn.signOut,
        signIn.cookieSet, // no cookie is ever written...
        signIn.cookieDelete, // ...or cleared
        signIn.createServerClient, // the cookie-writing client is never even built
        authMock.getAuthedHost, // and neither is the normal check, which can renew
      ]) {
        expect(spy).not.toHaveBeenCalled();
      }
      // The only thing ever asked of the sign-in service: who owns this exact token.
      for (const call of signIn.getUser.mock.calls) expect(call).toHaveLength(1);
      // The throwaway client cannot renew or remember a session.
      for (const call of signIn.createClient.mock.calls) {
        expect(call[2]).toEqual({ auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      }
    });

    it("a session that passed a moment ago is remembered, so reports do not add a sign-in call each", async () => {
      vi.useFakeTimers();
      const { POST } = await loadRoute();
      for (let i = 0; i < 6; i++) {
        await POST(report(hostBatch({ sent: Date.now(), ev: events() }), HOST_COOKIE));
        await flushScheduled();
        writeMock.scheduleDiagWrite.mockClear();
        vi.advanceTimersByTime(10_000);
      }
      expect(signIn.getUser).toHaveBeenCalledTimes(1);
      expect(writeMock.recordDiagRows).toHaveBeenCalledTimes(6);

      // another session is checked on its own
      await POST(
        report(hostBatch({ sent: Date.now(), ev: events(), sid: "host-phone-01" }), hostCookie("phone-token")),
      );
      await flushScheduled();
      expect(signIn.getUser).toHaveBeenCalledTimes(2);
      writeMock.scheduleDiagWrite.mockClear();

      // and the memory runs out after a few minutes
      vi.advanceTimersByTime(6 * 60_000);
      await POST(report(hostBatch({ sent: Date.now(), ev: events() }), hostCookie()));
      await flushScheduled();
      expect(signIn.getUser).toHaveBeenCalledTimes(3);
    });

    it("a failed sign-in check is never remembered", async () => {
      const { POST } = await loadRoute();
      signIn.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401, name: "AuthApiError" } });
      await POST(report(hostBatch(), HOST_COOKIE));
      await flushScheduled();
      writeMock.scheduleDiagWrite.mockClear();
      signIn.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
      await POST(report(hostBatch({ sid: "host-laptop-2" }), HOST_COOKIE));
      await flushScheduled();
      expect(signIn.getUser).toHaveBeenCalledTimes(2);
      expect(writeMock.recordDiagRows).toHaveBeenCalledTimes(1);
    });

    it("needs a night id; a room code names nothing for a host", async () => {
      const { POST } = await loadRoute();
      expect((await POST(report(hostBatch({ night: undefined, room: "K9PR4M" }), HOST_COOKIE))).status).toBe(400);
      expect(writeMock.scheduleDiagWrite).not.toHaveBeenCalled();
    });
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
    const rows = stored()[0]!.rows;
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
