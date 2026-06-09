import { describe, it, expect, vi } from "vitest";
import { verifyAnswers, VERIFIER_MODEL } from "@/lib/ai/verify-answers";
import type { GeneratedQuestion } from "@/lib/ai/generate-questions";

function q(over: Partial<GeneratedQuestion> = {}): GeneratedQuestion {
  return {
    prompt: "Demi Moore was married to which actor?",
    options: ["Bruce Willis", "Van Damme", "Seagal", "Arnold"],
    correctIndex: 0,
    difficulty: 4,
    factBlurb: "They married in 1987.",
    photoQuery: "1980s hollywood couple",
    ...over,
  };
}

interface Call { params: Record<string, unknown>; options?: Record<string, unknown> }

function mockClient(verdicts: unknown, capture: Call[]) {
  return {
    messages: {
      create: vi.fn(async (params: Record<string, unknown>, options?: Record<string, unknown>) => {
        capture.push({ params, options });
        return {
          content: [{ type: "tool_use", name: "verdicts", id: "t", input: { verdicts } }],
        };
      }),
    },
  };
}

describe("verifyAnswers", () => {
  it("returns the verdict array and forces the verdicts tool", async () => {
    const capture: Call[] = [];
    const client = mockClient(
      [{ index: 0, markedAnswerIsCorrect: true, ambiguous: false, trueAnswer: "Bruce Willis" }],
      capture,
    );
    // @ts-expect-error — narrowing to Pick<Anthropic,"messages"> in tests
    const out = await verifyAnswers([q()], { client });
    expect(out).toHaveLength(1);
    expect(out[0]?.markedAnswerIsCorrect).toBe(true);
    expect(capture[0]!.params.tool_choice).toEqual({ type: "tool", name: "verdicts" });
  });

  it("sends the MARKED answer (options[correctIndex]) for each question", async () => {
    const capture: Call[] = [];
    const client = mockClient([], capture);
    // @ts-expect-error — narrowing
    await verifyAnswers([q({ correctIndex: 3 })], { client });
    const content = (capture[0]!.params.messages as Array<{ content: string }>)[0]!.content;
    expect(content).toContain('"markedAnswer": "Arnold"');
  });

  it("omits temperature for Opus 4.8 (the param is deprecated there)", async () => {
    const capture: Call[] = [];
    const client = mockClient([], capture);
    // @ts-expect-error — narrowing
    await verifyAnswers([q()], { client, model: VERIFIER_MODEL });
    expect(capture[0]!.params).not.toHaveProperty("temperature");
  });

  it("returns [] for an empty batch without calling the API", async () => {
    const capture: Call[] = [];
    const client = mockClient([], capture);
    // @ts-expect-error — narrowing
    const out = await verifyAnswers([], { client });
    expect(out).toEqual([]);
    expect(capture).toHaveLength(0);
  });

  it("handles Opus double-encoded string output ({verdicts:[...]} as JSON string)", async () => {
    const capture: Call[] = [];
    const verdict = [{ index: 0, markedAnswerIsCorrect: true, ambiguous: false, trueAnswer: "Bruce Willis" }];
    // Opus sometimes outputs the verdicts wrapped in another JSON string
    const client = mockClient(JSON.stringify({ verdicts: verdict }), capture);
    // @ts-expect-error — narrowing
    const out = await verifyAnswers([q()], { client });
    expect(out).toHaveLength(1);
    expect(out[0]?.markedAnswerIsCorrect).toBe(true);
  });

  it("handles Opus double-encoded string output (array directly as JSON string)", async () => {
    const capture: Call[] = [];
    const verdict = [{ index: 0, markedAnswerIsCorrect: false, ambiguous: false, trueAnswer: "Actual answer" }];
    const client = mockClient(JSON.stringify(verdict), capture);
    // @ts-expect-error — narrowing
    const out = await verifyAnswers([q()], { client });
    expect(out).toHaveLength(1);
    expect(out[0]?.markedAnswerIsCorrect).toBe(false);
  });
});
