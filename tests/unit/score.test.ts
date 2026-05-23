import { describe, it, expect } from "vitest";
import { awardPoints } from "@/lib/game/score";

describe("awardPoints", () => {
  it.each([
    { pointValue: 500, correct: true, msToLock: 2300, expected: 550 },
    { pointValue: 700, correct: true, msToLock: 4999, expected: 770 },
    { pointValue: 700, correct: true, msToLock: 5000, expected: 700 },
    { pointValue: 600, correct: true, msToLock: 19999, expected: 600 },
    { pointValue: 300, correct: false, msToLock: 1000, expected: 0 },
    { pointValue: 300, correct: false, msToLock: null, expected: 0 },
    { pointValue: 100, correct: true, msToLock: null, expected: 100 },
    { pointValue: 100, correct: true, msToLock: 0, expected: 110 },
  ])(
    "pts=$pointValue correct=$correct ms=$msToLock → $expected",
    ({ pointValue, correct, msToLock, expected }) => {
      expect(awardPoints({ pointValue, correct, msToLock })).toBe(expected);
    }
  );

  it("floors the speed bonus (no fractional points)", () => {
    // 100 * 1.1 = 110 exactly, but 150 * 1.1 = 165 and 350 * 1.1 = 385.
    // Confirm floor behavior with a value where 1.1 produces non-integer.
    // 100..700 step 100 all multiply cleanly to integers, but the floor
    // contract still matters for defense in depth.
    expect(awardPoints({ pointValue: 100, correct: true, msToLock: 1 })).toBe(110);
    expect(awardPoints({ pointValue: 200, correct: true, msToLock: 1 })).toBe(220);
    expect(awardPoints({ pointValue: 300, correct: true, msToLock: 1 })).toBe(330);
    expect(awardPoints({ pointValue: 400, correct: true, msToLock: 1 })).toBe(440);
    expect(awardPoints({ pointValue: 500, correct: true, msToLock: 1 })).toBe(550);
    expect(awardPoints({ pointValue: 600, correct: true, msToLock: 1 })).toBe(660);
    expect(awardPoints({ pointValue: 700, correct: true, msToLock: 1 })).toBe(770);
  });

  it("wrong answers always score 0 regardless of speed", () => {
    expect(awardPoints({ pointValue: 700, correct: false, msToLock: 100 })).toBe(0);
    expect(awardPoints({ pointValue: 100, correct: false, msToLock: 4999 })).toBe(0);
  });

  it("correct with exactly 5000ms gets face value (boundary)", () => {
    expect(awardPoints({ pointValue: 500, correct: true, msToLock: 5000 })).toBe(500);
  });

  it("correct with 4999ms gets the speed bonus (boundary)", () => {
    expect(awardPoints({ pointValue: 500, correct: true, msToLock: 4999 })).toBe(550);
  });

  it("correct with negative msToLock (clock skew) gets the speed bonus", () => {
    // Defensive: msToLock < 5000 is the rule, so negative qualifies.
    expect(awardPoints({ pointValue: 500, correct: true, msToLock: -10 })).toBe(550);
  });

  it("trusts caller-supplied pointValue (no validation)", () => {
    // Per the policy doc-comment: callers are trusted to pass a value
    // from {100..700}. We don't throw; we just compute the math.
    expect(awardPoints({ pointValue: 0, correct: true, msToLock: 1000 })).toBe(0);
    expect(awardPoints({ pointValue: 1000, correct: true, msToLock: 1000 })).toBe(1100);
  });
});
