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

  // -------------------------------------------------------------------
  // NOTE: No separate timer-jump test for the slept→recover path.
  //
  // Why: vitest fake timers control Date.now() by advancing it in sync
  // with scheduled timer fire times. When a setInterval callback fires
  // after vi.advanceTimersByTime(N), Date.now() returns the timer's
  // scheduled fire time — NOT a wall-clock jumped ahead by a sleep gap.
  // A vi.setSystemTime() jump issued before the advance gets overridden
  // by vitest's internal clock step, so lastTickAt and now always differ
  // by ~WATCHDOG_INTERVAL_MS, never by SLEEP_GAP_MS. The slept branch
  // cannot be reliably triggered this way without flaking.
  //
  // Coverage by composition (accepted alternative per code-review):
  //   • The slept DECISION (lastTickAt gap ≥ SLEEP_GAP_MS AND visible)
  //     is unit-tested in freshnessWatchdog.test.ts:
  //       – "flags slept when a tick lands far later than expected…"
  //       – "does NOT flag slept when the tab is hidden…"
  //   • The hook forwards verdict.shouldRecover uniformly for both stale
  //     and slept paths — same lock/cooldown/onRecover wiring — proven
  //     by the stale test above ("calls onRecover once when stale…").
  //   So stale and slept take the identical execution path through the
  //   hook; a separate hook-level sleep test adds no new coverage.
  // -------------------------------------------------------------------
});
