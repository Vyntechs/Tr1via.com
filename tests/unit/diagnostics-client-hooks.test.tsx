// The one-line diagnostic hooks inside the game's own client code:
//   - with logging off they change nothing (same request, same state)
//   - with logging on they report taps, snapshots, reachability and the
//     connection ribbon, and never alter the result.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  __resetDiagClientForTests,
  diagQuestionOpen,
  setDiagSink,
  type DiagData,
  type DiagSink,
} from "@/lib/diagnostics/client";
import { useAnswerSubmit, clearPendingAnswer } from "@/lib/hooks/useAnswerSubmit";
import { useDiagQuestionOpen } from "@/lib/diagnostics/useQuestionOpen";
import { useConnectionStatus } from "@/lib/hooks/useConnectionStatus";
import { fetchJsonWithRetry } from "@/lib/realtime/fetchWithRetry";
import { __resetChannelHealthForTests, setChannelHealth } from "@/lib/realtime/channelHealth";
import { __resetReachabilityForTests, setReachability } from "@/lib/realtime/reachability";
import { diagTargetFor } from "@/components/diagnostics/DiagnosticsMount";

interface Seen {
  kind: string;
  data?: DiagData;
  forced: boolean;
}

let seen: Seen[];
let open: boolean[];
let ready: number;

function attachSink() {
  const sink: DiagSink = {
    event: (kind, data, forced) => {
      seen.push({ kind, data, forced });
    },
    questionOpen: (value) => {
      open.push(value);
    },
    roomReady: () => {
      ready += 1;
    },
  };
  setDiagSink(sink);
}

function reply(status: number) {
  return { ok: status >= 200 && status < 300, status, json: async () => ({}), text: async () => "{}" } as Response;
}

// What our server sends for a saved answer (a bare 200 is not a confirm).
function confirmedReply() {
  const body = { code: "confirmed" };
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  seen = [];
  open = [];
  ready = 0;
  __resetDiagClientForTests();
  __resetChannelHealthForTests();
  __resetReachabilityForTests();
});

afterEach(() => {
  __resetDiagClientForTests();
  clearPendingAnswer();
});

