import { afterEach, describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTimer } from "@/lib/hooks/useTimer";

describe("useTimer with themeKey", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses 25s when themeKey is 'may' and durationS is omitted", () => {
    const revealedAtMs = Date.now();
    const { result } = renderHook(() =>
      useTimer({ revealedAtMs, themeKey: "may" })
    );
    expect(result.current.secondsRemaining).toBeGreaterThan(24);
    expect(result.current.secondsRemaining).toBeLessThanOrEqual(25);
  });

  it("uses the 25s default when themeKey is 'house' and durationS is omitted", () => {
    const revealedAtMs = Date.now();
    const { result } = renderHook(() =>
      useTimer({ revealedAtMs, themeKey: "house" })
    );
    expect(result.current.secondsRemaining).toBeGreaterThan(24);
    expect(result.current.secondsRemaining).toBeLessThanOrEqual(25);
  });

  it("explicit durationS overrides the theme default", () => {
    const revealedAtMs = Date.now();
    const { result } = renderHook(() =>
      useTimer({ revealedAtMs, themeKey: "may", durationS: 10 })
    );
    expect(result.current.secondsRemaining).toBeGreaterThan(9);
    expect(result.current.secondsRemaining).toBeLessThanOrEqual(10);
  });

  it("falls back to the 25s default when neither themeKey nor durationS provided", () => {
    const revealedAtMs = Date.now();
    const { result } = renderHook(() => useTimer({ revealedAtMs }));
    expect(result.current.secondsRemaining).toBeGreaterThan(24);
    expect(result.current.secondsRemaining).toBeLessThanOrEqual(25);
  });

  it("shows 1 through the final fractional second and reaches 0 at exactly 25 seconds", () => {
    vi.useFakeTimers();
    const revealedAtMs = new Date("2026-09-16T12:00:00.000Z").getTime();
    vi.setSystemTime(revealedAtMs);
    const onZero = vi.fn();
    const { result } = renderHook(() =>
      useTimer({ revealedAtMs, durationS: 25, onZero }),
    );

    expect(result.current.displaySeconds).toBe(25);
    expect(result.current.hasExpired).toBe(false);

    act(() => vi.advanceTimersByTime(24_900));
    expect(result.current.displaySeconds).toBe(1);
    expect(result.current.hasExpired).toBe(false);

    act(() => vi.advanceTimersByTime(100));
    expect(result.current.displaySeconds).toBe(0);
    expect(result.current.hasExpired).toBe(true);
    expect(onZero).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(1_000));
    expect(onZero).toHaveBeenCalledTimes(1);
  });
});
