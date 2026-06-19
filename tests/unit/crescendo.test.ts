import { describe, it, expect } from "vitest";
import { crescendoIntensity } from "@/lib/game/crescendo";

const CFG = { from: 0.9, to: 2.4, durationMs: 3000 };

describe("crescendoIntensity", () => {
  it("starts at `from` (elapsed 0)", () => {
    expect(crescendoIntensity(0, CFG)).toBeCloseTo(0.9, 5);
  });

  it("reaches `to` at the end and holds past the end", () => {
    expect(crescendoIntensity(3000, CFG)).toBeCloseTo(2.4, 5);
    expect(crescendoIntensity(9999, CFG)).toBeCloseTo(2.4, 5);
  });

  it("is monotonically increasing across the ramp", () => {
    let prev = -Infinity;
    for (let ms = 0; ms <= 3000; ms += 150) {
      const v = crescendoIntensity(ms, CFG);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("stays within [from, to] and is at the smoothstep midpoint at the halfway point", () => {
    const mid = crescendoIntensity(1500, CFG);
    expect(mid).toBeGreaterThan(0.9);
    expect(mid).toBeLessThan(2.4);
    // smoothstep(0.5) = 0.5 → exactly halfway in value too.
    expect(mid).toBeCloseTo(0.9 + (2.4 - 0.9) * 0.5, 5);
  });

  it("eases in (slow start): less than 10% of the rise in the first 10% of time", () => {
    const at10pct = crescendoIntensity(300, CFG);
    const linearAt10pct = 0.9 + (2.4 - 0.9) * 0.1;
    expect(at10pct).toBeLessThan(linearAt10pct);
  });

  it("never returns below `from` for negative elapsed (clamped)", () => {
    expect(crescendoIntensity(-500, CFG)).toBeCloseTo(0.9, 5);
  });

  it("returns `to` immediately for a zero/negative duration", () => {
    expect(crescendoIntensity(0, { from: 1, to: 2, durationMs: 0 })).toBe(2);
  });
});
