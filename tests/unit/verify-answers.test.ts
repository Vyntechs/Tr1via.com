import { describe, it, expect, vi } from "vitest";
import { verifyAnswers, VERIFIER_MODEL } from "@/lib/ai/verify-answers";
import type { GeneratedQuestion } from "@/lib/ai/generate-questions";

const DEFAULT_TOPIC = "General trivia";

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
const verdict = (i: number) => ({
  index: i,
  markedAnswerIsCorrect: true,
  ambiguous: false,
  factBlurbIsCorrect: true,
  answerableWithoutImage: true,
});

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
    const out = await verifyAnswers(
      Array.from({ length: 7 }, (_, index) => q({ prompt: `Question ${index}` })),
      {
        client: client as never,
        topic: "Non-venomous snakes",
      },
    );
    expect(out).toHaveLength(7);
    expect(out[0]?.markedAnswerIsCorrect).toBe(true);
    expect(out[0]?.factBlurbIsCorrect).toBe(true);
    expect(out[0]?.answerableWithoutImage).toBe(true);
    expect(out[0]?.fitsRequestedTopic).toBe(false);
    expect(capture[0]!.params.tool_choice).toEqual({ type: "tool", name: "verdicts" });
    expect(JSON.stringify(capture[0]!.params.tools)).toContain("factBlurbIsCorrect");
    expect(JSON.stringify(capture[0]!.params.tools)).toContain("answerableWithoutImage");
    expect(JSON.stringify(capture[0]!.params.tools)).toContain("fitsRequestedTopic");
    for (const call of capture) {
      const content = (call.params.messages as Array<{ content: string }>)[0]!.content;
      expect(content).toContain('"requestedTopic":"Non-venomous snakes"');
    }
  });

  it("sends the MARKED answer (options[correctIndex]) for each question", async () => {
    const capture: Call[] = [];
    const client = cleanClient(capture);
    await verifyAnswers([q({ correctIndex: 3 })], {
      client: client as never,
      topic: DEFAULT_TOPIC,
    });
    const content = (capture[0]!.params.messages as Array<{ content: string }>)[0]!.content;
    expect(content).toContain('"markedAnswer":"Arnold"');
    expect(content).toContain('"factBlurb":"They married in 1987."');
  });

  it("omits temperature for Opus 4.8 (the param is deprecated there)", async () => {
    const capture: Call[] = [];
    const client = cleanClient(capture);
    await verifyAnswers([q()], {
      client: client as never,
      model: VERIFIER_MODEL,
      topic: DEFAULT_TOPIC,
    });
    expect(capture[0]!.params).not.toHaveProperty("temperature");
  });

  it("returns [] for an empty batch without calling the API", async () => {
    const capture: Call[] = [];
    const client = cleanClient(capture);
    const out = await verifyAnswers([], { client: client as never, topic: DEFAULT_TOPIC });
    expect(out).toEqual([]);
    expect(capture).toHaveLength(0);
  });

  it("chunks a >6 batch into multiple calls and merges with GLOBAL indices", async () => {
    const capture: Call[] = [];
    const client = cleanClient(capture);
    const ten = Array.from({ length: 10 }, (_, i) => q({ prompt: `Q${i}` }));
    const out = await verifyAnswers(ten, { client: client as never, topic: DEFAULT_TOPIC });
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
    const out = await verifyAnswers([q(), q({ prompt: "Q2" }), q({ prompt: "Q3" })], {
      client: flaky as never,
      topic: DEFAULT_TOPIC,
    });
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
    const out = await verifyAnswers([q(), q({ prompt: "Q2" }), q({ prompt: "Q3" })], {
      client: broken as never,
      topic: DEFAULT_TOPIC,
    });
    expect(out).toHaveLength(2); // one question never got a verdict — dropped, not thrown
    expect(capture).toHaveLength(3); // exhausted the retry attempts
  });

  it("handles Opus double-encoded output — verdicts array as JSON string", async () => {
    const doubleEncoded = {
      messages: {
        create: vi.fn(async () => ({
          content: [{ type: "tool_use", name: "verdicts", id: "t", input: { verdicts: JSON.stringify([verdict(0)]) } }],
        })),
      },
    };
    const out = await verifyAnswers([q()], {
      client: doubleEncoded as never,
      topic: DEFAULT_TOPIC,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.markedAnswerIsCorrect).toBe(true);
  });

  it("verifies all chunks concurrently — wall-clock collapses to the slowest chunk", async () => {
    let inFlight = 0;
    let peak = 0;
    const DELAY = 40; // ms each mocked verify call "takes"
    const client = {
      messages: {
        create: vi.fn(async (params: Record<string, unknown>) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, DELAY));
          inFlight -= 1;
          const n = chunkSize(params);
          return {
            content: [
              {
                type: "tool_use",
                name: "verdicts",
                id: "t",
                input: { verdicts: Array.from({ length: n }, (_, i) => verdict(i)) },
              },
            ],
          };
        }),
      },
    };

    const twenty = Array.from({ length: 20 }, (_, i) => q({ prompt: `Q${i}` }));
    const t0 = performance.now();
    const out = await verifyAnswers(twenty, { client: client as never, topic: DEFAULT_TOPIC });
    const elapsed = performance.now() - t0;

    // 20 / VERIFY_CHUNK_SIZE(6) = 4 chunks — all in flight simultaneously.
    expect(peak).toBe(4);
    expect(out).toHaveLength(20);
    expect(out.map((v) => v.index)).toEqual(
      Array.from({ length: 20 }, (_, i) => i),
    );
    // Parallel ≈ one chunk-delay; the old sequential walk would be ~4×.
    // Generous ceiling so this isn't flaky on a loaded CI box.
    expect(elapsed).toBeLessThan(DELAY * 3);
    console.log(
      `[verify-perf] 20q → 4 chunks: peak concurrency ${peak}, wall-clock ${elapsed.toFixed(0)}ms (sequential would be ~${DELAY * 4}ms)`,
    );
  });

  it("handles Opus double-encoded output — {verdicts:[...]} object as JSON string", async () => {
    const doubleEncoded = {
      messages: {
        create: vi.fn(async () => ({
          content: [{ type: "tool_use", name: "verdicts", id: "t", input: { verdicts: JSON.stringify({ verdicts: [verdict(0)] }) } }],
        })),
      },
    };
    const out = await verifyAnswers([q()], {
      client: doubleEncoded as never,
      topic: DEFAULT_TOPIC,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.markedAnswerIsCorrect).toBe(true);
  });
});
