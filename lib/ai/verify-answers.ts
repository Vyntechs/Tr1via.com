// Independent answer fact-checker. Given generated questions, a strong model
// (Opus) re-derives each answer COLD — without trusting the marked one — and
// reports whether the marked answer is correct and whether the question is
// ambiguous. Used to gate generation so no wrong/ambiguous question ships.
//
// Reliability contract (learned the hard way): verify in small CHUNKS, and
// RETRY a chunk to fill any gaps, but degrade GRACEFULLY — return whatever
// verdicts we gathered. The caller drops any question that lacks a verdict
// (treats it as unverified), so a flaky verifier yields FEWER questions, never
// a wrong one, and never a failed generation. We do NOT throw on incomplete
// output (an earlier "throw on incomplete" guard turned one Opus hiccup into a
// total generation failure). Real API errors (network, rate limit) still throw
// from the SDK and fail the job, which is correct. We keep verdicts minimal
// (no free-text fields) so the model reliably returns one per question.
//
// Opus 4.8 REJECTS the `temperature` param ("deprecated for this model"), so
// we omit it for that model.

import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { GeneratedQuestion } from "./generate-questions";

export const VERIFIER_MODEL = "claude-opus-4-8";

/** Questions per verify call. Small so the model reliably returns one verdict
 *  per item (larger batches came back partial in testing). */
export const VERIFY_CHUNK_SIZE = 6;

/** Attempts per chunk to fill in any missing verdicts before giving up. */
const CHUNK_ATTEMPTS = 3;

export interface AnswerVerdict {
  index: number;
  markedAnswerIsCorrect: boolean;
  ambiguous: boolean;
}

export interface VerifyAnswersOptions {
  client?: Pick<Anthropic, "messages">;
  model?: string;
}

const VERDICTS_TOOL_NAME = "verdicts";

const verdictsTool = {
  name: VERDICTS_TOOL_NAME,
  description: "Fact-check verdicts — exactly one per question index.",
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
          },
          required: ["index", "markedAnswerIsCorrect", "ambiguous"],
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
  "defensible answer. Return exactly one verdict for every question index. " +
  "Output only the verdicts — no explanations.";

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

interface RawVerdict { index: number; markedAnswerIsCorrect: boolean; ambiguous: boolean }
function isVerdicts(value: unknown): value is { verdicts: RawVerdict[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "verdicts" in value &&
    Array.isArray((value as { verdicts: unknown }).verdicts)
  );
}

/** Best-effort verify of one chunk (LOCAL indices 0..n-1). Retries to fill
 *  gaps across attempts; returns a map of whatever verdicts it gathered (may
 *  be partial). Never throws for partial output — only real SDK errors throw. */
async function verifyChunk(
  client: Pick<Anthropic, "messages">,
  model: string,
  chunk: GeneratedQuestion[],
): Promise<Map<number, AnswerVerdict>> {
  const payload = chunk.map((q, i) => ({
    index: i,
    prompt: q.prompt,
    options: q.options,
    markedAnswer: q.options[q.correctIndex],
  }));
  const byIndex = new Map<number, AnswerVerdict>();

  for (let attempt = 0; attempt < CHUNK_ATTEMPTS && byIndex.size < chunk.length; attempt++) {
    const response = await client.messages.create(
      {
        model,
        max_tokens: 2_000,
        // Opus 4.8 rejects `temperature`; other models keep deterministic 0.
        ...(model.includes("opus-4-8") ? {} : { temperature: 0 }),
        system: VERIFIER_SYSTEM,
        messages: [
          {
            role: "user",
            content: `Fact-check these ${payload.length} questions. Return exactly ${payload.length} verdicts, one per index 0..${payload.length - 1}:\n${JSON.stringify(
              payload,
              null,
              0,
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
      for (const v of block.input.verdicts) {
        if (v.index >= 0 && v.index < chunk.length && !byIndex.has(v.index)) {
          byIndex.set(v.index, {
            index: v.index,
            markedAnswerIsCorrect: v.markedAnswerIsCorrect,
            ambiguous: v.ambiguous,
          });
        }
      }
    }
  }

  if (byIndex.size < chunk.length) {
    // Graceful degradation: the caller drops the unverified ones. Log so we
    // can spot a verifier that's chronically under-returning.
    console.warn(
      `[verifyAnswers] verifier returned ${byIndex.size}/${chunk.length} verdicts after ${CHUNK_ATTEMPTS} attempts; the ${chunk.length - byIndex.size} unverified will be dropped`,
    );
  }
  return byIndex;
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
    const byIndex = await verifyChunk(client, model, chunk);
    // Re-index from chunk-local back to the caller's global indices.
    for (const [localIndex, v] of byIndex) {
      out.push({ ...v, index: start + localIndex });
    }
  }
  return out;
}
