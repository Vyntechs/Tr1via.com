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

// How many questions a given verify call was asked about (from the payload JSON).
function chunkSize(params: Record<string, unknown>): number {
  const content = (params.messages as Array<{ content: string }>)[0]!.content;
  return (content.match(/"index":/g) ?? []).length;
}
const verdict = (i: number) => ({ index: i, markedAnswerIsCorrect: true, ambiguous: false });

// Mock returning a COMPLETE clean verdict set sized to whatever chunk it gets.
function cleanClient(capture: Call[]) {
  return {
    messages: {
      create: vi.fn(async (params: Record<string, unknown>, options?: Record<string, unknown>) => {
        capture.push({ params, options });
        const n = chunkSize(params);
        return { content: [{ type: "tool_use", name: "verdicts", id: "t", input: { verdicts: Array.from({ length: n }, (_, i) => verdict(i)) } }] };
      }),
    },
  };
}

describe("verifyAnswers", () => {
  it("returns a verdict per question and forces the verdicts tool", async () => {
    const capture: Call[] = [];
    const client = cleanClient(capture);
    // @ts-expect-error — narrowing to Pick<Anthropic,"messages"> in tests
    const out = await verifyAnswers([q()], { client });
    expect(out).toHaveLength(1);
    expect(out[0]?.markedAnswerIsCorrect).toBe(true);
    expect(capture[0]!.params.tool_choice).toEqual({ type: "tool", name: "verdicts" });
  });

  it("sends the MARKED answer (options[correctIndex]) for each question", async () => {
    const capture: Call[] = [];
    const client = cleanClient(capture);
    // @ts-expect-error — narrowing
    await verifyAnswers([q({ correctIndex: 3 })], { client });
    const content = (capture[0]!.params.messages as Array<{ content: string }>)[0]!.content;
    expect(content).toContain('"markedAnswer":"Arnold"');
  });

  it("omits temperature for Opus 4.8 (the param is deprecated there)", async () => {
    const capture: Call[] = [];
    const client = cleanClient(capture);
    // @ts-expect-error — narrowing
    await verifyAnswers([q()], { client, model: VERIFIER_MODEL });
    expect(capture[0]!.params).not.toHaveProperty("temperature");
  });

  it("returns [] for an empty batch without calling the API", async () => {
    const capture: Call[] = [];
    const client = cleanClient(capture);
    // @ts-expect-error — narrowing
    const out = await verifyAnswers([], { client });
    expect(out).toEqual([]);
    expect(capture).toHaveLength(0);
  });

  it("chunks a >6 batch into multiple calls and merges with GLOBAL indices", async () => {
    const capture: Call[] = [];
    const client = cleanClient(capture);
    const ten = Array.from({ length: 10 }, (_, i) => q({ prompt: `Q${i}` }));
    // @ts-expect-error — narrowing
    const out = await verifyAnswers(ten, { client });
    expect(capture).toHaveLength(2); // 6 + 4
    expect(out).toHaveLength(10);
    expect(out.map((v) => v.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("retries to fill gaps across attempts, then returns the union", async () => {
    const capture: Call[] = [];
    let call = 0;
    const flaky = {
      messages: {
        create: vi.fn(async (params: Record<string, unknown>) => {
          capture.push({ params });
          call++;
          const n = chunkSize(params);
          const keep = call === 1 ? n - 1 : n; // first attempt drops one, second is complete
          return { content: [{ type: "tool_use", name: "verdicts", id: "t", input: { verdicts: Array.from({ length: keep }, (_, i) => verdict(i)) } }] };
        }),
      },
    };
    // @ts-expect-error — narrowing
    const out = await verifyAnswers([q(), q({ prompt: "Q2" }), q({ prompt: "Q3" })], { client: flaky });
    expect(out).toHaveLength(3);
    expect(capture).toHaveLength(2); // stopped once the gap was filled
  });

  it("degrades gracefully — returns partial (never throws) when verdicts stay incomplete", async () => {
    const capture: Call[] = [];
    const broken = {
      messages: {
        create: vi.fn(async (params: Record<string, unknown>) => {
          capture.push({ params });
          const n = chunkSize(params);
          return { content: [{ type: "tool_use", name: "verdicts", id: "t", input: { verdicts: Array.from({ length: n - 1 }, (_, i) => verdict(i)) } }] };
        }),
      },
    };
    // @ts-expect-error — narrowing
    const out = await verifyAnswers([q(), q({ prompt: "Q2" }), q({ prompt: "Q3" })], { client: broken });
    expect(out).toHaveLength(2); // one question never got a verdict — dropped, not thrown
    expect(capture).toHaveLength(3); // exhausted the retry attempts
  });
});
