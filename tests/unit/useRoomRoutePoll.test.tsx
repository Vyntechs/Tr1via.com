// useRoomRoutePoll — while in backup mode, polls the server route on a jittered
// ~5s cadence, hands each payload to onPayload, pauses when the tab is hidden,
// and stops when disabled (recovered).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRoomRoutePoll } from "@/lib/hooks/useRoomRoutePoll";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

const flush = () => Promise.resolve();

describe("useRoomRoutePoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("does not poll while disabled", async () => {
    const fetchPayload = vi.fn().mockResolvedValue({ tag: "p" });
    renderHook(() =>
      useRoomRoutePoll({ enabled: false, fetchPayload, onPayload: vi.fn(), rand: () => 0.5 }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchPayload).not.toHaveBeenCalled();
  });

  it("polls on a ~5s cadence and forwards each payload while enabled", async () => {
    const fetchPayload = vi.fn().mockResolvedValue({ tag: "p" });
    const onPayload = vi.fn();
    renderHook(() =>
      useRoomRoutePoll({ enabled: true, fetchPayload, onPayload, rand: () => 0.5 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      await flush();
    });
    expect(onPayload).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      await flush();
    });
    expect(onPayload).toHaveBeenCalledTimes(2);
  });

  it("pauses while hidden, resumes when visible", async () => {
    const fetchPayload = vi.fn().mockResolvedValue({ tag: "p" });
    const onPayload = vi.fn();
    renderHook(() =>
      useRoomRoutePoll({ enabled: true, fetchPayload, onPayload, rand: () => 0.5 }),
    );
    act(() => setVisibility("hidden"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(onPayload).not.toHaveBeenCalled();

    act(() => setVisibility("visible"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      await flush();
    });
    expect(onPayload).toHaveBeenCalledTimes(1);
  });

  it("reports errors via onError and keeps polling", async () => {
    const fetchPayload = vi
      .fn()
      .mockRejectedValueOnce(new Error("route down"))
      .mockResolvedValue({ tag: "p" });
    const onPayload = vi.fn();
    const onError = vi.fn();
    renderHook(() =>
      useRoomRoutePoll({ enabled: true, fetchPayload, onPayload, onError, rand: () => 0.5 }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      await flush();
    });
    expect(onError).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      await flush();
    });
    expect(onPayload).toHaveBeenCalledTimes(1);
  });

  it("gives each poll its own signal and treats 5s of silence as a failed poll", async () => {
    const signals: AbortSignal[] = [];
    const fetchPayload = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<never>(() => undefined);
    });
    const onError = vi.fn();
    renderHook(() =>
      useRoomRoutePoll({ enabled: true, fetchPayload, onPayload: vi.fn(), onError, rand: () => 0.5 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetchPayload).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(onError).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(signals[0].aborted).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);

    // A hung poll used to stop the loop for good. The next one still goes out.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetchPayload).toHaveBeenCalledTimes(2);
  });

  it("aborts a running poll when it is switched off, and drops its answer", async () => {
    let signal: AbortSignal | undefined;
    const fetchPayload = vi.fn((s: AbortSignal) => {
      signal = s;
      return new Promise<never>(() => undefined);
    });
    const onError = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }) =>
        useRoomRoutePoll({ enabled, fetchPayload, onPayload: vi.fn(), onError, rand: () => 0.5 }),
      { initialProps: { enabled: true } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    rerender({ enabled: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(signal?.aborted).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });
});
