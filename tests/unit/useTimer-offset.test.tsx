// The real useTimer and useResolveAtZero on a fake clock. Shipping the offset
// fix without the ladder would leave a phone firing exactly at zero with one 409
// and no second try, so the last test here runs the two together.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTimer } from "@/lib/hooks/useTimer";
import { useResolveAtZero } from "@/lib/hooks/useResolveAtZero";

const START = Date.parse("2026-11-04T20:00:00.000Z");

describe("useTimer clock offset", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("takes the offset from when the broadcast arrived, not when the screen mounted", () => {
    // This phone's clock is 10s behind the server. The reveal reached it at
    // START; the question screen only mounted 2s later, after the refetch.
    const revealedAtMs = START + 10_000;
    const receivedAtMs = START;
    vi.setSystemTime(START + 2000);
    const { result } = renderHook(() =>
      useTimer({ revealedAtMs, serverNowMs: revealedAtMs, receivedAtMs, durationS: 25 }),
    );
    expect(result.current.secondsRemaining).toBeCloseTo(23, 5);
    expect(result.current.getRemainingMs()).toBeCloseTo(23_000, 0);
  });

  it("without the stamp, falls back to the moment the screen read the broadcast", () => {
    const revealedAtMs = START + 10_000;
    vi.setSystemTime(START + 2000);
    const { result } = renderHook(() =>
      useTimer({ revealedAtMs, serverNowMs: revealedAtMs, durationS: 25 }),
    );
    expect(result.current.secondsRemaining).toBeCloseTo(25, 5);
  });

  it("keeps the offset when a later broadcast clears serverNow", () => {
    const revealedAtMs = START + 10_000;
    const { result, rerender } = renderHook(
      ({ serverNowMs, receivedAtMs }: { serverNowMs: number | null; receivedAtMs: number | null }) =>
        useTimer({ revealedAtMs, serverNowMs, receivedAtMs, durationS: 25 }),
      { initialProps: { serverNowMs: revealedAtMs as number | null, receivedAtMs: START as number | null } },
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.secondsRemaining).toBeCloseTo(20, 5);

    // A roster-changed broadcast replaces the reveal tag.
    rerender({ serverNowMs: null, receivedAtMs: null });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.secondsRemaining).toBeCloseTo(19.9, 5);
  });

  it("fires at the server's zero even when the phone's own clock is behind", () => {
    const revealedAtMs = START + 10_000;
    const onZero = vi.fn();
    renderHook(() =>
      useTimer({ revealedAtMs, serverNowMs: revealedAtMs, receivedAtMs: START, durationS: 25, onZero }),
    );
    act(() => {
      vi.advanceTimersByTime(24_900);
    });
    expect(onZero).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onZero).toHaveBeenCalledTimes(1);
  });

  it("a phone that fires exactly at zero survives the 409 and closes on the second ask", async () => {
    const revealedAtMs = START;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "question answer window is still open", retryInMs: 40 }), {
          status: 409,
        }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onSettled = vi.fn();
    renderHook(() => {
      const fire = useResolveAtZero({ questionId: "q1", caller: "phone", onSettled });
      return useTimer({ revealedAtMs, serverNowMs: START, receivedAtMs: START, durationS: 25, onZero: fire });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSettled).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(340);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});

describe("useResolveAtZero", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts one ladder per question and drops it when the question changes", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSettled = vi.fn();
    const { result, rerender } = renderHook(
      ({ questionId }) => useResolveAtZero({ questionId, caller: "phone", onSettled }),
      { initialProps: { questionId: "q1" } },
    );
    act(() => {
      result.current();
      result.current();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ questionId: "q2" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSettled).not.toHaveBeenCalled();

    act(() => {
      result.current();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0 as never]).toBe("/api/questions/q2/resolve");
  });
});
