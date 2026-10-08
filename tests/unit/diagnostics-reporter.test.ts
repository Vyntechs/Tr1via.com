// The device reporter: batching, quiet while a question is open or before the
// room has loaded (hidden page or not), sampling and queue trimming that never
// drop slow/failed events first, beacon on hide between questions, the TV pass,
// silent failure.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DIAG_DEVICE_KEYS, DIAG_NET_KEYS } from "@/lib/diagnostics/config";
import {
  __resetDiagClientForTests,
  diagActive,
  diagBroadcastHeard,
  diagEvent,
  diagQuestionOpen,
  diagRibbon,
  diagRoomReady,
  diagSnap,
  pathTemplate,
  setDiagTvPass,
} from "@/lib/diagnostics/client";
import { startDeviceReporter } from "@/lib/diagnostics/reporter";

type Sent = {
  surface: string;
  room?: string;
  tok?: string;
  sid: string;
  sent: number;
  ev: Array<{ t: number; k: string; d?: Record<string, unknown>; f: number }>;
};

let fetchMock: ReturnType<typeof vi.fn>;
let beaconMock: ReturnType<typeof vi.fn>;
let stops: Array<() => void> = [];

/**
 * The usual state of a screen: the reporter is running, the room has loaded
 * (and the TV page has been given its pass). Pass `loaded: false` for a screen
 * that is still on its first room download.
 */
