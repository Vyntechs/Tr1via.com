// The one-line diagnostic hooks inside the game's own client code:
//   - with logging off they change nothing (same request, same state)
//   - with logging on they report taps, snapshots, reachability and the
//     connection ribbon, and never alter the result.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  __resetDiagClientForTests,
  setDiagSink,
  type DiagData,
  type DiagSink,
} from "@/lib/diagnostics/client";
import { useAnswerSubmit, clearPendingAnswer } from "@/lib/hooks/useAnswerSubmit";
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

function attachSink() {
  const sink: DiagSink = {
    event: (kind, data, forced) => {
      seen.push({ kind, data, forced });
    },
    questionOpen: (value) => {
      open.push(value);
    },
  };
  setDiagSink(sink);
}

function reply(status: number) {
  return { ok: status >= 200 && status < 300, status, json: async () => ({}), text: async () => "{}" } as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  seen = [];
  open = [];
  __resetDiagClientForTests();
  __resetChannelHealthForTests();
  __resetReachabilityForTests();
});

afterEach(() => {
  __resetDiagClientForTests();
  clearPendingAnswer();
});

describe("useAnswerSubmit", () => {
  it("sends exactly the same request as before when logging is off", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply(200));
    const { result } = renderHook(() => useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3] }));
    act(() => result.current.submit(2));
    await waitFor(() => expect(result.current.status).toBe("sent"));
    expect(fetchSpy).toHaveBeenCalledWith("/api/answers", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: "q1", slotChosen: 2, scramble: [0, 1, 2, 3] }),
    });
    expect(seen).toEqual([]);
  });

  it("adds the phone's tap timing as headers (never in the body) and reports the tap", async () => {
    attachSink();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply(204));
    const { result } = renderHook(() => useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3] }));
    expect(open).toEqual([true]); // a question is on screen: reports are held
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
      .mockResolvedValueOnce(reply(200));
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

  it("tells the reporter the question has closed when the timer ends or the screen leaves", () => {
    attachSink();
    const { rerender, unmount } = renderHook(
      ({ accepting }) => useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3], accepting }),
      { initialProps: { accepting: true } },
    );
    expect(open).toEqual([true]);
    rerender({ accepting: false });
    expect(open).toEqual([true, false]);
    unmount();
    expect(open).toEqual([true, false, false]);
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
