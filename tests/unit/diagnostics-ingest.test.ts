// Intake rules for device reports: shape, size, allowlist, rate limit.

import { describe, expect, it } from "vitest";
import {
  DIAG_EVENT_FIELDS,
  cleanDeviceData,
  cleanEventFields,
  cleanNetData,
  createRateLimiter,
  sanitizeBatch,
  summarizeDevice,
} from "@/lib/diagnostics/ingest";
import {
  DIAG_DEVICE_CLASSES,
  DIAG_DEVICE_KEYS,
  DIAG_DEVICE_KINDS,
  DIAG_NET_KEYS,
  DIAG_MAX_EVENTS_PER_BATCH,
  DIAG_SURFACE_KINDS,
  diagnosticsEnabled,
} from "@/lib/diagnostics/config";

const NOW = 1_791_400_000_000;
const base = { surface: "player", room: "K9PR4M", sid: "abc123def456", sent: NOW };

describe("diagnosticsEnabled", () => {
  it("is off unless exactly 'on'", () => {
    expect(diagnosticsEnabled({})).toBe(false);
    expect(diagnosticsEnabled({ DIAGNOSTIC_LOGGING: "" })).toBe(false);
    expect(diagnosticsEnabled({ DIAGNOSTIC_LOGGING: "off" })).toBe(false);
    expect(diagnosticsEnabled({ DIAGNOSTIC_LOGGING: "1" })).toBe(false);
    expect(diagnosticsEnabled({ DIAGNOSTIC_LOGGING: "true" })).toBe(false);
    expect(diagnosticsEnabled({ DIAGNOSTIC_LOGGING: "on" })).toBe(true);
    expect(diagnosticsEnabled({ DIAGNOSTIC_LOGGING: " ON " })).toBe(true);
  });
});

describe("sanitizeBatch", () => {
  it("accepts a normal batch and keeps only allowlisted fields", () => {
    const batch = sanitizeBatch({
      ...base,
      ev: [{ t: NOW - 500, k: "bcast", d: { ev: "reveal", lag: 120, evil: undefined }, f: 1, extra: "x" }],
      cookie: "secret",
    });
    expect(batch).toEqual({
      surface: "player",
      room: "K9PR4M",
      night: null,
      pass: null,
      sid: "abc123def456",
      sentAt: NOW,
      events: [{ t: NOW - 500, k: "bcast", d: { ev: "reveal", lag: 120 }, forced: true }],
    });
  });

  it("rejects bad surfaces, session ids, clocks and missing rooms", () => {
    expect(sanitizeBatch({ ...base, surface: "admin", ev: [] })).toBeNull();
    expect(sanitizeBatch({ ...base, sid: "x", ev: [] })).toBeNull();
    expect(sanitizeBatch({ ...base, sent: 5, ev: [] })).toBeNull();
    expect(sanitizeBatch({ ...base, sent: 1e20, ev: [] })).toBeNull();
    expect(sanitizeBatch({ ...base, room: undefined, ev: [] })).toBeNull();
    expect(sanitizeBatch("nope")).toBeNull();
    expect(sanitizeBatch(null)).toBeNull();
    expect(sanitizeBatch([])).toBeNull();
  });

  it("takes a host batch by night id", () => {
    const night = "11111111-1111-1111-1111-111111111111";
    const batch = sanitizeBatch({ surface: "host", night, sid: "abc123def456", sent: NOW, ev: [] });
    expect(batch?.night).toBe(night);
    expect(sanitizeBatch({ surface: "host", night: "not-a-uuid", sid: "abc123def456", sent: NOW, ev: [] })).toBeNull();
    // A host that sends a room code instead of its night names nobody.
    expect(sanitizeBatch({ surface: "host", room: "K9PR4M", sid: "abc123def456", sent: NOW, ev: [] })).toBeNull();
  });

  it("takes a TV batch only with its pass, and ignores any room code or night id a TV sends", () => {
    const pass = "v1.11111111-1111-1111-1111-111111111111.abc.sig_sig_sig_sig_sig_sig_sig_sig_sig_sig_sig_sig";
    const night = "22222222-2222-2222-2222-222222222222";
    const tv = { surface: "tv", sid: "abc123def456", sent: NOW, ev: [] };
    expect(sanitizeBatch({ ...tv, room: "K9PR4M" })).toBeNull(); // a room code is not a pass
    expect(sanitizeBatch({ ...tv, night })).toBeNull(); // neither is a night id
    expect(sanitizeBatch({ ...tv, tok: "short" })).toBeNull();
    const batch = sanitizeBatch({ ...tv, tok: pass, room: "K9PR4M", night });
    expect(batch).toMatchObject({ surface: "tv", pass, room: null, night: null });
    // A phone cannot use a pass, and cannot name a night either.
    expect(sanitizeBatch({ ...base, tok: pass, room: undefined, ev: [] })).toBeNull();
    expect(sanitizeBatch({ ...base, night, ev: [] })).toMatchObject({ room: "K9PR4M", night: null });
  });

  it("drops unknown event types and bad times, and caps the batch size", () => {
    const events = [
      { t: NOW, k: "keylog", d: {} }, // not allowlisted
      { t: "now", k: "net", d: {} }, // not a time
      { t: NOW - 31 * 60_000, k: "net", d: {} }, // stale
      { t: NOW + 120_000, k: "net", d: {} }, // from the future
      { t: NOW - 10, k: "net", d: { ev: "online" } }, // good
    ];
    const batch = sanitizeBatch({ ...base, ev: events });
    expect(batch?.events.map((e) => e.k)).toEqual(["net"]);

    const many = Array.from({ length: 500 }, () => ({ t: NOW, k: "net", d: {} }));
    expect(sanitizeBatch({ ...base, ev: many })?.events).toHaveLength(DIAG_MAX_EVENTS_PER_BATCH);
  });

  it("accepts every declared kind, each only from the screens that produce it", () => {
    const ev = DIAG_DEVICE_KINDS.map((k) => ({ t: NOW, k, d: {} }));
    const night = "11111111-1111-1111-1111-111111111111";
    const pass = "v1.11111111-1111-1111-1111-111111111111.abc.sig_sig_sig_sig_sig_sig_sig_sig_sig_sig_sig_sig";
    const roots = {
      player: { ...base },
      host: { surface: "host", night, sid: "abc123def456", sent: NOW },
      tv: { surface: "tv", tok: pass, sid: "abc123def456", sent: NOW },
    } as const;
    for (const surface of ["player", "host", "tv"] as const) {
      const kept = sanitizeBatch({ ...roots[surface], ev })?.events.map((e) => e.k);
      expect(kept).toEqual(DIAG_SURFACE_KINDS[surface]);
    }
    // taps come only from phones; frame rates only from the TV and the host laptop
    expect(DIAG_SURFACE_KINDS.tv).not.toContain("tap");
    expect(DIAG_SURFACE_KINDS.host).not.toContain("tapx");
    expect(DIAG_SURFACE_KINDS.player).not.toContain("fps");
  });
});