describe("useAnswerSubmit", () => {
  it("sends exactly the same request as before when logging is off (plus only a cancel switch)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(confirmedReply());
    const { result } = renderHook(() => useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3] }));
    act(() => result.current.submit(2));
    await waitFor(() => expect(result.current.status).toBe("sent"));
    expect(fetchSpy).toHaveBeenCalledWith("/api/answers", {
      method: "POST",
      credentials: "same-origin",
      // The only addition: the phone can now drop a request it no longer needs.
      signal: expect.any(AbortSignal),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: "q1", slotChosen: 2, scramble: [0, 1, 2, 3] }),
    });
    expect(seen).toEqual([]);
  });

  it("adds the phone's tap timing as headers (never in the body) and reports the tap", async () => {
    attachSink();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply(204));
    const { result } = renderHook(() => useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3] }));
    const before = Date.now();
    act(() => result.current.submit(3));
    await waitFor(() => expect(result.current.status).toBe("sent"));

    const init = fetchSpy.mock.calls[0]![1] as { headers: Record<string, string>; body: string };
    expect(Number(init.headers["x-tr1via-tap-at"])).toBeGreaterThanOrEqual(before);
    expect(Number(init.headers["x-tr1via-sent-at"])).toBeGreaterThanOrEqual(Number(init.headers["x-tr1via-tap-at"]));
    expect(init.headers["x-tr1via-attempt"]).toBe("0");
    expect(JSON.parse(init.body)).toEqual({ questionId: "q1", slotChosen: 3, scramble: [0, 1, 2, 3] });

    const tap = seen.find((e) => e.kind === "tap")!;
    expect(tap).toMatchObject({ forced: false, data: { q: "q1", slot: 3, tries: 1, ok: true, st: 204 } });
  });

  it("keeps a slow, retried tap (always kept) and the answer still goes through", async () => {
    attachSink();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValueOnce(confirmedReply());
    const { result } = renderHook(() =>
      useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3], backoffMs: [0, 0, 0] }),
    );
    act(() => result.current.submit(1));
    await waitFor(() => expect(result.current.status).toBe("sent"));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const attempts = fetchSpy.mock.calls.map((c) => (c[1] as { headers: Record<string, string> }).headers["x-tr1via-attempt"]);
    expect(attempts).toEqual(["0", "1"]);
    expect(seen.find((e) => e.kind === "tap")).toMatchObject({ forced: true, data: { tries: 2, ok: true } });
  });

  it("reports a tap that never reached the server", async () => {
    attachSink();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Load failed"));
    const { result } = renderHook(() =>
      useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3], backoffMs: [0, 0, 0], maxAttempts: 3 }),
    );
    act(() => result.current.submit(4));
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(seen.find((e) => e.kind === "tap")).toMatchObject({
      forced: true,
      data: { slot: 4, tries: 3, ok: false, st: "network" },
    });
  });

  it("notes a tap the phone ignored because its timer had ended, without sending anything", () => {
    attachSink();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() =>
      useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3], accepting: false }),
    );
    act(() => result.current.submit(2));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
    expect(seen.find((e) => e.kind === "tapx")).toMatchObject({ forced: true, data: { q: "q1", slot: 2, why: "closed" } });
  });

  it("does not touch the question-open flag: locking in must not look like the question closing", async () => {
    attachSink();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply(204));
    const { result, rerender, unmount } = renderHook(
      ({ accepting }) => useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3], accepting }),
      { initialProps: { accepting: true } },
    );
    act(() => result.current.submit(1));
    await waitFor(() => expect(result.current.status).toBe("sent"));
    rerender({ accepting: false });
    unmount(); // the question screen swaps to the locked-in screen at lock-in
    expect(open).toEqual([]);
  });

  it("sends an answer saved before a refresh without claiming a tap time, and says it was resumed", async () => {
    attachSink();
    window.localStorage.setItem("tr1via:pending-answer", JSON.stringify({ questionId: "q1", slotChosen: 3 }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply(204));
    const { result } = renderHook(() => useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3] }));
    await waitFor(() => expect(result.current.status).toBe("sent"));
    const headers = (fetchSpy.mock.calls[0]![1] as { headers: Record<string, string> }).headers;
    expect(headers).not.toHaveProperty("x-tr1via-tap-at"); // unknown, not "now"
    expect(Number(headers["x-tr1via-sent-at"])).toBeGreaterThan(0);
    expect(seen.find((e) => e.kind === "tap")).toMatchObject({ forced: true, data: { q: "q1", slot: 3, ok: true, rs: true } });
  });
});

describe("useDiagQuestionOpen", () => {
  it("passes the live-question flag to the reporter and clears it when the screen goes away", () => {
    attachSink();
    const { rerender, unmount } = renderHook(({ live }) => useDiagQuestionOpen(live, true), {
      initialProps: { live: false },
    });
    expect(open).toEqual([]); // false -> false is not news
    rerender({ live: true });
    expect(open).toEqual([true]);
    rerender({ live: true });
    expect(open).toEqual([true]);
    rerender({ live: false });
    expect(open).toEqual([true, false]);
    rerender({ live: true });
    unmount();
    expect(open).toEqual([true, false, true, false]);
  });

  it("is remembered for a reporter that starts later (it is loaded a moment after the page)", () => {
    renderHook(() => useDiagQuestionOpen(true, true));
    attachSink(); // the reporter arrives after the question was already open
    expect(open).toEqual([true]);
    expect(ready).toBe(1); // ...and after the room had loaded
  });

  it("tells the reporter the room is loaded only once the room has loaded, and only once", () => {
    attachSink();
    const { rerender } = renderHook(({ loaded }) => useDiagQuestionOpen(false, loaded), {
      initialProps: { loaded: false },
    });
    expect(ready).toBe(0);
    rerender({ loaded: true });
    expect(ready).toBe(1);
    rerender({ loaded: false });
    rerender({ loaded: true });
    expect(ready).toBe(1); // once per page load
  });

  it("does nothing, and costs nothing, while no reporter is running", () => {
    const timers = vi.useFakeTimers();
    try {
      const { unmount } = renderHook(() => useDiagQuestionOpen(true, true));
      expect(timers.getTimerCount()).toBe(0);
      unmount();
    } finally {
      vi.useRealTimers();
    }
    diagQuestionOpen(false);
  });
});

