// @vitest-environment node
//
// The NEW question writer (engine "new"), driven through the REAL SDK stream:
// a real Anthropic client whose injected `fetch` answers with a canned
// server-sent-event body. No network, no key, no cost.

import { describe, it, expect, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";

import {
  generateQuestionsNew,
  countCompleteNewQuestions,
  NEW_WRITER_MAX_TOKENS,
  NEW_WRITER_MODEL,
} from "@/lib/ai/generate-questions-new";
import { collectVerifiedQuestions } from "@/lib/ai/collect-verified-questions";
import type { GenerateQuestionsRejectedCandidate } from "@/lib/ai/generate-questions";

const NOW = new Date("2026-10-21T18:00:00Z"); // Wed Oct 21, 1pm in Texas

const Q = (n: number, overrides: Record<string, unknown> = {}) => ({
  question: `Which U.S. city hosts test question number ${n} of this batch?`,
  rightAnswer: `Right ${n}`,
  wrongAnswer1: `Wrong A${n}`,
  wrongAnswer2: `Wrong B${n}`,
  wrongAnswer3: `Wrong C${n}`,
  difficulty: (n % 7) + 1,
  factNote: `Test fact note for question ${n}, long enough to pass.`,
  photoWords: "city skyline dusk",
  ...overrides,
});

function ev(e: Record<string, unknown>): string {
  return `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`;
}

/** A Sonnet 5.5 style reply: an (empty, omitted) thinking block, then the
 *  structured-output JSON as text deltas. */
function replySse(text: string, stopReason = "end_turn"): string {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 60) chunks.push(text.slice(i, i + 60));
  return [
    ev({
      type: "message_start",
      message: {
        id: "msg_new",
        type: "message",
        role: "assistant",
        model: NEW_WRITER_MODEL,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: 1 },
      },
    }),
    ev({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }),
    ev({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } }),
    ev({ type: "content_block_stop", index: 0 }),
    ev({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }),
    ...chunks.map((c) =>
      ev({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: c } }),
    ),
    ev({ type: "content_block_stop", index: 1 }),
    ev({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 4200 } }),
    ev({ type: "message_stop" }),
  ].join("");
}

function clientReplying(...bodies: string[]) {
  const sent: Array<Record<string, unknown>> = [];
  let call = 0;
  const fetchFn = async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const body = bodies[Math.min(call++, bodies.length - 1)]!;
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const client = new Anthropic({ apiKey: "test-key", fetch: fetchFn as unknown as typeof fetch });
  return { client, sent };
}

const batchJson = (qs: unknown[]) => JSON.stringify({ questions: qs });
const twenty = () => Array.from({ length: 20 }, (_, i) => Q(i + 1));

/** Deterministic randomness so the shuffle test cannot flake. */
function lcg(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("new writer · request", () => {
  it("asks Sonnet 5.5 at effort medium for structured output, 20,000 tokens, no temperature or forced tool", async () => {
    const { client, sent } = clientReplying(replySse(batchJson(twenty())));
    await generateQuestionsNew({ topic: "Pixar movies", client, now: NOW });

    expect(sent).toHaveLength(1);
    const body = sent[0]!;
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.max_tokens).toBe(20_000);
    expect(NEW_WRITER_MAX_TOKENS).toBe(20_000);
    const oc = body.output_config as { effort: string; format: { type: string; schema: unknown } };
    expect(oc.effort).toBe("medium");
    expect(oc.format.type).toBe("json_schema");
    for (const key of ["temperature", "tools", "tool_choice", "thinking", "top_p", "top_k"]) {
      expect(body, key).not.toHaveProperty(key);
    }
    const user = (body.messages as Array<{ content: string }>)[0]!.content;
    expect(user).toContain("Today's date: Wednesday, October 21, 2026");
    expect(user).toContain("Topic: Pixar movies");
    expect(user).toContain("Write exactly 20 questions");
  });

  it("the schema has separate right and wrong answer fields and no limits the API refuses", async () => {
    const { client, sent } = clientReplying(replySse(batchJson(twenty())));
    await generateQuestionsNew({ topic: "Pixar movies", client, now: NOW });
    const schema = (sent[0]!.output_config as { format: { schema: unknown } }).format.schema;
    const text = JSON.stringify(schema);
    for (const f of ["question", "rightAnswer", "wrongAnswer1", "wrongAnswer2", "wrongAnswer3", "difficulty", "factNote", "photoWords"]) {
      expect(text).toContain(`"${f}"`);
    }
    for (const banned of ["minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems"]) {
      expect(text).not.toContain(banned);
    }
  });

  it("never asks for more than 20 in one call", async () => {
    const { client, sent } = clientReplying(replySse(batchJson(twenty())));
    await generateQuestionsNew({ topic: "Pixar movies", client, now: NOW, count: 30 });
    expect((sent[0]!.messages as Array<{ content: string }>)[0]!.content).toContain("Write exactly 20 questions");
  });
});

