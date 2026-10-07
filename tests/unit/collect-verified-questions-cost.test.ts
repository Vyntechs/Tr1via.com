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
import { VERIFY_CHUNK_SIZE, verifyAnswers } from "@/lib/ai/verify-answers";

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
      expect(newChecker.paidCalls()).toBeLessThanOrEqual(oldChecker.paidCalls());
      oldChecked += oldChecker.questionsChecked();
      newChecked += newChecker.questionsChecked();
    }
    expect(newChecked).toBeLessThan(oldChecked);
  });
});

describe("the two paid passes run one after the other", () => {
  it("sends the second pass only the questions that passed the first", async () => {
    const order: string[] = [];
    const sizes: number[] = [];
    const out = await collectVerifiedQuestions({
      target: 10,
      maxRounds: 1,
      generate: async () => [q("a?"), q("fails blind?"), q("c?"), q("fails second?")],
      verify: async (questions, pass) => {
        order.push(`start${pass}`);
        sizes.push(questions.length);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(`end${pass}`);
        return questions.map((item, index) => {
          if (pass === 0 && item.prompt === "fails blind?") {
            return { ...ok(index), markedAnswerIsCorrect: false };
          }
          if (pass === 1 && item.prompt === "fails second?") {
            return { ...ok(index), ambiguous: true };
          }
          return ok(index);
        });
      },
    });

    expect(order).toEqual(["start0", "end0", "start1", "end1"]);
    expect(sizes).toEqual([4, 3]);
    expect(out.map((item) => item.prompt)).toEqual(["a?", "c?"]);
  });

  it("reports a question's reasons from the pass that rejected it", async () => {
    const events: Array<{ rejected: Array<{ prompt: string; reasons: string[] }> }> = [];
    await collectVerifiedQuestions({
      target: 10,
      maxRounds: 1,
      generate: async () => [q("blind says wrong?"), q("second says unsupported blurb?"), q("clean?")],
      verify: async (questions, pass) =>
        questions.map((item, index) => {
          if (pass === 0 && item.prompt.startsWith("blind")) {
            return { ...ok(index), markedAnswerIsCorrect: false };
          }
          if (pass === 1 && item.prompt.startsWith("second")) {
            return { ...ok(index), factBlurbIsCorrect: false };
          }
          return ok(index);
        }),
      onRoundComplete: (event) => {
        events.push(event);
      },
    });

    expect(events[0]?.rejected).toEqual([
      { prompt: "blind says wrong?", reasons: ["verifier_wrong"] },
      { prompt: "second says unsupported blurb?", reasons: ["fact_blurb_wrong"] },
    ]);
  });

  it("treats a missing verdict in the second pass as a rejection, same as before", async () => {
    const out = await collectVerifiedQuestions({
      target: 10,
      maxRounds: 1,
      generate: async () => [q("kept?"), q("no second verdict?")],
      verify: async (questions, pass) =>
        pass === 1
          ? [ok(0)] // nothing for local index 1
          : questions.map((_, index) => ok(index)),
    });
    expect(out.map((item) => item.prompt)).toEqual(["kept?"]);
  });

  it("an error in the first pass stops the build without ever paying for the second", async () => {
    const passesRun: number[] = [];
    await expect(
      collectVerifiedQuestions({
        target: 10,
        maxRounds: 1,
        generate: async () => [q("a?")],
        verify: async (_questions, pass) => {
          passesRun.push(pass);
          throw new Error("rate limited");
        },
      }),
    ).rejects.toThrow("rate limited");
    expect(passesRun).toEqual([0]);
  });
});

// A stand-in for the Anthropic client that answers from a table, so the REAL
// verifyAnswers (6 questions per call, 3 tries per call) runs and every call it
// would have billed is counted. No network.
function fakeAnthropic(outcomes: Map<string, Outcome[]>) {
  const create = async (params: Record<string, unknown>) => {
    const content = (params.messages as Array<{ content: string }>)[0]!.content;
    const payload = JSON.parse(content.slice(content.indexOf("\n") + 1)) as Array<{
      index: number;
      prompt: string;
    }>;
    const tool = (params.tools as Array<{ input_schema: { properties: { verdicts: { items: { properties: Record<string, unknown> } } } } }>)[0]!;
    const blind = "derivedCorrectIndex" in tool.input_schema.properties.verdicts.items.properties;
    const pass = blind ? 0 : 1;
    const verdicts = payload.flatMap((item) => {
      const outcome = outcomes.get(item.prompt)![pass] ?? "ok";
      const v = verdictFor(outcome, item.index);
      if (!v) return [];
      return [
        blind
          ? {
              index: v.index,
              derivedCorrectIndex: v.markedAnswerIsCorrect ? 0 : 1,
              ambiguous: v.ambiguous,
              answerableWithoutImage: v.answerableWithoutImage,
              fitsRequestedTopic: v.fitsRequestedTopic,
              basis: "mock",
            }
          : { ...v, basis: "mock" },
      ];
    });
    return {
      content: [{ type: "tool_use", name: "verdicts", id: "t", input: { verdicts } }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  };
  const calls = { count: 0 };
  return {
    client: {
      messages: {
        create: async (params: Record<string, unknown>) => {
          calls.count++;
          return create(params);
        },
      },
    },
    calls,
  };
}

describe("with the real checker code and a pretend Anthropic client", () => {
  it("accepts the same questions as the old way and makes 5 paid calls instead of 8", async () => {
    // 20 questions: 4 the word check rejects, 5 that fail the blind pass,
    // 2 that pass blind but fail the adversarial pass, 9 clean.
    const questions: GeneratedQuestion[] = [];
    const outcomes = new Map<string, Outcome[]>();
    for (let i = 0; i < 20; i++) {
      let prompt = `Question ${i}?`;
      let outcome: Outcome[] = ["ok", "ok"];
      if (i < 4) prompt = `What is the most famous thing number ${i}?`;
      else if (i < 9) outcome = ["wrong", "ok"];
      else if (i < 11) outcome = ["ok", "ambiguous"];
      questions.push(q(prompt));
      outcomes.set(prompt, outcome);
    }

    // Old way: both passes on all 20 at once, word check last.
    const oldFake = fakeAnthropic(outcomes);
    const oldPassResults = await Promise.all([
      verifyAnswers(questions, { client: oldFake.client as never, topic: "t", mode: "blind" }),
      verifyAnswers(questions, { client: oldFake.client as never, topic: "t", mode: "adversarial" }),
    ]);
    const oldAccepted = classifyVerifiedQuestions(questions, oldPassResults).acceptedIndexes.map(
      (index) => questions[index]!.prompt,
    );

    // New way, through the real collection loop.
    const newFake = fakeAnthropic(outcomes);
    const newAccepted = await collectVerifiedQuestions({
      target: 20,
      maxRounds: 1,
      generate: async () => questions,
      verify: (batch, pass) =>
        verifyAnswers(batch, {
          client: newFake.client as never,
          topic: "t",
          mode: pass === 0 ? "blind" : "adversarial",
        }),
    });

    expect(newAccepted.map((item) => item.prompt)).toEqual(oldAccepted);
    expect(newAccepted).toHaveLength(9);
    expect(oldFake.calls.count).toBe(8); // 2 passes x 4 calls of up to 6
    expect(newFake.calls.count).toBe(5); // 16 blind (3 calls) + 11 adversarial (2 calls)
  });
});
