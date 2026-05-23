import { describe, it, expect } from "vitest";
import { scrambleFor, correctSlotFor } from "@/lib/game/scramble";

describe("scrambleFor", () => {
  it("is deterministic for the same (questionId, playerId)", () => {
    const first = scrambleFor("q-123", "p-abc");
    for (let i = 0; i < 100; i++) {
      expect(scrambleFor("q-123", "p-abc")).toEqual(first);
    }
  });

  it("returns a length-4 tuple", () => {
    const scramble = scrambleFor("q-1", "p-1");
    expect(scramble).toHaveLength(4);
  });

  it("is a valid permutation of [0,1,2,3] for 50 random (qId, pId) pairs", () => {
    for (let i = 0; i < 50; i++) {
      const qId = `q-${Math.random().toString(36).slice(2)}`;
      const pId = `p-${Math.random().toString(36).slice(2)}`;
      const scramble = scrambleFor(qId, pId);
      const sorted = [...scramble].sort((a, b) => a - b);
      expect(sorted, `scramble for (${qId}, ${pId}) must permute [0,1,2,3]`).toEqual([
        0, 1, 2, 3,
      ]);
    }
  });

  it("each entry is an integer in 0..3", () => {
    for (let i = 0; i < 50; i++) {
      const scramble = scrambleFor(`q-${i}`, `p-${i}`);
      for (const slot of scramble) {
        expect(Number.isInteger(slot)).toBe(true);
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(slot).toBeLessThanOrEqual(3);
      }
    }
  });

  it("produces a well-distributed mix of scrambles across many inputs", () => {
    // Only 4! = 24 possible permutations exist, so 50 random calls cannot
    // exceed 24 unique outputs. Expected unique ≈ 24 * (1 - (23/24)^50) ≈ 21.
    // Assert we hit at least 18 unique permutations — confirms the PRNG
    // explores the space rather than collapsing to a few values.
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const scramble = scrambleFor(`q-${i}`, `p-${i}`);
      seen.add(scramble.join(","));
    }
    expect(seen.size).toBeGreaterThanOrEqual(18);
  });

  it("differs across players for the same question (probabilistically)", () => {
    let diffCount = 0;
    for (let i = 0; i < 20; i++) {
      const a = scrambleFor("q-fixed", `p-${i}-a`);
      const b = scrambleFor("q-fixed", `p-${i}-b`);
      if (a.join(",") !== b.join(",")) diffCount++;
    }
    // With 24 permutations, two random players match ~1/24 of the time.
    // Out of 20 pairs we expect ~19 to differ. Allow a generous margin.
    expect(diffCount).toBeGreaterThanOrEqual(15);
  });
});

describe("correctSlotFor", () => {
  it("returns the 1-based slot where correctIndex landed", () => {
    expect(correctSlotFor([2, 0, 3, 1], 0)).toBe(2);
    expect(correctSlotFor([2, 0, 3, 1], 1)).toBe(4);
    expect(correctSlotFor([2, 0, 3, 1], 2)).toBe(1);
    expect(correctSlotFor([2, 0, 3, 1], 3)).toBe(3);
  });

  it("works with real scrambleFor output", () => {
    const scramble = scrambleFor("q-real", "p-real");
    const correctIndex = 1; // canonical correct answer
    const slot = correctSlotFor(scramble, correctIndex);
    expect(slot).toBeGreaterThanOrEqual(1);
    expect(slot).toBeLessThanOrEqual(4);
    expect(scramble[slot - 1]).toBe(correctIndex);
  });
});
