import { describe, it, expect } from "vitest";
import { collectVerifiedQuestions } from "@/lib/ai/collect-verified-questions";
import type { GeneratedQuestion } from "@/lib/ai/generate-questions";
import type { AnswerVerdict } from "@/lib/ai/verify-answers";

function q(prompt: string): GeneratedQuestion {
  return { prompt, options: ["a", "b", "c", "d"], correctIndex: 0, difficulty: 4, factBlurb: "blurb here", photoQuery: "q" };
}
const ok = (i: number): AnswerVerdict => ({ index: i, markedAnswerIsCorrect: true, ambiguous: false, trueAnswer: "a" });
const wrong = (i: number): AnswerVerdict => ({ index: i, markedAnswerIsCorrect: false, ambiguous: false, trueAnswer: "b" });
const ambig = (i: number): AnswerVerdict => ({ index: i, markedAnswerIsCorrect: true, ambiguous: true, trueAnswer: "a" });

it("keeps only correct, non-ambiguous questions", async () => {
  const batch = [q("k1"), q("wrong"), q("amb"), q("k2")];
  const out = await collectVerifiedQuestions({
    target: 10,
    maxRounds: 1,
    generate: async () => batch,
    verify: async () => [ok(0), wrong(1), ambig(2), ok(3)],
  });
  expect(out.map((x) => x.prompt)).toEqual(["k1", "k2"]);
});

it("regenerates avoiding seen prompts until target is reached", async () => {
  const seenByRound: string[][] = [];
  const out = await collectVerifiedQuestions({
    target: 2,
    maxRounds: 3,
    generate: async (avoid) => {
      seenByRound.push(avoid);
      const n = seenByRound.length;
      return [q(`r${n}-good`), q(`r${n}-bad`)];
    },
    verify: async () => [ok(0), wrong(1)],
  });
  expect(out.map((x) => x.prompt)).toEqual(["r1-good", "r2-good"]);
  expect(seenByRound[0]).toEqual([]);                       // round 1 avoids nothing
  expect(seenByRound[1]).toContain("r1-good");              // round 2 avoids round 1's prompts
  expect(seenByRound[1]).toContain("r1-bad");
});

it("emits fewer (never throws) when rounds are exhausted", async () => {
  const out = await collectVerifiedQuestions({
    target: 20,
    maxRounds: 2,
    generate: async () => [q("only-good"), q("only-bad")],
    verify: async () => [ok(0), wrong(1)],
  });
  expect(out).toHaveLength(2);                              // 1 good per round × 2 rounds
});

it("stops early when generation dries up", async () => {
  let calls = 0;
  const out = await collectVerifiedQuestions({
    target: 20,
    maxRounds: 5,
    generate: async () => { calls++; return calls === 1 ? [q("g")] : []; },
    verify: async () => [ok(0)],
  });
  expect(out).toHaveLength(1);
  expect(calls).toBe(2);                                    // round 2 returns empty → stop
});
