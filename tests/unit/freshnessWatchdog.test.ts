// tests/unit/freshnessWatchdog.test.ts
import { describe, it, expect } from "vitest";
import {
  evaluateFreshness,
  STALE_MS,
  SLEEP_GAP_MS,
} from "@/lib/realtime/freshnessWatchdog";

const base = {
  now: 1_000_000,
  lastMessageAt: 1_000_000,
  lastTickAt: 1_000_000 - 1_000, // a normal 1s tick ago
  subscribed: true,
  visible: true,
};

describe("evaluateFreshness", () => {
  it("does nothing when messages are flowing and ticks are on time", () => {
    expect(evaluateFreshness(base)).toEqual({ stale: false, slept: false, shouldRecover: false });
  });

  it("flags stale when subscribed but silent past STALE_MS", () => {
    const v = evaluateFreshness({ ...base, lastMessageAt: base.now - (STALE_MS + 1) });
    expect(v.stale).toBe(true);
    expect(v.shouldRecover).toBe(true);
  });

  it("does NOT flag stale when not subscribed (channel-error layer owns that)", () => {
    const v = evaluateFreshness({ ...base, subscribed: false, lastMessageAt: base.now - (STALE_MS + 1) });
    expect(v.stale).toBe(false);
    expect(v.shouldRecover).toBe(false);
  });

  it("flags slept when a tick lands far later than expected AND tab is visible", () => {
    const v = evaluateFreshness({ ...base, lastTickAt: base.now - (SLEEP_GAP_MS + 1) });
    expect(v.slept).toBe(true);
    expect(v.shouldRecover).toBe(true);
  });

  it("does NOT flag slept when the tab is hidden (background timer throttling, not real sleep)", () => {
    const v = evaluateFreshness({ ...base, visible: false, lastTickAt: base.now - (SLEEP_GAP_MS + 1) });
    expect(v.slept).toBe(false);
    expect(v.shouldRecover).toBe(false);
  });

  it("respects custom thresholds", () => {
    const v = evaluateFreshness({ ...base, lastMessageAt: base.now - 50, staleMs: 40, subscribed: true });
    expect(v.stale).toBe(true);
  });
});
