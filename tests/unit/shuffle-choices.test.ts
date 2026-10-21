import { describe, expect, it } from "vitest";
import { randomChoiceOrder, shuffleChoices } from "@/lib/ai/shuffle-choices";

const question = {
  prompt: "Which planet is closest to the Sun?",
  options: ["Mercury", "Venus", "Earth", "Mars"] as [string, string, string, string],
  correctIndex: 0 as const,
  difficulty: 2,
};

/** A fake random source that hands back a fixed sequence. */
function sequence(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe("randomChoiceOrder", () => {
  it("is always a permutation of [0,1,2,3]", () => {
    for (let i = 0; i < 500; i++) {
      expect([...randomChoiceOrder()].sort()).toEqual([0, 1, 2, 3]);
    }
  });

  it("is deterministic for a pinned random source", () => {
    expect(randomChoiceOrder(sequence([0]))).toEqual(randomChoiceOrder(sequence([0])));
    // random() = 0 swaps each slot with slot 0: a rotation, never identity.
    expect(randomChoiceOrder(sequence([0]))).toEqual([1, 2, 3, 0]);
    // random() just under 1 keeps every slot in place.
    expect(randomChoiceOrder(sequence([0.999]))).toEqual([0, 1, 2, 3]);
  });
});

describe("shuffleChoices", () => {
  it("keeps the same four options and the same right answer text", () => {
    for (let i = 0; i < 200; i++) {
      const out = shuffleChoices(question);
      expect([...out.options].sort()).toEqual([...question.options].sort());
      expect(out.options[out.correctIndex]).toBe("Mercury");
    }
  });

  it("does not mutate the input", () => {
    const before = JSON.stringify(question);
    shuffleChoices(question, sequence([0]));
    expect(JSON.stringify(question)).toBe(before);
  });

  it("keeps every other field", () => {
    const out = shuffleChoices(question, sequence([0]));
    expect(out.prompt).toBe(question.prompt);
    expect(out.difficulty).toBe(question.difficulty);
  });

  it("lands the right answer in every slot over many shuffles", () => {
    // The writer puts the answer in slot A ~96% of the time; after the shuffle
    // each slot should get it roughly a quarter of the time.
    const counts = [0, 0, 0, 0];
    const runs = 4000;
    for (let i = 0; i < runs; i++) counts[shuffleChoices(question).correctIndex]!++;
    for (const c of counts) {
      expect(c).toBeGreaterThan(runs * 0.18);
      expect(c).toBeLessThan(runs * 0.32);
    }
  });

  it("moves correctIndex with the answer for a pinned order", () => {
    // Order [1,2,3,0]: options become [Venus, Earth, Mars, Mercury].
    const out = shuffleChoices(question, sequence([0]));
    expect(out.options).toEqual(["Venus", "Earth", "Mars", "Mercury"]);
    expect(out.correctIndex).toBe(3);
  });
});
