import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDeviceSession } from "@/lib/hooks/useDeviceSession";

function response(ok: boolean, ready = ok): Response {
  return {
    ok,
    json: async () => ({ ready }),
  } as Response;
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advanceTime(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useDeviceSession", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the signed device identity out of browser storage and hook state", async () => {
    window.localStorage.setItem("tr1via_device_id", "stolen-value");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ready: true }),
    } as Response);

    const { result } = renderHook(() => useDeviceSession());

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(fetchSpy).toHaveBeenCalledWith("/api/session/init", {
      method: "POST",
      credentials: "same-origin",
    });
    expect(window.localStorage.getItem("tr1via_device_id")).toBeNull();
    expect(result.current).toEqual({ isReady: true, isLoading: false });
  });

  it.each(["non-OK response", "network failure"])(
    "recovers in the background after an initial %s",
    async (failureKind) => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      if (failureKind === "non-OK response") {
        fetchSpy.mockResolvedValueOnce(response(false));
      } else {
        fetchSpy.mockRejectedValueOnce(new Error("offline"));
      }
      fetchSpy.mockResolvedValueOnce(response(true));

      const { result } = renderHook(() => useDeviceSession());
      await flushAsyncWork();

      expect(result.current).toEqual({ isReady: false, isLoading: false });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await advanceTime(1_000);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.current).toEqual({ isReady: true, isLoading: false });
    },
  );

  it("uses capped exponential backoff for automatic recovery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    const callTimes: number[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callTimes.push(Date.now());
      return response(false);
    });

    renderHook(() => useDeviceSession());
    await flushAsyncWork();

    let expectedCalls = 1;
    for (const delay of [1_000, 2_000, 4_000, 8_000, 15_000, 15_000]) {
      await advanceTime(delay - 1);
      expect(callTimes).toHaveLength(expectedCalls);
      await advanceTime(1);
      expectedCalls += 1;
      expect(callTimes).toHaveLength(expectedCalls);
    }

    expect(callTimes).toEqual([0, 1_000, 3_000, 7_000, 15_000, 30_000, 45_000]);
  });

  it("never overlaps requests and coalesces recovery signals", async () => {
    vi.useFakeTimers();
    let resolveSecond!: (value: Response) => void;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response(false))
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => {
          resolveSecond = resolve;
        }),
      )
      .mockResolvedValueOnce(response(true));

    const { result } = renderHook(() => useDeviceSession());
    await flushAsyncWork();
    await advanceTime(1_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));
    await advanceTime(60_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSecond(response(false));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result.current).toEqual({ isReady: true, isLoading: false });
  });

  it.each(["online", "focus"])(
    "%s triggers an immediate retry instead of waiting for backoff",
    async (eventName) => {
      vi.useFakeTimers();
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(response(false))
        .mockResolvedValueOnce(response(true));

      const { result } = renderHook(() => useDeviceSession());
      await flushAsyncWork();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new Event(eventName));
      await flushAsyncWork();

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.current).toEqual({ isReady: true, isLoading: false });
    },
  );

  it("removes recovery listeners and cancels pending retry on unmount", async () => {
    vi.useFakeTimers();
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(false));

    const { unmount } = renderHook(() => useDeviceSession());
    await flushAsyncWork();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    unmount();
    await advanceTime(60_000);
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));
    await flushAsyncWork();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("focus", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("focus", expect.any(Function));
  });
});
