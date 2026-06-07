import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTimer } from "@/lib/hooks/useTimer";

describe("useTimer with themeKey", () => {
  it("uses 30s when themeKey is 'may' and durationS is omitted", () => {
    const revealedAtMs = Date.now();
    const { result } = renderHook(() =>
      useTimer({ revealedAtMs, themeKey: "may" })
    );
    expect(result.current.secondsRemaining).toBeGreaterThan(29);
    expect(result.current.secondsRemaining).toBeLessThanOrEqual(30);
  });

  it("uses the 30s default when themeKey is 'house' and durationS is omitted", () => {
    const revealedAtMs = Date.now();
    const { result } = renderHook(() =>
      useTimer({ revealedAtMs, themeKey: "house" })
    );
    expect(result.current.secondsRemaining).toBeGreaterThan(29);
    expect(result.current.secondsRemaining).toBeLessThanOrEqual(30);
  });

  it("explicit durationS overrides the theme default", () => {
    const revealedAtMs = Date.now();
    const { result } = renderHook(() =>
      useTimer({ revealedAtMs, themeKey: "may", durationS: 10 })
    );
    expect(result.current.secondsRemaining).toBeGreaterThan(9);
    expect(result.current.secondsRemaining).toBeLessThanOrEqual(10);
  });

  it("falls back to the 30s default when neither themeKey nor durationS provided", () => {
    const revealedAtMs = Date.now();
    const { result } = renderHook(() => useTimer({ revealedAtMs }));
    expect(result.current.secondsRemaining).toBeGreaterThan(29);
    expect(result.current.secondsRemaining).toBeLessThanOrEqual(30);
  });
});