describe("fetchJsonWithRetry", () => {
  it("returns the same body and reports quick successes only sometimes", async () => {
    attachSink();
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ hello: "room" }) }) as Response);
    for (let i = 0; i < 16; i++) {
      await expect(fetchJsonWithRetry("/api/room/K9PR4M/snapshot", { fetchImpl })).resolves.toEqual({ hello: "room" });
    }
    const snaps = seen.filter((e) => e.kind === "snap");
    expect(snaps).toHaveLength(2); // 1 in 8 of the quick ones
    expect(snaps[0]).toMatchObject({ forced: false, data: { w: "room", ok: true, n: 1 } });
  });

  it("always reports a failure, with the error name and attempts, then still throws", async () => {
    attachSink();
    const fetchImpl = vi.fn(async () => reply(503));
    await expect(
      fetchJsonWithRetry("/api/room/K9PR4M/snapshot", { fetchImpl, attempts: 2, rand: () => 0 }),
    ).rejects.toThrow("HTTP 503");
    expect(seen.find((e) => e.kind === "snap")).toMatchObject({
      forced: true,
      data: { w: "room", ok: false, n: 2, err: "Error" },
    });
  });

  it("does not report when the caller aborted it", async () => {
    attachSink();
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchJsonWithRetry("/api/room/K9PR4M/snapshot", { signal: controller.signal, fetchImpl: vi.fn() }),
    ).rejects.toThrow();
    expect(seen).toEqual([]);
  });

  it("works exactly the same with logging off", async () => {
    const fetchImpl = vi.fn(async () => reply(200));
    await expect(fetchJsonWithRetry("/api/room/K9PR4M/snapshot", { fetchImpl })).resolves.toEqual({});
    expect(seen).toEqual([]);
  });
});

describe("connection signals", () => {
  it("reports realtime channel and reachability changes (only real changes)", () => {
    attachSink();
    setChannelHealth("SUBSCRIBED");
    setChannelHealth("SUBSCRIBED");
    setChannelHealth("CLOSED");
    setReachability("ok");
    setReachability("unreachable");
    setReachability("unreachable");
    expect(seen.map((e) => `${e.kind}:${e.data!.from}>${e.data!.to}`)).toEqual([
      "chan:undefined>SUBSCRIBED",
      "chan:SUBSCRIBED>CLOSED",
      "reach:undefined>ok",
      "reach:ok>unreachable",
    ]);
    expect(seen.every((e) => e.forced)).toBe(true);
  });

  it("reports when the ribbon / hotspot screen turns on and off, and returns the same status", async () => {
    attachSink();
    type Props = { channelState: string; reachability: "ok" | "unreachable" };
    const { result, rerender } = renderHook((props: Props) => useConnectionStatus(props), {
      initialProps: { channelState: "SUBSCRIBED", reachability: "ok" } as Props,
    });
    expect(result.current).toBe("online");
    rerender({ channelState: "CLOSED", reachability: "unreachable" });
    expect(result.current).toBe("unreachable");
    rerender({ channelState: "SUBSCRIBED", reachability: "ok" });
    expect(result.current).toBe("online");
    await waitFor(() => expect(seen.filter((e) => e.kind === "ribbon")).toHaveLength(2));
    const ribbons = seen.filter((e) => e.kind === "ribbon");
    expect(ribbons[0]).toMatchObject({ forced: true, data: { from: "online", to: "unreachable", chan: "CLOSED", reach: "unreachable" } });
    expect(ribbons[1]!.data).toMatchObject({ from: "unreachable", to: "online" });
  });
});

describe("DiagnosticsMount", () => {
  it("only starts on the three live surfaces", () => {
    expect(diagTargetFor("/room/K9PR4M")).toEqual({ surface: "player", room: "K9PR4M" });
    expect(diagTargetFor("/room/K9PR4M/recap")).toEqual({ surface: "player", room: "K9PR4M" });
    expect(diagTargetFor("/tv/K9PR4M")).toEqual({ surface: "tv", room: "K9PR4M" });
    const night = "11111111-1111-1111-1111-111111111111";
    expect(diagTargetFor(`/host/live/${night}`)).toEqual({ surface: "host", night });
    expect(diagTargetFor(`/host/phone/${night}`)).toEqual({ surface: "host", night });
    expect(diagTargetFor(`/host/setup/${night}`)).toBeNull();
    expect(diagTargetFor("/join")).toBeNull();
    expect(diagTargetFor("/")).toBeNull();
    expect(diagTargetFor(null)).toBeNull();
  });
});
