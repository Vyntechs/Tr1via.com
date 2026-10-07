// Cost-cut guarantees for the question builder. Everything here uses a
// MOCKED checker — no Anthropic calls. The point of each test is that the
// final accepted set is exactly what the old "check everything, then apply the
// free word check" order would have produced, while paying for fewer checks.

import { describe, expect, it } from "vitest";
import {
  classifyVerifiedQuestions,
  collectVerifiedQuestions,
} from "@/lib/ai/collect-verified-questions";
import type { GeneratedQuestion } from "@/lib/ai/generate-questions";
import type { AnswerVerdict } from "@/lib/ai/verify-answers";
import { VERIFY_CHUNK_SIZE } from "@/lib/ai/verify-answers";

function q(prompt: string, overrides: Partial<GeneratedQuestion> = {}): GeneratedQuestion {
  return {
    prompt,
    options: ["a", "b", "c", "d"],
    correctIndex: 0,
    difficulty: 4,
    factBlurb: "A plain fact blurb.",
    photoQuery: "q",
    ...overrides,
  };
}

const ok = (i: number): AnswerVerdict => ({
  index: i,
  markedAnswerIsCorrect: true,
  ambiguous: false,
  factBlurbIsCorrect: true,
  answerableWithoutImage: true,
  fitsRequestedTopic: true,
});

type Outcome =
  | "ok"
  | "wrong"
  | "ambiguous"
  | "missing"
  | "bad_blurb"
  | "needs_image"
  | "off_topic";

const OUTCOMES: Outcome[] = [
  "ok", "ok", "ok", "ok", "wrong", "ambiguous", "missing", "bad_blurb", "needs_image", "off_topic",
];

function verdictFor(outcome: Outcome, index: number): AnswerVerdict | null {
  switch (outcome) {
    case "ok": return ok(index);
    case "wrong": return { ...ok(index), markedAnswerIsCorrect: false };
    case "ambiguous": return { ...ok(index), ambiguous: true };
    case "missing": return null;
    case "bad_blurb": return { ...ok(index), factBlurbIsCorrect: false };
    case "needs_image": return { ...ok(index), answerableWithoutImage: false };
    case "off_topic": return { ...ok(index), fitsRequestedTopic: false };
  }
}

// Small seeded random number generator so the "many random batches" test is
// repeatable.
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A fake checker whose answer depends only on WHICH question and WHICH pass —
// never on what else is in the call — like a perfectly repeatable checker.
function makeChecker(outcomes: Map<string, Outcome[]>) {
  const calls: Array<{ pass: number; size: number }> = [];
  const verify = async (questions: GeneratedQuestion[], pass: number) => {
    calls.push({ pass, size: questions.length });
    const out: AnswerVerdict[] = [];
    questions.forEach((question, index) => {
      const verdict = verdictFor(outcomes.get(question.prompt)![pass] ?? "ok", index);
      if (verdict) out.push(verdict);
    });
    return out;
  };
  // What the real checker would bill: one call per chunk of 6 questions.
  const paidCalls = () =>
    calls.reduce((sum, call) => sum + Math.ceil(call.size / VERIFY_CHUNK_SIZE), 0);
  const questionsChecked = () => calls.reduce((sum, call) => sum + call.size, 0);
  return { verify, calls, paidCalls, questionsChecked };
}

const BLOCKED_BITS = [
  "What is the most famous bridge in Paris?",
  "Which iconic band played the Cavern Club?",
  "Which is the best-selling album of the 1980s?",
  "Which country uses the flag shown above?",
  "What does this logo stand for?",
];

function randomBatch(rand: () => number, size: number, tag: string) {
  const questions: GeneratedQuestion[] = [];
  const outcomes = new Map<string, Outcome[]>();
  for (let i = 0; i < size; i++) {
    const prompt = `${tag} question ${i}?`;
    let question = q(prompt);
    const roll = rand();
    if (roll < 0.25) {
      // Plant a word the free check rejects in the prompt, an option or the blurb.
      const bit = BLOCKED_BITS[Math.floor(rand() * BLOCKED_BITS.length)]!;
      const where = Math.floor(rand() * 3);
      if (where === 0) question = q(`${prompt} ${bit}`);
      else if (where === 1) question = q(prompt, { options: ["a", bit, "c", "d"] });
      else question = q(prompt, { factBlurb: bit });
      outcomes.set(question.prompt, [
        OUTCOMES[Math.floor(rand() * OUTCOMES.length)]!,
        OUTCOMES[Math.floor(rand() * OUTCOMES.length)]!,
      ]);
    } else {
      outcomes.set(prompt, [
        OUTCOMES[Math.floor(rand() * OUTCOMES.length)]!,
        OUTCOMES[Math.floor(rand() * OUTCOMES.length)]!,
      ]);
    }
    questions.push(question);
  }
  return { questions, outcomes };
}

