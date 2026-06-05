// Independent answer fact-checker. Given generated questions, a strong model
// (Opus) re-derives each answer COLD — without trusting the marked one — and
// reports whether the marked answer is correct and whether the question is
// ambiguous. Used to gate generation so no wrong/ambiguous question ships.
//
// Reliability: we verify in small CHUNKS and require a complete set of verdicts
// per chunk (one verdict per question), retrying a chunk once if the model
// returns a partial set. This matters because the caller drops any question
// that lacks a verdict — so a silently-incomplete response would silently throw
// away good questions and leave the host with an empty pool. Better to retry,
// and fail loudly if a chunk still can't be verified, than to under-deliver.
//
// Opus 4.8 REJECTS the `temperature` param ("deprecated for this model"), so
// we omit it for that model.

import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { GeneratedQuestion } from "./generate-questions";

export const VERIFIER_MODEL = "claude-opus-4-8";

/** Questions per verify call. Small enough that the model reliably returns a
 *  verdict for every item (large batches came back partial in testing). */
export const VERIFY_CHUNK_SIZE = 8;

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
  description: "Independent fact-check verdicts — exactly one per question.",
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
  "defensible answer. Return exactly one verdict for every question index.";

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function isVerdicts(value: unknown): value is { verdicts: AnswerVerdict[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "verdicts" in value &&
    Array.isArray((value as { verdicts: unknown }).verdicts)
  );
}

/** Verify one chunk with LOCAL indices 0..n-1. Retries once if the model
 *  returns fewer than one verdict per question; throws if it still can't. */
async function verifyChunk(
  client: Pick<Anthropic, "messages">,
  model: string,
  chunk: GeneratedQuestion[],
): Promise<AnswerVerdict[]> {
  const payload = chunk.map((q, i) => ({
    index: i,
    prompt: q.prompt,
    options: q.options,
    markedAnswer: q.options[q.correctIndex],
  }));

  for (let attempt = 0; attempt < 2; attempt++) {
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
            content: `Fact-check these ${payload.length} questions. Return exactly ${payload.length} verdicts, one per index 0..${payload.length - 1}:\n${JSON.stringify(
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
    if (block && isVerdicts(block.input)) {
      // Keep the first verdict per in-range index; check we have all of them.
      const byIndex = new Map<number, AnswerVerdict>();
      for (const v of block.input.verdicts) {
        if (v.index >= 0 && v.index < chunk.length && !byIndex.has(v.index)) {
          byIndex.set(v.index, v);
        }
      }
      if (byIndex.size === chunk.length) {
        return chunk.map((_, i) => byIndex.get(i)!);
      }
    }
    // Partial/garbled response — retry once before giving up.
  }
  throw new Error(
    `verifyAnswers: verifier returned an incomplete verdict set for a ${chunk.length}-question chunk`,
  );
}

export async function verifyAnswers(
  questions: GeneratedQuestion[],
  opts: VerifyAnswersOptions = {},
): Promise<AnswerVerdict[]> {
  if (questions.length === 0) return [];

  const client =
    opts.client ?? new Anthropic({ apiKey: getEnv("ANTHROPIC_API_KEY") });
  const model = opts.model ?? VERIFIER_MODEL;

  const out: AnswerVerdict[] = [];
  for (let start = 0; start < questions.length; start += VERIFY_CHUNK_SIZE) {
    const chunk = questions.slice(start, start + VERIFY_CHUNK_SIZE);
    const verdicts = await verifyChunk(client, model, chunk);
    // Re-index from chunk-local back to the caller's global indices.
    for (const v of verdicts) out.push({ ...v, index: start + v.index });
  }
  return out;
}
