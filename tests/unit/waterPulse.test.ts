import { describe, it, expect } from "vitest";
import { shouldFireReveal, newLockIds } from "@/lib/player/waterPulse";

describe("waterPulse", () => {
  it("fires reveal once per resolved question id", () => {
    expect(shouldFireReveal("q1", null)).toBe(true);
    expect(shouldFireReveal("q1", "q1")).toBe(false); // already fired
    expect(shouldFireReveal("q2", "q1")).toBe(true);  // new question
    expect(shouldFireReveal(null, "q1")).toBe(false); // not resolved
    expect(shouldFireReveal(null, null)).toBe(false); // initial state
  });

  it("returns only lock playerIds not already rippled", () => {
    const seen = new Set<string>(["a"]);
    expect(newLockIds(["a", "b", "c"], seen)).toEqual(["b", "c"]);
    expect(newLockIds(["a"], seen)).toEqual([]);
    expect(newLockIds(["a", "b", "c"], new Set(["b"]))).toEqual(["a", "c"]); // order preserved, non-prefix
    expect(newLockIds([], new Set(["a"]))).toEqual([]);                       // nothing to ripple
  });
});
