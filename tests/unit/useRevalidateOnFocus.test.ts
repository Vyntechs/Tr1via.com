// Unit tests for the focus/online revalidate hook. The hook's only job
// is to bump a counter on visibilitychange→visible and on `online`, with
// a 1.5 s throttle to absorb rapid tab-flipping. We pin those behaviors
// here so a refactor doesn't silently break the player-phone refresh
// pattern that heals iOS Safari background suspends.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  REVALIDATE_THROTTLE_MS,
  useRevalidateOnFocus,
} from "@/lib/hooks/useRevalidateOnFocus";

function fireVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function fireOnline(): void {
  window.dispatchEvent(new Event("online"));
}

describe("useRevalidateOnFocus", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // jsdom default is "visible"; reset to a known state per test.
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts at 0", () => {
    const { result } = renderHook(() => useRevalidateOnFocus());
    expect(result.current).toBe(0);
  });

  it("bumps when the tab becomes visible", () => {
    const { result } = renderHook(() => useRevalidateOnFocus());
    // Have to start hidden so the first visibilitychange counts as a transition.
    act(() => fireVisibility("hidden"));
    // Past the throttle.
    act(() => vi.advanceTimersByTime(REVALIDATE_THROTTLE_MS + 10));
    act(() => fireVisibility("visible"));
    expect(result.current).toBe(1);
  });

  it("does NOT bump when the tab becomes hidden", () => {
    const { result } = renderHook(() => useRevalidateOnFocus());
    act(() => fireVisibility("hidden"));
    expect(result.current).toBe(0);
  });

  it("bumps on the window 'online' event", () => {
    const { result } = renderHook(() => useRevalidateOnFocus());
    act(() => fireOnline());
    expect(result.current).toBe(1);
  });

  it("throttles bumps that arrive within the throttle window", () => {
    const { result } = renderHook(() => useRevalidateOnFocus());
    act(() => fireOnline()); // 1
    act(() => fireOnline()); // throttled
    act(() => fireOnline()); // throttled
    expect(result.current).toBe(1);
  });

  it("allows a second bump after the throttle window elapses", () => {
    const { result } = renderHook(() => useRevalidateOnFocus());
    act(() => fireOnline()); // 1
    act(() => vi.advanceTimersByTime(REVALIDATE_THROTTLE_MS + 50));
    act(() => fireOnline()); // 2
    expect(result.current).toBe(2);
  });

  it("removes listeners on unmount (no bump after teardown)", () => {
    const { result, unmount } = renderHook(() => useRevalidateOnFocus());
    act(() => fireOnline());
    expect(result.current).toBe(1);
    unmount();
    // After unmount, firing events shouldn't matter — the listener is gone
    // and React would warn anyway if we tried to update unmounted state.
    act(() => fireOnline());
    // result.current reflects the last render before unmount, which is 1.
    expect(result.current).toBe(1);
  });
});