function start(options: Parameters<typeof startDeviceReporter>[0], extra: { loaded?: boolean; pass?: boolean } = {}) {
  const stop = startDeviceReporter(options);
  stops.push(stop);
  if (options.surface === "tv" && extra.pass !== false) setDiagTvPass("v1.pass-for-the-test-tv-page");
  if (extra.loaded !== false) diagRoomReady();
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

  it("sends nothing at all while a question is open, however long it lasts and however much piles up", async () => {
    start({ surface: "tv", room: "K9PR4M" });
    diagQuestionOpen(true);
    for (let i = 0; i < 150; i++) diagEvent("net", { i }, true);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(beaconMock).not.toHaveBeenCalled();
  });

  it("does not report in the middle of a question just because the phone locked its answer in", async () => {
    // The question stays open on the phone until the room says it closed; the
    // answer screen swapping to the locked-in screen does not change that.
    start({ surface: "player", room: "K9PR4M" });
    diagQuestionOpen(true);
    diagEvent("tap", { q: "q1", slot: 2, tries: 2, ms: 2600, ok: true, st: 204 }, true);
    // (nothing tells the reporter the question is over)
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock).not.toHaveBeenCalled();
    diagQuestionOpen(false);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBatches()[0]!.ev.map((e) => e.k)).toContain("tap");
  });

  it("still holds when the question was already open before the reporter finished loading", async () => {
    // The reporter is loaded a moment after the page; a phone that reloads
    // mid-question has already said "open" by then.
    diagQuestionOpen(true);
    start({ surface: "player", room: "K9PR4M" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    diagQuestionOpen(false);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps slow and failed events through a long question, and drops routine ones first when full", async () => {
    start({ surface: "tv", room: "K9PR4M" });
    diagQuestionOpen(true);
    for (let i = 0; i < 40; i++) diagEvent("net", { slow: i }, true); // forced
    for (let i = 0; i < 400; i++) diagEvent("bcast", { ev: "reveal", i }); // routine
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    diagQuestionOpen(false);
    await vi.advanceTimersByTimeAsync(60_000);
    const events = sentBatches().flatMap((b) => b.ev);
    expect(events.length).toBeLessThanOrEqual(210);
    // every slow/failed event (and the device description) survived
    expect(events.filter((e) => e.f === 1)).toHaveLength(41);
  });

  it("goes back to normal between questions", async () => {
    start({ surface: "player", room: "K9PR4M" });
    diagQuestionOpen(true);
    diagQuestionOpen(false);
    diagEvent("net", { ev: "conn" }, true);
    await vi.advanceTimersByTimeAsync(13_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a phone that locks its screen mid-question sends NOTHING: its events stay in memory until the question has closed", async () => {
    start({ surface: "player", room: "K9PR4M" });
    diagQuestionOpen(true);
    diagEvent("net", { ev: "offline" }, true);
    setVisibility("hidden");
    expect(beaconMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    // a page that stays hidden for a long time is still quiet (the timer is not an exception either)
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(beaconMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    // the phone wakes, still inside the question: still quiet
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).not.toHaveBeenCalled();
    // the question closes: everything held goes out, including what happened while the screen was locked
    diagQuestionOpen(false);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBatches()[0]!.ev.map((e) => e.k)).toEqual(["device", "net", "vis", "vis"]);
    expect(sentBatches()[0]!.ev.map((e) => e.d?.ev).filter(Boolean)).toEqual(["offline", "hidden", "visible"]);
  });

  it("closing the page mid-question also sends nothing (quiet comes first)", async () => {
    const stop = start({ surface: "player", room: "K9PR4M" });
    diagQuestionOpen(true);
    diagEvent("net", { ev: "offline" }, true);
    window.dispatchEvent(new Event("pagehide"));
    stop();
    expect(beaconMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("staying quiet before the room has loaded", () => {
  it("sends nothing while the first room download is still going, for the first 45 seconds", async () => {
    // A slow first load: the phone cannot know yet whether a question is live.
    start({ surface: "player", room: "K9PR4M" }, { loaded: false });
    diagEvent("snap", { w: "room", ms: 9000, ok: false, n: 3, err: "TimeoutError" }, true);
    await vi.advanceTimersByTimeAsync(44_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(beaconMock).not.toHaveBeenCalled();
  });

  it("not even a hidden page sends before the room has loaded", async () => {
    const stop = start({ surface: "player", room: "K9PR4M" }, { loaded: false });
    setVisibility("hidden");
    window.dispatchEvent(new Event("pagehide"));
    stop();
    expect(beaconMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends what it held, in order, once the room has loaded (if no question is live)", async () => {
    start({ surface: "player", room: "K9PR4M" }, { loaded: false });
    diagEvent("snap", { w: "room", ms: 9000, ok: true, n: 2 }, true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).not.toHaveBeenCalled();
    diagRoomReady();
    await vi.advanceTimersByTimeAsync(13_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBatches()[0]!.ev.map((e) => e.k)).toEqual(["device", "snap"]);
  });

  it("stays quiet when the room loaded into a question that is already open", async () => {
    start({ surface: "player", room: "K9PR4M" }, { loaded: false });
    // the room tells the reporter what is on screen first, then that it has loaded
    diagQuestionOpen(true);
    diagRoomReady();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is remembered for a reporter that starts after the room has loaded", async () => {
    diagRoomReady();
    start({ surface: "player", room: "K9PR4M" }, { loaded: false });
    await vi.advanceTimersByTimeAsync(13_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe("a room that never loads: a small, bounded 'could not load' report", () => {
    it("after 45 seconds on its loading screen a phone may report what went wrong, at most 3 times", async () => {
      start({ surface: "player", room: "K9PR4M" }, { loaded: false });
      diagEvent("snap", { w: "room", ms: 9000, ok: false, n: 3, err: "TimeoutError" }, true);
      diagEvent("ribbon", { from: "online", to: "unreachable", chan: "CLOSED", reach: "unreachable" }, true);
      await vi.advanceTimersByTimeAsync(44_000);
      expect(fetchMock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sentBatches()[0]!.ev.map((e) => e.k)).toEqual(["device", "snap", "ribbon"]);
      // more trouble keeps being reported, but only twice more, however long it stays stuck
      for (let i = 0; i < 12; i++) {
        diagEvent("snap", { w: "room", ms: 9000, ok: false, n: 3, err: "TimeoutError" }, true);
        await vi.advanceTimersByTimeAsync(15_000);
      }
      expect(fetchMock).toHaveBeenCalledTimes(3);
      for (const batch of sentBatches()) expect(batch.ev.length).toBeLessThanOrEqual(60);
      // events piled up after the third report are kept (bounded), not sent
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("never while a question is open, and the TV still needs its pass", async () => {
      start({ surface: "player", room: "K9PR4M" }, { loaded: false });
      diagQuestionOpen(true);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(fetchMock).not.toHaveBeenCalled();
      diagQuestionOpen(false);
      stops.splice(0).forEach((stop) => stop());
      __resetDiagClientForTests();

      start({ surface: "tv", room: "K9PR4M" }, { loaded: false, pass: false });
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("once the room does load, the normal rules take over and the 3-report allowance does not matter", async () => {
      start({ surface: "player", room: "K9PR4M" }, { loaded: false });
      await vi.advanceTimersByTimeAsync(60_000);
      const before = fetchMock.mock.calls.length;
      expect(before).toBe(1);
      diagRoomReady();
      diagEvent("net", { ev: "offline" }, true);
      await vi.advanceTimersByTimeAsync(13_000);
      expect(fetchMock.mock.calls.length).toBe(before + 1);
      diagQuestionOpen(true);
      diagEvent("net", { ev: "online" }, true);
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      expect(fetchMock.mock.calls.length).toBe(before + 1); // quiet again mid-question
    });
  });
});

describe("the venue TV needs its pass", () => {
  it("holds everything until the TV page has been given its pass, then sends it with every report", async () => {
    start({ surface: "tv", room: "K9PR4M" }, { pass: false });
    diagEvent("net", { ev: "offline" }, true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).not.toHaveBeenCalled();

    setDiagTvPass("v1.pass-for-the-test-tv-page");
    await vi.advanceTimersByTimeAsync(13_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBatches()[0]).toMatchObject({ surface: "tv", tok: "v1.pass-for-the-test-tv-page" });
    expect(sentBatches()[0]!.ev.map((e) => e.k)).toEqual(["device", "net"]);
  });

  it("phones and the host laptop never send a pass", async () => {
    setDiagTvPass("v1.pass-for-the-test-tv-page");
    start({ surface: "player", room: "K9PR4M" });
    start({ surface: "host", night: "11111111-1111-1111-1111-111111111111" });
    await vi.advanceTimersByTimeAsync(13_000);
    expect(sentBatches().length).toBeGreaterThanOrEqual(2);
    for (const batch of sentBatches()) expect(batch).not.toHaveProperty("tok");
  });
});

describe("when the queue is full or a send fails, slow and failed events are the last to go", () => {
  it("a failed send puts its events back without pushing the slow or failed ones out", async () => {
    let fail: (error: Error) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    start({ surface: "tv", room: "K9PR4M" });
    for (let i = 0; i < 10; i++) diagEvent("net", { i }, true); // forced
    for (let i = 0; i < 49; i++) diagEvent("bcast", { ev: "reveal", i }); // routine: with the device event, a batch of 60
    await vi.advanceTimersByTimeAsync(13_000);
    expect(fetchMock).toHaveBeenCalledTimes(1); // in flight, not yet failed
    // while it is in flight the screen keeps producing events and the queue fills up
    for (let i = 0; i < 150; i++) diagEvent("bcast", { ev: "reveal", i: 100 + i });
    for (let i = 0; i < 60; i++) diagEvent("net", { i: 100 + i }, true);
    fail(new TypeError("Load failed"));
    await vi.advanceTimersByTimeAsync(5_000);
    // now everything that is still held goes out over the next few reports
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    await vi.advanceTimersByTimeAsync(120_000);
    const sent = sentBatches().slice(1).flatMap((b) => b.ev);
    expect(sent.length).toBeLessThanOrEqual(200);
    // every slow or failed event survived: the device description, the 10 that were
    // put back and the 60 produced meanwhile (routine ones were dropped to make room)
    expect(sent.filter((e) => e.f === 1)).toHaveLength(1 + 10 + 60);
    expect(sent.filter((e) => e.f === 1 && e.k === "net")).toHaveLength(70);
  });

  it("routine events are given up after a few tries; slow or failed ones are kept trying longer", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Load failed");
    });
    start({ surface: "tv", room: "K9PR4M" });
    diagEvent("bcast", { ev: "reveal", lag: 5 }); // routine
    diagEvent("net", { ev: "offline" }, true); // forced
    await vi.advanceTimersByTimeAsync(400_000);
    const batches = sentBatches();
    expect(batches.length).toBe(11); // the first send and 10 retries, then it gives up
    const withRoutine = batches.filter((b) => b.ev.some((e) => e.k === "bcast")).length;
    expect(withRoutine).toBe(4); // the first send and 3 retries
    expect(batches.at(-1)!.ev.map((e) => e.k)).toEqual(["device", "net"]);
  });
});

describe("leaving the page", () => {
  it("sends what it has with sendBeacon when the page is hidden between questions", async () => {
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
    await vi.advanceTimersByTimeAsync(400_000);
    const attempts = fetchMock.mock.calls.length;
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(attempts).toBeLessThanOrEqual(11); // original + 10 retries (slow or failed events), then dropped
    const before = attempts;
    await vi.advanceTimersByTimeAsync(400_000);
    expect(fetchMock.mock.calls.length).toBe(before); // and it stopped for good
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
    expect(evs.find((e) => e.k === "device")!.d).toMatchObject({ et: "3g", rtt: 300 });
    expect(evs.filter((e) => e.k === "net").map((e) => e.d!.ev)).toEqual(["offline", "online", "conn"]);
    expect(evs.filter((e) => e.k === "net")[2]!.d).toMatchObject({ et: "4g" });
    delete (navigator as unknown as { connection?: unknown }).connection;
  });

  it("describes the device with a short summary only: no user agent, exact size, memory, cores or identity", async () => {
    const connection = new EventTarget() as EventTarget & Record<string, unknown>;
    Object.assign(connection, { effectiveType: "4g", rtt: 50, downlink: 9.5, saveData: true, type: "wifi" });
    Object.defineProperty(navigator, "connection", { value: connection, configurable: true });
    Object.defineProperty(navigator, "deviceMemory", { value: 8, configurable: true });
    start({ surface: "player", room: "K9PR4M" });
    window.dispatchEvent(new Event("offline"));
    await vi.advanceTimersByTimeAsync(13_000);
    const raw = (fetchMock.mock.calls[0]![1] as { body: string }).body;
    expect(raw).not.toContain(navigator.userAgent);
    expect(raw.toLowerCase()).not.toContain("cookie");
    const evs = sentBatches().flatMap((b) => b.ev);
    const device = evs.find((e) => e.k === "device")!.d!;
    // Only keys from the fixed list, and in particular none of the old ones.
    expect(Object.keys(device).every((key) => (DIAG_DEVICE_KEYS as readonly string[]).includes(key))).toBe(true);
    for (const gone of ["w", "h", "dpr", "cores", "mem", "app", "s", "sd", "ua"]) expect(device).not.toHaveProperty(gone);
    expect(device).toMatchObject({ sc: "l", et: "4g", rtt: 50, dl: 9.5, ty: "wifi" });
    for (const e of evs.filter((x) => x.k === "net")) {
      expect(Object.keys(e.d!).every((key) => (DIAG_NET_KEYS as readonly string[]).includes(key))).toBe(true);
    }
    delete (navigator as unknown as { connection?: unknown }).connection;
    delete (navigator as unknown as { deviceMemory?: unknown }).deviceMemory;
  });

  it("says which build the page is (deployment id and commit), only when the build has them", async () => {
    vi.stubEnv("NEXT_PUBLIC_TR1VIA_RELEASE", "dpl_8fJd2kQ1xYz");
    vi.stubEnv("NEXT_PUBLIC_TR1VIA_SHA", "c696ef223708");
    start({ surface: "host", night: "11111111-1111-1111-1111-111111111111" });
    await vi.advanceTimersByTimeAsync(13_000);
    const device = sentBatches().flatMap((b) => b.ev).find((e) => e.k === "device")!.d!;
    expect(device).toMatchObject({ rel: "dpl_8fJd2kQ1xYz", sha: "c696ef223708" });
    expect(Object.keys(device).every((key) => (DIAG_DEVICE_KEYS as readonly string[]).includes(key))).toBe(true);
    vi.unstubAllEnvs();
  });

  it("leaves the build labels out of a local build (nothing set)", async () => {
    vi.stubEnv("NEXT_PUBLIC_TR1VIA_RELEASE", "");
    vi.stubEnv("NEXT_PUBLIC_TR1VIA_SHA", "");
    start({ surface: "player", room: "K9PR4M" });
    await vi.advanceTimersByTimeAsync(13_000);
    const device = sentBatches().flatMap((b) => b.ev).find((e) => e.k === "device")!.d!;
    expect(JSON.stringify(device)).not.toContain("rel");
    expect(JSON.stringify(device)).not.toContain("sha");
    vi.unstubAllEnvs();
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