describe("every event kind is rebuilt from a fixed list of fields", () => {
  it("has a list for every kind, and nothing else", () => {
    expect(Object.keys(DIAG_EVENT_FIELDS).sort()).toEqual([...DIAG_DEVICE_KINDS].sort());
  });

  it("throws away any field that is not on the list, for every kind", () => {
    for (const kind of DIAG_DEVICE_KINDS) {
      const data = cleanEventFields(kind, {
        planted: "x",
        cookie: "secret",
        ua: "Mozilla/5.0",
        nested: { a: 1 },
        list: [1, 2],
        "bad key!": 1,
        fn: () => 1,
      });
      expect(data).toEqual({});
    }
  });

  it("keeps only listed fields of the right type, rounds and clamps numbers", () => {
    expect(
      cleanEventFields("bcast", { ev: "reveal", lag: 120.7, srv: 1_791_400_000_000, junk: 1 }),
    ).toEqual({ ev: "reveal", lag: 121, srv: 1_791_400_000_000 });
    // numbers are clamped into their range, not stored as sent
    expect(cleanEventFields("bcast", { lag: 9e15 })).toEqual({ lag: 1_000_000_000 });
    expect(cleanEventFields("lt", { n: -4, max: 1e12, sum: Infinity, win: NaN })).toEqual({ n: 0, max: 600_000 });
    expect(cleanEventFields("fps", { fps: 59.94, slow: 3, worst: 80, n: 120, scene: "october" })).toEqual({
      fps: 59.9,
      slow: 3,
      worst: 80,
      n: 120,
      scene: "october",
    });
    // a number where a word is wanted (and the other way round) is dropped
    expect(cleanEventFields("bcast", { ev: 5, lag: "5" })).toEqual({});
  });

  it("takes text fields only from fixed words", () => {
    expect(cleanEventFields("vis", { ev: "hidden" })).toEqual({ ev: "hidden" });
    expect(cleanEventFields("vis", { ev: "<script>" })).toEqual({});
    expect(cleanEventFields("ribbon", { from: "start", to: "offline", reach: "ok", bk: true, ol: false })).toEqual({
      from: "start",
      to: "offline",
      reach: "ok",
      bk: true,
      ol: false,
    });
    expect(cleanEventFields("ribbon", { from: "a free-text story", to: "online" })).toEqual({ to: "online" });
    expect(cleanEventFields("reach", { from: "ok", to: "somewhere else" })).toEqual({ from: "ok" });
    expect(cleanEventFields("tapx", { q: "11111111-1111-1111-1111-111111111111", slot: 9, why: "closed" })).toEqual({
      q: "11111111-1111-1111-1111-111111111111",
      slot: 4,
      why: "closed",
    });
    expect(cleanEventFields("tapx", { q: "not-a-uuid", why: "because" })).toEqual({});
    // a status can be a number or the one word "network"
    expect(cleanEventFields("tap", { st: 409 })).toEqual({ st: 409 });
    expect(cleanEventFields("tap", { st: "network" })).toEqual({ st: "network" });
    expect(cleanEventFields("tap", { st: "anything else" })).toEqual({});
  });

  it("holds the little free text there is to 40 characters of plain symbols", () => {
    const data = cleanEventFields("res", { p: "/api/games/:id/advance", ms: 1234.4, st: 500 });
    expect(data).toEqual({ p: "/api/games/:id/advance", ms: 1234, st: 500 });
    // too long: cut at the limit
    expect((cleanEventFields("snap", { err: "x".repeat(500) }).err as string).length).toBe(40);
    expect((cleanEventFields("bcast", { ev: "y".repeat(500) }).ev as string).length).toBe(40);
    // anything with a query string, quotes, markup or control characters is dropped whole
    for (const bad of ["/api/x?token=SECRET", "a\u0000b", "name\nnext", "<b>", "it's", "x;drop table", "é"]) {
      expect(cleanEventFields("snap", { err: bad, w: bad })).toEqual({});
    }
    expect(cleanEventFields("snap", { err: "" })).toEqual({});
  });

  it("never returns anything for non-objects", () => {
    for (const kind of DIAG_DEVICE_KINDS) {
      for (const junk of [null, undefined, "str", 5, [1, 2], true]) {
        expect(cleanEventFields(kind, junk)).toEqual({});
      }
    }
  });

  it("stores nothing a payload bomb could carry: output size is bounded by the lists", () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 500; i++) big[`k${i}`] = "y".repeat(5000);
    for (const kind of DIAG_DEVICE_KINDS) {
      expect(JSON.stringify(cleanEventFields(kind, big)).length).toBeLessThanOrEqual(2);
    }
  });
});

