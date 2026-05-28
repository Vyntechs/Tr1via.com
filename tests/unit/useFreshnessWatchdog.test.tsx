// tests/unit/useFreshnessWatchdog.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFreshnessWatchdog } from "@/lib/hooks/useFreshnessWatchdog";
import { STALE_MS } from "@/lib/realtime/freshnessWatchdog";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function args(overrides: Partial<Parameters<typeof useFreshnessWatchdog>[0]> = {}) {
  return {
    enabled: true,
    // Far in the past => stale path triggers on the first tick.
    getLastMessageAt: () => Date.now() - (STALE_MS + 10_000),
    getSubscribed: () => true,
    onRecover: vi.fn(),
    ...overrides,
  };
}

describe("useFreshnessWatchdog", () => {
  it("calls onRecover once when stale, then respects the cooldown", () => {
    const onRecover = vi.fn();
    renderHook(() => useFreshnessWatchdog(args({ onRecover })));
    vi.advanceTimersByTime(1_000); // first tick: stale -> recover
    expect(onRecover).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3_000); // still inside the 10s cooldown
    expect(onRecover).toHaveBeenCalledTimes(1);
  });

  it("never fires when disabled (player surface)", () => {
    const onRecover = vi.fn();
    renderHook(() => useFreshnessWatchdog(args({ enabled: false, onRecover })));
    vi.advanceTimersByTime(60_000);
    expect(onRecover).not.toHaveBeenCalled();
  });

  it("does not fire while fresh", () => {
    const onRecover = vi.fn();
    renderHook(() =>
      useFreshnessWatchdog(args({ onRecover, getLastMessageAt: () => Date.now() })),
    );
    vi.advanceTimersByTime(5_000);
    expect(onRecover).not.toHaveBeenCalled();
  });
});