// The old order, kept here as the yardstick: run every pass on the WHOLE batch
// side by side, then classify (which applies the word check last).
async function oldWayAcceptedPrompts(
  questions: GeneratedQuestion[],
  verify: (qs: GeneratedQuestion[], pass: number) => Promise<AnswerVerdict[]>,
) {
  const passResults = await Promise.all([0, 1].map((pass) => verify(questions, pass)));
  const classification = classifyVerifiedQuestions(questions, passResults);
  return classification.acceptedIndexes.map((index) => questions[index]!.prompt);
}

describe("free word check runs before the paid checks", () => {
  it("never sends a question the word check would reject to the checker", async () => {
    const seen: string[] = [];
    const out = await collectVerifiedQuestions({
      target: 10,
      maxRounds: 1,
      generate: async () => [
        q("Clean one?"),
        q("What is the most famous bridge in Paris?"),
        q("Clean two?", { options: ["a", "iconic", "c", "d"] }),
        q("Clean three?", { factBlurb: "Shown above is the answer." }),
        q("What does this logo stand for?"),
        q("Clean four?"),
      ],
      verify: async (questions) => {
        seen.push(...questions.map((item) => item.prompt));
        return questions.map((_, index) => ok(index));
      },
    });

    // Both checking passes see the two clean questions and nothing else.
    expect([...new Set(seen)]).toEqual(["Clean one?", "Clean four?"]);
    expect(out.map((item) => item.prompt)).toEqual(["Clean one?", "Clean four?"]);
  });

  it("still reports word-check rejections to the round event, in batch order", async () => {
    const events: Array<{ rejected: Array<{ prompt: string; reasons: string[] }> }> = [];
    await collectVerifiedQuestions({
      target: 10,
      maxRounds: 1,
      generate: async () => [
        q("What is the most famous bridge in Paris?"),
        q("Verifier says wrong?"),
        q("What does this logo stand for?"),
      ],
      verify: async (questions) =>
        questions.map((item, index) =>
          item.prompt.startsWith("Verifier") ? { ...ok(index), markedAnswerIsCorrect: false } : ok(index),
        ),
      onRoundComplete: (event) => {
        events.push(event);
      },
    });

    expect(events[0]?.rejected).toEqual([
      { prompt: "What is the most famous bridge in Paris?", reasons: ["deterministic_risk"] },
      { prompt: "Verifier says wrong?", reasons: ["verifier_wrong"] },
      { prompt: "What does this logo stand for?", reasons: ["deterministic_risk"] },
    ]);
  });

  it("makes no paid call at all when every question is rejected by the word check", async () => {
    let calls = 0;
    const out = await collectVerifiedQuestions({
      target: 2,
      maxRounds: 1,
      generate: async () => [q("What is the most famous bridge in Paris?")],
      verify: async () => {
        calls++;
        return [];
      },
    });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  it("accepts exactly the same questions as the old order on many random batches, with fewer checks", async () => {
    const rand = seeded(20261006);
    let oldChecked = 0;
    let newChecked = 0;
    for (let trial = 0; trial < 300; trial++) {
      const { questions, outcomes } = randomBatch(rand, 1 + Math.floor(rand() * 20), `t${trial}`);

      const oldChecker = makeChecker(outcomes);
      const expected = await oldWayAcceptedPrompts(questions, oldChecker.verify);

      const newChecker = makeChecker(outcomes);
      const got = await collectVerifiedQuestions({
        target: 100,
        maxRounds: 1,
        generate: async () => questions,
        verify: newChecker.verify,
      });

      expect(got.map((item) => item.prompt)).toEqual(expected);
      oldChecked += oldChecker.questionsChecked();
      newChecked += newChecker.questionsChecked();
    }
    expect(newChecked).toBeLessThan(oldChecked);
  });
});
