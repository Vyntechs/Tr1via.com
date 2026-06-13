// useUnreachableRetry — drives the self-healing re-check while a surface can't
// reach the server. Fires onRetry on a backing-off, jittered cadence; pauses
// when the tab is hidden; stops the moment `enabled` flips false (recovered).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUnreachableRetry } from "@/lib/hooks/useUnreachableRetry";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useUnreachableRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("does not fire while disabled (reachable)", () => {
    const onRetry = vi.fn();
    renderHook(() => useUnreachableRetry({ enabled: false, onRetry, rand: () => 0.5 }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("fires the first re-check after ~2s, then backs off to ~4s, ~8s", () => {
    const onRetry = vi.fn();
    renderHook(() => useUnreachableRetry({ enabled: true, onRetry, rand: () => 0.5 }));

    act(() => vi.advanceTimersByTime(2000));
    expect(onRetry).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(4000));
    expect(onRetry).toHaveBeenCalledTimes(2);

    act(() => vi.advanceTimersByTime(8000));
    expect(onRetry).toHaveBeenCalledTimes(3);
  });

  it("pauses while the tab is hidden and resumes when visible again", () => {
    const onRetry = vi.fn();
    renderHook(() => useUnreachableRetry({ enabled: true, onRetry, rand: () => 0.5 }));

    act(() => setVisibility("hidden"));
    act(() => vi.advanceTimersByTime(20_000));
    expect(onRetry).not.toHaveBeenCalled();

    act(() => setVisibility("visible"));
    act(() => vi.advanceTimersByTime(2000));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("stops firing once enabled flips back to false (recovered)", () => {
    const onRetry = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useUnreachableRetry({ enabled, onRetry, rand: () => 0.5 }),
      { initialProps: { enabled: true } },
    );
    act(() => vi.advanceTimersByTime(2000));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    act(() => vi.advanceTimersByTime(20_000));
    expect(onRetry).toHaveBeenCalledTimes(1); // no further fires
  });
});
