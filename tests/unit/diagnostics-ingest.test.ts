// Intake rules for device reports: shape, size, allowlist, rate limit.

import { describe, expect, it } from "vitest";
import {
  cleanEventData,
  createRateLimiter,
  sanitizeBatch,
  summarizeUserAgent,
} from "@/lib/diagnostics/ingest";
import {
  DIAG_DEVICE_KINDS,
  DIAG_MAX_EVENTS_PER_BATCH,
  DIAG_MAX_EVENT_BYTES,
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

  it("accepts every declared kind", () => {
    const ev = DIAG_DEVICE_KINDS.map((k) => ({ t: NOW, k, d: {} }));
    expect(sanitizeBatch({ ...base, ev })?.events).toHaveLength(DIAG_DEVICE_KINDS.length);
  });
});

describe("cleanEventData", () => {
  it("keeps small primitives and drops functions, odd keys and deep nesting", () => {
    const data = cleanEventData({
      ok: 1,
      s: "text",
      b: true,
      n: null,
      "bad key!": 1,
      fn: () => 1,
      deep: { a: { b: { c: 1 } } },
      list: [1, "two", { x: 1 }],
    });
    expect(data.ok).toBe(1);
    expect(data.s).toBe("text");
    expect(data.b).toBe(true);
    expect(data.n).toBeNull();
    expect(data).not.toHaveProperty("bad key!");
    expect(data).not.toHaveProperty("fn");
    // One level of nesting is kept; deeper objects are dropped.
    expect(data.deep).toEqual({});
    expect(data.list).toEqual([1, "two"]);
  });

  it("strips query strings and cuts long strings and control characters", () => {
    const data = cleanEventData({
      p: "/api/games/abc/advance?token=SECRET#frag",
      long: "x".repeat(500),
      ctl: "a\u0000b\nc",
    });
    expect(data.p).toBe("/api/games/abc/advance");
    expect((data.long as string).length).toBeLessThanOrEqual(80);
    expect(data.ctl).toBe("abc");
  });

  it("replaces an oversized payload instead of storing it", () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 20; i++) big[`k${i}`] = "y".repeat(79);
    const data = cleanEventData(big);
    expect(JSON.stringify(data).length).toBeLessThanOrEqual(DIAG_MAX_EVENT_BYTES);
    expect(data).toEqual({ trunc: true });
  });

  it("never returns non-objects", () => {
    expect(cleanEventData(null)).toEqual({});
    expect(cleanEventData("str")).toEqual({});
    expect(cleanEventData([1, 2])).toEqual({});
    expect(cleanEventData({ n: Infinity })).toEqual({});
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

describe("summarizeUserAgent", () => {
  it("describes common phones and laptops", () => {
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("iPhone · iOS 17.5 · Safari 17.5");
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Pixel 7 · Android 14 · Chrome 126");
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      ),
    ).toBe("macOS 10.15.7 · Chrome 126");
    expect(summarizeUserAgent("")).toBe("unknown");
    expect(summarizeUserAgent(null)).toBe("unknown");
  });
});