describe("createRateLimiter", () => {
  it("allows a burst, then one per refill period, per key", () => {
    let now = 0;
    const limiter = createRateLimiter({ capacity: 3, refillMs: 1000, now: () => now });
    expect([1, 2, 3, 4].map(() => limiter.allow("a"))).toEqual([true, true, true, false]);
    expect(limiter.allow("b")).toBe(true); // another key is unaffected
    now = 999;
    expect(limiter.allow("a")).toBe(false);
    now = 1000;
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
  });

  it("keeps memory bounded under a flood of new keys", () => {
    const limiter = createRateLimiter({ capacity: 1, refillMs: 1000, maxKeys: 5, now: () => 0 });
    for (let i = 0; i < 100; i++) limiter.allow(`k${i}`);
    // The oldest keys were forgotten, so they get a fresh allowance again.
    expect(limiter.allow("k0")).toBe(true);
  });
});

describe("what a device may say about itself", () => {
  const crafted = {
    // the good ones
    sc: "m",
    ol: true,
    rm: false,
    theme: "october",
    et: "4g",
    ty: "wifi",
    rtt: 74.6,
    dl: 9.54,
    // the ones an old cached page or a crafted request might still send
    s: "player",
    w: 390,
    h: 844,
    dpr: 3,
    cores: 6,
    mem: 4,
    app: true,
    sd: true,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)",
    uas: "iPhone · iOS 17.5 · Safari 17.5",
    br: "Totally Real Browser 99",
    os: "BeOS",
    dc: "toaster",
  };

  it("keeps only the fixed list of keys in a device event, whatever was sent", () => {
    const data = cleanDeviceData(crafted);
    expect(Object.keys(data).sort()).toEqual(["dl", "et", "ol", "rm", "rtt", "sc", "theme", "ty"]);
    expect(Object.keys(data).every((key) => (DIAG_DEVICE_KEYS as readonly string[]).includes(key))).toBe(true);
    expect(data).toEqual({ sc: "m", ol: true, rm: false, theme: "october", et: "4g", ty: "wifi", rtt: 75, dl: 9.5 });
  });

  it("never takes the browser, OS or device class from the device (the server adds those)", () => {
    const data = cleanDeviceData({ br: "Chrome 1", os: "iOS", dc: "phone" });
    expect(data).toEqual({});
  });

  it("drops values outside the allowed vocabulary and ranges", () => {
    // words outside the list are dropped; numbers are clamped into range
    expect(
      cleanDeviceData({ sc: "gigantic", et: "5g", ty: "carrier-pigeon", rtt: -5, dl: 1e9, theme: "not ok!", ol: "yes" }),
    ).toEqual({ rtt: 0, dl: 10_000 });
    expect(cleanDeviceData("nope")).toEqual({});
    expect(cleanDeviceData(null)).toEqual({});
    expect(cleanDeviceData([1, 2])).toEqual({});
  });

  it("rebuilds net events the same way", () => {
    const data = cleanNetData({ ev: "conn", ol: true, et: "3g", rtt: 300, w: 390, mem: 4, sd: true, ua: "x" });
    expect(data).toEqual({ ev: "conn", ol: true, et: "3g", rtt: 300 });
    expect(Object.keys(data).every((key) => (DIAG_NET_KEYS as readonly string[]).includes(key))).toBe(true);
    expect(cleanNetData({ ev: "explode" })).toEqual({});
  });

  it("is applied to device and net events inside a batch, and the other kinds have their own lists", () => {
    const batch = sanitizeBatch({
      ...base,
      ev: [
        { t: NOW - 100, k: "device", d: crafted },
        { t: NOW - 90, k: "net", d: { ev: "online", ol: true, w: 390, mem: 4 } },
        { t: NOW - 80, k: "bcast", d: { ev: "reveal", lag: 5 } },
      ],
    });
    expect(batch!.events[0]!.d).toEqual(cleanDeviceData(crafted));
    expect(batch!.events[1]!.d).toEqual({ ev: "online", ol: true });
    expect(batch!.events[2]!.d).toEqual({ ev: "reveal", lag: 5 });
  });
});