describe("new writer · output", () => {
  it("maps into Classic's storage shape and keeps the right answer marked after the shuffle", async () => {
    const { client } = clientReplying(replySse(batchJson(twenty())));
    const out = await generateQuestionsNew({ topic: "Cities", client, now: NOW, random: lcg() });

    expect(out).toHaveLength(20);
    out.forEach((q, i) => {
      expect(Object.keys(q).sort()).toEqual(
        ["correctIndex", "difficulty", "factBlurb", "options", "photoQuery", "prompt"],
      );
      expect(q.prompt).toBe(Q(i + 1).question);
      expect(q.options[q.correctIndex]).toBe(`Right ${i + 1}`);
      expect([...q.options].sort()).toEqual(
        [`Right ${i + 1}`, `Wrong A${i + 1}`, `Wrong B${i + 1}`, `Wrong C${i + 1}`].sort(),
      );
      expect(q.factBlurb).toBe(Q(i + 1).factNote);
      expect(q.photoQuery).toBe("city skyline dusk");
    });
    // The code, not the model, decides the slot: all four slots get used.
    expect(new Set(out.map((q) => q.correctIndex)).size).toBe(4);
  });

  it("ticks the written count while the reply is still arriving", async () => {
    const { client } = clientReplying(replySse(batchJson(twenty())));
    const ticks: number[] = [];
    await generateQuestionsNew({ topic: "Cities", client, now: NOW, onWritten: (n) => ticks.push(n) });
    expect(ticks.length).toBeGreaterThan(5);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    expect(ticks.at(-1)).toBe(20);
    expect(countCompleteNewQuestions('{"questions":[{"question":"a"},{"quest')).toBe(1);
    expect(countCompleteNewQuestions("not json at all {{{")).toBe(0);
  });
});

