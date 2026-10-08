// The device reporter: batching, quiet while a question is open, sampling
// that never drops slow/failed events, beacon on hide, silent failure.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDiagClientForTests,
  diagActive,
  diagBroadcastHeard,
  diagEvent,
  diagQuestionOpen,
  diagRibbon,
  diagSnap,
  pathTemplate,
} from "@/lib/diagnostics/client";
import { startDeviceReporter } from "@/lib/diagnostics/reporter";

type Sent = {
  surface: string;
  room?: string;
  sid: string;
  sent: number;
  ev: Array<{ t: number; k: string; d?: Record<string, unknown>; f: number }>;
};

let fetchMock: ReturnType<typeof vi.fn>;
let beaconMock: ReturnType<typeof vi.fn>;
let stops: Array<() => void> = [];

function start(options: Parameters<typeof startDeviceReporter>[0]) {
  const stop = startDeviceReporter(options);
  stops.push(stop);
  return stop;
}

function sentBatches(): Sent[] {
  return fetchMock.mock.calls.map((call) => JSON.parse((call[1] as { body: string }).body) as Sent);
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T19:06:00.000Z"));
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  beaconMock = vi.fn(() => true);
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "sendBeacon", { value: beaconMock, configurable: true });
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  vi.spyOn(Math, "random").mockReturnValue(0.5); // jitter lands mid-range; sampled players
  __resetDiagClientForTests();
});

afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  __resetDiagClientForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("while the reporter is not running", () => {
  it("every call is a no-op: no timers, no listeners, no requests", () => {
    expect(diagActive()).toBe(false);
    diagEvent("net", { ev: "offline" }, true);
    diagQuestionOpen(true);
    diagSnap("/api/room/K9PR4M/snapshot", 9000, false, 3, "Error");
    diagBroadcastHeard({ event: "reveal", payload: { serverNow: new Date().toISOString() } });
    diagRibbon("unreachable", {});
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(beaconMock).not.toHaveBeenCalled();
  });
});