describe("summarizeDevice", () => {
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5.1 Mobile/15E148 Safari/604.1";
  const PIXEL =
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36";
  const MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

  it("gives the browser family and major version, the OS family and the device class, nothing more", () => {
    expect(summarizeDevice(IPHONE, "player")).toEqual({ br: "Safari 17", os: "iOS", dc: "phone" });
    expect(summarizeDevice(PIXEL, "player")).toEqual({ br: "Chrome 126", os: "Android", dc: "phone" });
    expect(summarizeDevice(MAC, "host")).toEqual({ br: "Chrome 126", os: "macOS", dc: "laptop" });
  });

  it("never carries the phone model, the OS version or a minor version", () => {
    const all = JSON.stringify([IPHONE, PIXEL, MAC].map((ua) => summarizeDevice(ua, "player")));
    for (const leaked of ["Pixel", "17.5", "17_5", "14", "10_15", "126.0", "605", "Mobile"]) {
      expect(all).not.toContain(leaked);
    }
  });

  it("tells tablets, TVs and in-app pages apart", () => {
    expect(
      summarizeDevice(
        "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        "host",
      ),
    ).toEqual({ br: "Safari 17", os: "iPadOS", dc: "tablet" });
    expect(
      summarizeDevice(
        "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "player",
      ).dc,
    ).toBe("tablet");
    // The TV screen is a TV whatever is plugged in behind it.
    expect(summarizeDevice(MAC, "tv").dc).toBe("tv");
    expect(summarizeDevice("Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36 Chrome/94 TV Safari/537.36", "player").dc).toBe("tv");
    expect(summarizeDevice(IPHONE + " [FBAN/FBIOS;FBAV/450.0]", "player").br).toBe("Safari 17 (Facebook app)");
  });

  it("handles missing or odd text without throwing, and always returns known classes", () => {
    expect(summarizeDevice("", "player")).toEqual({ br: "unknown", os: "unknown", dc: "unknown" });
    expect(summarizeDevice(null, "tv")).toEqual({ br: "unknown", os: "unknown", dc: "tv" });
    const odd = summarizeDevice("\u0000weird\u0007 agent", "player");
    expect(odd.br).toBe("other");
    for (const ua of [IPHONE, PIXEL, MAC, "", "x"]) {
      expect(DIAG_DEVICE_CLASSES).toContain(summarizeDevice(ua, "player").dc);
    }
  });
});
