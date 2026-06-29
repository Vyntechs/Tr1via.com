import { it, expect } from "vitest";
import { collectVerifiedQuestions } from "@/lib/ai/collect-verified-questions";
import type { GeneratedQuestion } from "@/lib/ai/generate-questions";
import type { AnswerVerdict } from "@/lib/ai/verify-answers";

function q(prompt: string): GeneratedQuestion {
  return { prompt, options: ["a", "b", "c", "d"], correctIndex: 0, difficulty: 4, factBlurb: "blurb here", photoQuery: "q" };
}
const ok = (i: number): AnswerVerdict => ({ index: i, markedAnswerIsCorrect: true, ambiguous: false });
const wrong = (i: number): AnswerVerdict => ({ index: i, markedAnswerIsCorrect: false, ambiguous: false });
const ambig = (i: number): AnswerVerdict => ({ index: i, markedAnswerIsCorrect: true, ambiguous: true });

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

it("reports verifier rejection reasons for a completed round", async () => {
  const events: Array<{
    round: number;
    requested: number;
    generated: number;
    accepted: number;
    rejected: Array<{ prompt: string; reasons: string[] }>;
  }> = [];
  const batch = [
    q("clean"),
    q("wrong"),
    q("ambiguous"),
    q("missing"),
    q("wrong and ambiguous"),
  ];

  const out = await collectVerifiedQuestions({
    target: 10,
    maxRounds: 1,
    verifyPasses: 1,
    generate: async () => batch,
    verify: async () => [
      ok(0),
      wrong(1),
      ambig(2),
      { index: 4, markedAnswerIsCorrect: false, ambiguous: true },
    ],
    onRoundComplete: (event) => events.push(event),
  });

  expect(out.map((x) => x.prompt)).toEqual(["clean"]);
  expect(events).toEqual([
    {
      round: 1,
      requested: 10,
      generated: 5,
      accepted: 1,
      rejected: [
        { prompt: "wrong", reasons: ["verifier_wrong"] },
        { prompt: "ambiguous", reasons: ["verifier_ambiguous"] },
        { prompt: "missing", reasons: ["missing_verdict"] },
        {
          prompt: "wrong and ambiguous",
          reasons: ["verifier_wrong", "verifier_ambiguous"],
        },
      ],
    },
  ]);
});

it("reports empty generation rounds before stopping", async () => {
  const events: Array<{
    round: number;
    requested: number;
    generated: number;
    accepted: number;
    rejected: Array<{ prompt: string; reasons: string[] }>;
  }> = [];
  let verifyCalls = 0;

  const out = await collectVerifiedQuestions({
    target: 3,
    maxRounds: 5,
    generate: async () => [],
    verify: async () => {
      verifyCalls++;
      return [];
    },
    onRoundComplete: (event) => events.push(event),
  });

  expect(out).toEqual([]);
  expect(verifyCalls).toBe(0);
  expect(events).toEqual([
    {
      round: 1,
      requested: 3,
      generated: 0,
      accepted: 0,
      rejected: [],
    },
  ]);
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

it("refills only the shortfall — `need` shrinks to the remaining gap each round", async () => {
  // Each round returns `need` questions, exactly ONE of which is good. So the
  // gap closes by 1 per round and `need` should shrink: target → target-1 → …
  const needByRound: number[] = [];
  const out = await collectVerifiedQuestions({
    target: 4,
    maxRounds: 3,
    generate: async (_avoid, need) => {
      needByRound.push(need);
      const n = needByRound.length;
      const items: GeneratedQuestion[] = [q(`r${n}-good`)];
      for (let i = 1; i < need; i++) items.push(q(`r${n}-bad${i}`));
      return items;
    },
    verify: async (qs) =>
      qs.map((qq, i) => (qq.prompt.includes("-bad") ? wrong(i) : ok(i))),
  });
  expect(needByRound).toEqual([4, 3, 2]); // asks only the remaining gap, not a full batch
  expect(out.map((x) => x.prompt)).toEqual(["r1-good", "r2-good", "r3-good"]);
});

it("tops a verified-but-short batch back up to the full target", async () => {
  // Round 1: 4 questions, 1 rejected → 3 clean. Round 2 should refill the 1 gap.
  let round = 0;
  const out = await collectVerifiedQuestions({
    target: 4,
    maxRounds: 3,
    generate: async (_avoid, need) => {
      round++;
      if (round === 1) return [q("a"), q("b"), q("c"), q("bad")];
      return Array.from({ length: need }, (_, i) => q(`fill${i}`));
    },
    verify: async (qs) =>
      qs.map((qq, i) => (qq.prompt === "bad" ? wrong(i) : ok(i))),
  });
  expect(out).toHaveLength(4); // refilled to the full target
  expect(out.map((x) => x.prompt)).toEqual(["a", "b", "c", "fill0"]);
});

it("requires ALL verify passes to agree — drops a question one pass flags (verifyPasses default 2)", async () => {
  let call = 0;
  const out = await collectVerifiedQuestions({
    target: 10,
    maxRounds: 1,
    generate: async () => [q("agree"), q("split")],
    // Two concurrent passes: one says both clean, the other flags "split" (index 1).
    verify: async () => {
      call++;
      return call === 1 ? [ok(0), ok(1)] : [ok(0), wrong(1)];
    },
  });
  expect(out.map((x) => x.prompt)).toEqual(["agree"]); // "split" dropped — passes disagreed
});