describe("batching", () => {
  it("sends one small batch about every 10 seconds, device description first", async () => {
    const startedAt = Date.now();
    start({ surface: "player", room: "K9PR4M" });
    expect(diagActive()).toBe(true);
    diagEvent("net", { ev: "offline" }, true);

    await vi.advanceTimersByTimeAsync(9_000);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; keepalive: boolean; credentials: string }];
    expect(url).toBe("/api/diag/report");
    expect(init).toMatchObject({ method: "POST", keepalive: true, credentials: "same-origin" });
    const [batch] = sentBatches();
    expect(batch!.surface).toBe("player");
    expect(batch!.room).toBe("K9PR4M");
    expect(batch!.sid).toMatch(/^[a-z0-9]{6,}$/);
    expect(batch!.ev.map((e) => e.k)).toEqual(["device", "net"]);
    expect(batch!.sent).toBeGreaterThanOrEqual(startedAt + 7_000);
    expect(batch!.sent).toBeLessThanOrEqual(startedAt + 13_000);
  });

  it("sends nothing when there is nothing to say", async () => {
    start({ surface: "player", room: "K9PR4M", sampleRate: 0 });
    await vi.advanceTimersByTimeAsync(60_000);
    // the forced 'device' event goes out once; nothing after that
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("splits a big backlog into capped batches", async () => {
    start({ surface: "tv", room: "K9PR4M" });
    for (let i = 0; i < 150; i++) diagEvent("net", { i }, true);
    await vi.advanceTimersByTimeAsync(13_000);
    await vi.advanceTimersByTimeAsync(5_000);
    const sizes = sentBatches().map((b) => b.ev.length);
    expect(sizes.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(60);
  });

  it("holds at most a few hundred events in memory", async () => {
    start({ surface: "tv", room: "K9PR4M" });
    for (let i = 0; i < 1000; i++) diagEvent("net", { i }, true);
    await vi.advanceTimersByTimeAsync(120_000);
    const total = sentBatches().reduce((n, b) => n + b.ev.length, 0);
    expect(total).toBeLessThanOrEqual(210);
  });
});

describe("sampling", () => {
  it("drops routine events on an unsampled phone but always keeps slow or failed ones", async () => {
    start({ surface: "player", room: "K9PR4M", sampleRate: 0 });
    diagEvent("bcast", { ev: "reveal", lag: 40 }); // routine
    diagEvent("bcast", { ev: "reveal", lag: 4200 }, true); // slow: forced
    diagSnap("/api/room/K9PR4M/snapshot", 120, true, 1); // routine
    diagSnap("/api/room/K9PR4M/snapshot", 6500, true, 1); // over 5 s: forced
    diagSnap("/api/room/K9PR4M/snapshot", 300, false, 3, "TimeoutError"); // failed: forced
    await vi.advanceTimersByTimeAsync(13_000);
    const kinds = sentBatches().flatMap((b) => b.ev.map((e) => `${e.k}:${e.f}`));
    expect(kinds).toEqual(["device:1", "bcast:1", "snap:1", "snap:1"]);
  });

  it("always records routine events on the TV and the host laptop", async () => {
    start({ surface: "tv", room: "K9PR4M", sampleRate: 0 });
    diagEvent("bcast", { ev: "reveal", lag: 40 });
    await vi.advanceTimersByTimeAsync(13_000);
    expect(sentBatches()[0]!.ev.map((e) => e.k)).toContain("bcast");
  });
});

describe("staying quiet while a question is open", () => {
  it("holds reports during a question, then sends after a short random wait", async () => {
    start({ surface: "player", room: "K9PR4M" });
    diagQuestionOpen(true);
    diagEvent("net", { ev: "conn" }, true);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(fetchMock).not.toHaveBeenCalled();

    diagQuestionOpen(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).not.toHaveBeenCalled(); // not instantly
    await vi.advanceTimersByTimeAsync(9_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBatches()[0]!.ev.map((e) => e.k)).toEqual(["device", "net"]);
  });
});

describe("leaving the page", () => {
  it("sends what it has with sendBeacon when the page is hidden", async () => {
    // jsdom's Blob can't be read back, so capture what is put in it.
    class CapturingBlob {
      constructor(
        public parts: string[],
        public options: { type: string },
      ) {}
      get type() {
        return this.options.type;
      }
    }
    vi.stubGlobal("Blob", CapturingBlob);
    start({ surface: "player", room: "K9PR4M" });
    diagQuestionOpen(true); // even mid-question: the page is going away
    diagEvent("net", { ev: "offline" }, true);
    setVisibility("hidden");
    expect(beaconMock).toHaveBeenCalledTimes(1);
    const [url, blob] = beaconMock.mock.calls[0] as [string, CapturingBlob];
    expect(url).toBe("/api/diag/report");
    expect(blob.type).toBe("application/json");
    const body = JSON.parse(blob.parts[0]!) as Sent;
    expect(body.ev.map((e) => e.k)).toEqual(["device", "net", "vis"]);
    expect(body.ev[2]!.d).toEqual({ ev: "hidden" });
  });

  it("flushes once more when stopped, then goes quiet", async () => {
    const stop = start({ surface: "player", room: "K9PR4M" });
    diagEvent("net", { ev: "offline" }, true);
    stop();
    expect(beaconMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    diagEvent("net", { ev: "online" }, true);
    expect(diagActive()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("failure is silent", () => {
  it("retries a failed send later and gives up quietly", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Load failed");
    });
    start({ surface: "player", room: "K9PR4M" });
    diagEvent("net", { ev: "offline" }, true);
    await vi.advanceTimersByTimeAsync(200_000);
    const attempts = fetchMock.mock.calls.length;
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(attempts).toBeLessThanOrEqual(4); // original + 3 retries, then dropped
  });

  it("re-sends after the server asks it to slow down (429)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }));
    start({ surface: "player", room: "K9PR4M" });
    await vi.advanceTimersByTimeAsync(13_000);
    await vi.advanceTimersByTimeAsync(13_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBatches()[1]!.ev[0]!.k).toBe("device");
  });

  it("does not throw when sendBeacon or fetch blow up", () => {
    beaconMock.mockImplementation(() => {
      throw new Error("beacon unavailable");
    });
    start({ surface: "player", room: "K9PR4M" });
    expect(() => setVisibility("hidden")).not.toThrow();
  });
});

describe("what it listens to", () => {
  it("records offline/online and a connection-type change", async () => {
    const connection = new EventTarget() as EventTarget & { effectiveType?: string; downlink?: number; rtt?: number };
    connection.effectiveType = "3g";
    connection.rtt = 300;
    Object.defineProperty(navigator, "connection", { value: connection, configurable: true });
    start({ surface: "player", room: "K9PR4M" });
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    connection.effectiveType = "4g";
    connection.dispatchEvent(new Event("change"));
    await vi.advanceTimersByTimeAsync(13_000);
    const evs = sentBatches().flatMap((b) => b.ev);
    expect(evs.find((e) => e.k === "device")!.d).toMatchObject({ et: "3g", rtt: 300, s: "player" });
    expect(evs.filter((e) => e.k === "net").map((e) => e.d!.ev)).toEqual(["offline", "online", "conn"]);
    expect(evs.filter((e) => e.k === "net")[2]!.d).toMatchObject({ et: "4g" });
    delete (navigator as unknown as { connection?: unknown }).connection;
  });

  it("describes the device without sending the user agent or any identity", async () => {
    start({ surface: "player", room: "K9PR4M" });
    await vi.advanceTimersByTimeAsync(13_000);
    const raw = (fetchMock.mock.calls[0]![1] as { body: string }).body;
    expect(raw).not.toContain(navigator.userAgent);
    expect(raw.toLowerCase()).not.toContain("cookie");
  });

  it("turns the ribbon, channel and broadcast helpers into events", async () => {
    start({ surface: "player", room: "K9PR4M" });
    diagRibbon("online", {}); // baseline, not an event
    diagRibbon("unreachable", { channel: "CLOSED", reach: "unreachable", online: true });
    diagRibbon("unreachable", { channel: "CLOSED" }); // same state again: ignored
    diagRibbon("online", {});
    diagBroadcastHeard({ event: "advance", payload: { serverNow: new Date(Date.now() - 3500).toISOString() } });
    diagBroadcastHeard({ event: "live-room-event", payload: { kind: "answer_progress" } }); // skipped
    diagBroadcastHeard({ event: "fireworks", payload: {} }); // cosmetic: skipped
    await vi.advanceTimersByTimeAsync(13_000);
    const evs = sentBatches().flatMap((b) => b.ev);
    const ribbons = evs.filter((e) => e.k === "ribbon");
    expect(ribbons.map((e) => `${e.d!.from}>${e.d!.to}`)).toEqual(["online>unreachable", "unreachable>online"]);
    expect(ribbons[0]!.d).toMatchObject({ chan: "CLOSED", reach: "unreachable" });
    const heard = evs.filter((e) => e.k === "bcast");
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ f: 1, d: { ev: "advance", lag: 3500 } });
  });
});

describe("TV scene frame rate", () => {
  function mountWorld(tier: string, off = false) {
    document.body.innerHTML = `<div data-world-pack="october" ${off ? 'data-world-off="true"' : ""}><canvas data-world-tier="${tier}"></canvas></div>`;
  }

  it("measures short bursts while the October world draws at full tier, keeping about one healthy reading in three", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "requestAnimationFrame", "performance"] });
    mountWorld("full");
    start({ surface: "tv", room: "K9PR4M" });
    await vi.advanceTimersByTimeAsync(45_000);
    const fps = sentBatches().flatMap((b) => b.ev).filter((e) => e.k === "fps");
    expect(fps).toHaveLength(1); // 4 bursts in 45 s, the 3rd is kept
    expect(fps[0]!.f).toBe(0); // healthy, so not forced
    expect(Number(fps[0]!.d!.fps)).toBeGreaterThan(50);
    expect(fps[0]!.d).toMatchObject({ scene: "october", slow: 0 });
    document.body.innerHTML = "";
  });

  it("records a slow scene as a forced event", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "requestAnimationFrame", "performance"] });
    // Make every animation frame take 100 ms (10 fps).
    const slowRaf = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 100) as unknown as number;
    vi.stubGlobal("requestAnimationFrame", slowRaf);
    mountWorld("full");
    start({ surface: "tv", room: "K9PR4M" });
    await vi.advanceTimersByTimeAsync(12_500);
    await vi.advanceTimersByTimeAsync(13_000);
    const fps = sentBatches().flatMap((b) => b.ev).filter((e) => e.k === "fps");
    expect(fps.length).toBeGreaterThanOrEqual(1);
    expect(fps[0]).toMatchObject({ f: 1, d: { scene: "october" } });
    expect(Number(fps[0]!.d!.fps)).toBeLessThan(15);
    expect(Number(fps[0]!.d!.slow)).toBeGreaterThanOrEqual(3);
    document.body.innerHTML = "";
  });

  it("does not run the probe when the world is off, still, or absent", async () => {
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    start({ surface: "tv", room: "K9PR4M" });
    mountWorld("full", true);
    await vi.advanceTimersByTimeAsync(25_000);
    mountWorld("still");
    await vi.advanceTimersByTimeAsync(25_000);
    document.body.innerHTML = "";
    await vi.advanceTimersByTimeAsync(25_000);
    expect(raf).not.toHaveBeenCalled();
  });

  it("never runs on a player's phone", async () => {
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    mountWorld("full");
    start({ surface: "player", room: "K9PR4M" });
    await vi.advanceTimersByTimeAsync(40_000);
    expect(raf).not.toHaveBeenCalled();
    document.body.innerHTML = "";
  });
});

describe("pathTemplate", () => {
  it("hides ids and room codes and drops query strings", () => {
    expect(pathTemplate("/api/games/11111111-1111-1111-1111-111111111111/advance?x=1")).toBe("/api/games/:id/advance");
    expect(pathTemplate("https://tr1via.com/api/room/K9PR4M/snapshot")).toBe("/api/room/:code/snapshot");
    expect(pathTemplate("/api/tv/K9PR4M/snapshot")).toBe("/api/tv/:code/snapshot");
  });
});
