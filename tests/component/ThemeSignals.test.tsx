// Theme "beat" signals are fired by game screens from their own effects. A
// broken listener must be skipped (and logged once) without throwing back
// into the screen, and the other listeners must still hear the beat.

import { afterEach, describe, expect, it, vi } from "vitest";
import { __subscribeJuneBeatForTest, fireJuneBeat } from "@/components/system/JuneSky";
import { __subscribeLightningBeatForTest, fireLightningBeat } from "@/components/system/Lightning";
import {
  __pyroBeatTest,
  __pyroLockInTest,
  fireLockInBurst,
  publishPyrotechnicsBeat,
} from "@/components/system/Pyrotechnics";

afterEach(() => {
  vi.restoreAllMocks();
  __pyroBeatTest.reset();
});

function brokenThenHealthy<T extends unknown[]>(subscribe: (fn: (...args: T) => void) => () => void) {
  const reached = vi.fn();
  const offBroken = subscribe(() => {
    throw new Error("listener exploded");
  });
  const offHealthy = subscribe(reached as unknown as (...args: T) => void);
  return { reached, off: () => (offBroken(), offHealthy()) };
}

describe("theme beat signals skip a broken listener", () => {
  it("June sky", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reached, off } = brokenThenHealthy(__subscribeJuneBeatForTest);
    expect(() => fireJuneBeat("lock")).not.toThrow();
    expect(reached).toHaveBeenCalledWith("lock");
    off();
  });

  it("May lightning", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reached, off } = brokenThenHealthy(__subscribeLightningBeatForTest);
    expect(() => fireLightningBeat("close", { tint: "#E64A8C" })).not.toThrow();
    expect(reached).toHaveBeenCalledWith("close", { tint: "#E64A8C" });
    off();
  });

  it("July firework beat", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reached, off } = brokenThenHealthy(__pyroBeatTest.subscribe);
    expect(() => publishPyrotechnicsBeat("salvo", 200)).not.toThrow();
    expect(reached).toHaveBeenCalled();
    off();
  });

  it("July lock-in burst", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reached, off } = brokenThenHealthy(__pyroLockInTest.subscribe);
    expect(() => fireLockInBurst("#5AA8E0")).not.toThrow();
    expect(reached).toHaveBeenCalledWith("#5AA8E0");
    off();
  });
});
