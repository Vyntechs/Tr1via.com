import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  DEFAULT_MODEL,
  generateQuestions,
} from "@/lib/ai/generate-questions";

// Small fixture builders to keep tests readable.
function validQuestion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    prompt:
      "Which U.S. state has more tidal coastline than all the others combined?",
    options: ["Florida", "Alaska", "California", "Maine"],
    correctIndex: 1,
    difficulty: 4,
    factBlurb:
      "33,904 miles of tidal coastline — more than all other states put together.",
    photoQuery: "alaska coastline aerial",
    ...overrides,
  };
}

interface MockClientCall {
  params: Record<string, unknown>;
  options: Record<string, unknown> | undefined;
}

function makeMockClient(
  toolInput: unknown,
  capture: MockClientCall[],
) {
  return {
    beta: {
      promptCaching: {
        messages: {
          create: vi.fn(
            async (
              params: Record<string, unknown>,
              options?: Record<string, unknown>,
            ) => {
              capture.push({ params, options });
              return {
                id: "msg_test",
                type: "message" as const,
                role: "assistant" as const,
                model: DEFAULT_MODEL,
                stop_reason: "tool_use" as const,
                stop_sequence: null,
                content: [
                  {
                    type: "tool_use" as const,
                    id: "toolu_test",
                    name: "emit_questions",
                    input: toolInput,
                  },
                ],
                usage: {
                  cache_creation_input_tokens: 0,
                  cache_read_input_tokens: 0,
                  input_tokens: 10,
                  output_tokens: 20,
                },
              };
            },
          ),
        },
      },
    },
  };
}

describe("generateQuestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only schema-valid questions and drops the rest (does not throw on bad items)", async () => {
    const capture: MockClientCall[] = [];
    const client = makeMockClient(
      {
        questions: [
          validQuestion(),
          validQuestion({
            prompt: "Second valid question on the same topic",
            options: ["alpha", "bravo", "charlie", "delta"],
            correctIndex: 0,
          }),
          // INVALID: only 3 options
          validQuestion({
            prompt: "Bad item three options total",
            options: ["alpha", "bravo", "charlie"],
          }),
          // INVALID: difficulty out of range
          validQuestion({
            prompt: "Bad item difficulty out of range",
            difficulty: 9,
          }),
          // INVALID: duplicate options
          validQuestion({
            prompt: "Bad item duplicated option text",
            options: ["alpha", "alpha", "bravo", "charlie"],
          }),
          // INVALID: empty fact blurb
          validQuestion({
            prompt: "Bad item empty fact blurb",
            factBlurb: "",
          }),
        ],
      },
      capture,
    );

    const out = await generateQuestions({
      topic: "US states",
      // @ts-expect-error — narrowing to the Pick<Anthropic,...> shape in tests
      client,
    });

    // Only the two valid items survive.
    expect(out).toHaveLength(2);
    expect(out[0]?.prompt).toMatch(/tidal coastline/);
    expect(out[1]?.prompt).toMatch(/Second valid question/);
    // Strict tuple typing held:
    expect(out[0]?.options).toHaveLength(4);
  });

  it("includes flavor and difficulty in the user prompt forwarded to Claude", async () => {
    const capture: MockClientCall[] = [];
    const client = makeMockClient(
      { questions: [validQuestion()] },
      capture,
    );

    await generateQuestions({
      topic: "US states",
      flavor: ["sharper", "more local"],
      difficulty: "hard",
      // @ts-expect-error — narrowing
      client,
    });

    expect(capture).toHaveLength(1);
    const messages = capture[0]!.params.messages as Array<{
      role: string;
      content: string;
    }>;
    const userContent = messages.find((m) => m.role === "user")?.content;
    expect(userContent).toMatch(/Topic: US states/);
    expect(userContent).toMatch(/Difficulty target: hard/);
    expect(userContent).toMatch(/Flavor: sharper, more local/);
  });

  it("requests prompt caching on the system prompt (cache_control ephemeral)", async () => {
    const capture: MockClientCall[] = [];
    const client = makeMockClient(
      { questions: [validQuestion()] },
      capture,
    );

    await generateQuestions({
      topic: "anything",
      // @ts-expect-error — narrowing
      client,
    });

    expect(capture).toHaveLength(1);
    const system = capture[0]!.params.system as Array<{
      type: string;
      text: string;
      cache_control?: { type: string };
    }>;
    expect(Array.isArray(system)).toBe(true);
    expect(system[0]?.cache_control).toEqual({ type: "ephemeral" });
    expect(system[0]?.text.length).toBeGreaterThan(500);
  });

  it("forces the emit_questions tool via tool_choice and ships the tool schema", async () => {
    const capture: MockClientCall[] = [];
    const client = makeMockClient(
      { questions: [validQuestion()] },
      capture,
    );

    await generateQuestions({
      topic: "anything",
      // @ts-expect-error — narrowing
      client,
    });

    const params = capture[0]!.params;
    expect(params.tool_choice).toEqual({
      type: "tool",
      name: "emit_questions",
    });
    const tools = params.tools as Array<{ name: string }>;
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("emit_questions");
    expect(params.model).toBe(DEFAULT_MODEL);
  });

  it("respects a custom request timeout option", async () => {
    const capture: MockClientCall[] = [];
    const client = makeMockClient(
      { questions: [validQuestion()] },
      capture,
    );

    await generateQuestions({
      topic: "x",
      timeoutMs: 12_345,
      // @ts-expect-error — narrowing
      client,
    });

    expect(capture[0]!.options).toEqual({ timeout: 12_345 });
  });

  it("throws when Claude responds without a tool_use block", async () => {
    const noToolClient = {
      beta: {
        promptCaching: {
          messages: {
            create: vi.fn(async () => ({
              id: "msg_test",
              type: "message" as const,
              role: "assistant" as const,
              model: DEFAULT_MODEL,
              stop_reason: "end_turn" as const,
              stop_sequence: null,
              content: [{ type: "text" as const, text: "no tool call" }],
              usage: {
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
                input_tokens: 10,
                output_tokens: 5,
              },
            })),
          },
        },
      },
    };

    await expect(
      generateQuestions({
        topic: "x",
        // @ts-expect-error — narrowing
        client: noToolClient,
      }),
    ).rejects.toThrow(/no emit_questions tool call/);
  });

  it("throws when the tool input is missing the questions array", async () => {
    const capture: MockClientCall[] = [];
    const badShapeClient = makeMockClient({ wrongKey: [] }, capture);

    await expect(
      generateQuestions({
        topic: "x",
        // @ts-expect-error — narrowing
        client: badShapeClient,
      }),
    ).rejects.toThrow(/missing `questions` array/);
  });
});