describe("new writer · the 20 guard (never store fewer silently)", () => {
  it("a short batch returns only the usable questions, reports every drop, warns about the shortfall, and never pads", async () => {
    const qs = twenty();
    qs[2] = Q(3, { wrongAnswer1: "Right 3" }); // duplicate of the right answer
    qs[5] = Q(6, { question: "Short?" }); // under 8 characters
    qs[8] = Q(9, { factNote: "" }); // empty fact note
    qs[11] = Q(12, { difficulty: 9 }); // off the 1..7 scale
    qs[14] = (({ photoWords: _drop, ...rest }) => rest)(Q(15)) as ReturnType<typeof Q>; // missing field
    qs[17] = Q(18, { rightAnswer: "" }); // empty right answer
    const { client } = clientReplying(replySse(batchJson(qs)));
    const rejected: GenerateQuestionsRejectedCandidate[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const out = await generateQuestionsNew({
      topic: "Cities",
      client,
      now: NOW,
      onRejectedCandidate: (c) => rejected.push(c),
    });

    expect(out).toHaveLength(14);
    expect(rejected.map((r) => r.index)).toEqual([2, 5, 8, 11, 14, 17]);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("SHORT BATCH: 14 of 20"))).toBe(true);
    warn.mockRestore();
  });

  it("a reply cut off at the output limit drops the unfinished last question and reports it", async () => {
    const full = batchJson(twenty());
    // Cut in the middle of question 19's fact note.
    const cutAt = full.indexOf("Test fact note for question 19") + 12;
    const { client } = clientReplying(replySse(full.slice(0, cutAt), "max_tokens"));
    const rejected: GenerateQuestionsRejectedCandidate[] = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const out = await generateQuestionsNew({
      topic: "Cities",
      client,
      now: NOW,
      onRejectedCandidate: (c) => rejected.push(c),
    });

    expect(out).toHaveLength(18);
    expect(out.every((q) => !q.factBlurb.endsWith("question 1"))).toBe(true);
    expect(rejected).toEqual([
      expect.objectContaining({ index: 18, issues: ["cut off at the output limit"] }),
    ]);
    vi.restoreAllMocks();
  });

  it("a reply cut off before any question finished names the output limit, not missing text", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Thinking ate the whole limit: no text block at all.
    const thinkingOnly = clientReplying(replySse("", "max_tokens"));
    await expect(
      generateQuestionsNew({ topic: "x", client: thinkingOnly.client, now: NOW }),
    ).rejects.toThrow(`hit the ${NEW_WRITER_MAX_TOKENS}-token output limit before any question finished`);

    // Thinking ate most of it: the first question was still open at the cut.
    const firstOpen = clientReplying(replySse(batchJson(twenty()).slice(0, 80), "max_tokens"));
    const err = await generateQuestionsNew({ topic: "x", client: firstOpen.client, now: NOW }).catch((e: Error) => e);
    expect(String(err)).toMatch(/output limit before any question finished/);
    expect(String(err)).not.toMatch(/no question text|not valid JSON/);
    vi.restoreAllMocks();
  });

  it("broken JSON, a refusal, or zero usable questions fail loudly instead of storing nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = clientReplying(replySse('{"questions": [ {"question": "oops"'));
    await expect(generateQuestionsNew({ topic: "x", client: broken.client, now: NOW })).rejects.toThrow(/not valid JSON/);

    const refusal = clientReplying(replySse("", "refusal"));
    await expect(generateQuestionsNew({ topic: "x", client: refusal.client, now: NOW })).rejects.toThrow(/declined/);

    const allBad = clientReplying(replySse(batchJson([Q(1, { question: "?" }), Q(2, { question: "?" })])));
    await expect(generateQuestionsNew({ topic: "x", client: allBad.client, now: NOW })).rejects.toThrow(/0 of 20/);
    vi.restoreAllMocks();
  });

  it("a short batch goes down the existing refill path: the next round asks for the gap and the build reaches 20", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = twenty().slice(0, 17);
    const refill = Array.from({ length: 4 }, (_, i) => Q(100 + i));
    const { client, sent } = clientReplying(replySse(batchJson(first)), replySse(batchJson(refill)));

    const result = await collectVerifiedQuestions({
      target: 20,
      maxRounds: 4,
      verifyPasses: 2,
      // Same count rule the route uses for every writer.
      generate: (avoid, need) =>
        generateQuestionsNew({ topic: "Cities", client, now: NOW, count: Math.min(20, need + 1), avoidPrompts: avoid }),
      verify: async (qs) =>
        qs.map((_, index) => ({
          index,
          markedAnswerIsCorrect: true,
          ambiguous: false,
          answerableWithoutImage: true,
          fitsRequestedTopic: true,
          factBlurbIsCorrect: true,
          basis: "test",
          derivedCorrectIndex: 0,
        })) as never,
    });

    expect(result).toHaveLength(20);
    expect(sent).toHaveLength(2);
    expect((sent[1]!.messages as Array<{ content: string }>)[0]!.content).toContain("Write exactly 4 questions");
    vi.restoreAllMocks();
  });
});
