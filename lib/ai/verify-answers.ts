// Independent answer fact-checker. Given generated questions, a strong model
// (Opus) re-derives each answer COLD — without trusting the marked one — and
// reports whether the marked answer is correct and whether the question is
// ambiguous. Used to gate generation so no wrong/ambiguous question ships.
//
// Opus 4.8 REJECTS the `temperature` param ("deprecated for this model"), so
// we omit it for that model.

import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { GeneratedQuestion } from "./generate-questions";

export const VERIFIER_MODEL = "claude-opus-4-8";

export interface AnswerVerdict {
  index: number;
  markedAnswerIsCorrect: boolean;
  ambiguous: boolean;
  trueAnswer: string;
}

export interface VerifyAnswersOptions {
  client?: Pick<Anthropic, "messages">;
  model?: string;
}

const VERDICTS_TOOL_NAME = "verdicts";

const verdictsTool = {
  name: VERDICTS_TOOL_NAME,
  description: "Independent fact-check verdicts, one per question.",
  input_schema: {
    type: "object" as const,
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            markedAnswerIsCorrect: { type: "boolean" },
            ambiguous: { type: "boolean" },
            trueAnswer: { type: "string" },
          },
          required: ["index", "markedAnswerIsCorrect", "ambiguous", "trueAnswer"],
          additionalProperties: false,
        },
      },
    },
    required: ["verdicts"],
    additionalProperties: false,
  },
};

const VERIFIER_SYSTEM =
  "You are a meticulous, independent trivia fact-checker. For each question, " +
  "work out the correct answer from your OWN knowledge. Do NOT assume the " +
  "markedAnswer is right. Set markedAnswerIsCorrect=true only if the marked " +
  "answer is unambiguously the single correct option. Set ambiguous=true if " +
  "two or more options are defensibly correct, or the question has no single " +
  "defensible answer.";

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function extractVerdicts(value: unknown): AnswerVerdict[] | null {
  if (typeof value !== "object" || value === null || !("verdicts" in value)) return null;
  const raw = (value as { verdicts: unknown }).verdicts;
  if (Array.isArray(raw)) return raw as AnswerVerdict[];
  // Opus occasionally double-encodes the output as a JSON string inside the
  // tool input. The string may be the array itself or { verdicts: [...] }.
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as AnswerVerdict[];
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "verdicts" in parsed &&
        Array.isArray((parsed as { verdicts: unknown }).verdicts)
      ) {
        return (parsed as { verdicts: AnswerVerdict[] }).verdicts;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function verifyAnswers(
  questions: GeneratedQuestion[],
  opts: VerifyAnswersOptions = {},
): Promise<AnswerVerdict[]> {
  if (questions.length === 0) return [];

  const client =
    opts.client ?? new Anthropic({ apiKey: getEnv("ANTHROPIC_API_KEY") });
  const model = opts.model ?? VERIFIER_MODEL;

  const payload = questions.map((q, i) => ({
    index: i,
    prompt: q.prompt,
    options: q.options,
    markedAnswer: q.options[q.correctIndex],
  }));

  const response = await client.messages.create(
    {
      model,
      max_tokens: 4_000,
      // Opus 4.8 rejects `temperature`; other models keep deterministic 0.
      ...(model.includes("opus-4-8") ? {} : { temperature: 0 }),
      system: VERIFIER_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Fact-check these ${payload.length} questions:\n${JSON.stringify(
            payload,
            null,
            1,
          )}`,
        },
      ],
      tools: [verdictsTool],
      tool_choice: { type: "tool", name: VERDICTS_TOOL_NAME },
    },
    { timeout: 60_000 },
  );

  const block = response.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> =>
      b.type === "tool_use" && b.name === VERDICTS_TOOL_NAME,
  );
  const verdicts = block ? extractVerdicts(block.input) : null;
  if (!verdicts) {
    throw new Error("verifyAnswers: no verdicts returned");
  }
  return verdicts;
}
