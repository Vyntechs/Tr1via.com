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

// Mock that returns a COMPLETE clean verdict set sized to whatever chunk it gets
// (chunk-local indices 0..n-1), matching the real model contract.
function cleanClient(capture: Call[]) {
  return {
    messages: {
      create: vi.fn(async (params: Record<string, unknown>, options?: Record<string, unknown>) => {
        capture.push({ params, options });
        const n = chunkSize(params);
        const verdicts = Array.from({ length: n }, (_, i) => ({
          index: i, markedAnswerIsCorrect: true, ambiguous: false, trueAnswer: "Bruce Willis",
        }));
        return { content: [{ type: "tool_use", name: "verdicts", id: "t", input: { verdicts } }] };
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
    expect(content).toContain('"markedAnswer": "Arnold"');
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

  it("chunks a >8 batch into multiple calls and merges with GLOBAL indices", async () => {
    const capture: Call[] = [];
    const client = cleanClient(capture);
    const ten = Array.from({ length: 10 }, (_, i) => q({ prompt: `Q${i}` }));
    // @ts-expect-error — narrowing
    const out = await verifyAnswers(ten, { client });
    expect(capture).toHaveLength(2); // 8 + 2
    expect(out).toHaveLength(10);
    expect(out.map((v) => v.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("retries a chunk once when the verdict set comes back incomplete", async () => {
    const capture: Call[] = [];
    let call = 0;
    const flakyClient = {
      messages: {
        create: vi.fn(async (params: Record<string, unknown>) => {
          capture.push({ params });
          call++;
          // First attempt: drop one verdict (incomplete). Second: complete.
          const n = chunkSize(params);
          const keep = call === 1 ? n - 1 : n;
          const verdicts = Array.from({ length: keep }, (_, i) => ({
            index: i, markedAnswerIsCorrect: true, ambiguous: false, trueAnswer: "x",
          }));
          return { content: [{ type: "tool_use", name: "verdicts", id: "t", input: { verdicts } }] };
        }),
      },
    };
    // @ts-expect-error — narrowing
    const out = await verifyAnswers([q(), q({ prompt: "Q2" })], { client: flakyClient });
    expect(out).toHaveLength(2);
    expect(capture).toHaveLength(2); // one retry of the single chunk
  });

  it("throws if the verifier stays incomplete after a retry (never silently drops)", async () => {
    const capture: Call[] = [];
    const brokenClient = {
      messages: {
        create: vi.fn(async (params: Record<string, unknown>) => {
          capture.push({ params });
          return { content: [{ type: "tool_use", name: "verdicts", id: "t", input: { verdicts: [] } }] };
        }),
      },
    };
    await expect(
      // @ts-expect-error — narrowing
      verifyAnswers([q()], { client: brokenClient }),
    ).rejects.toThrow(/incomplete/);
    expect(capture).toHaveLength(2); // attempted twice before giving up
  });
});
