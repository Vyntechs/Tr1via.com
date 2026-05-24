// Claude integration for TR1VIA question generation.
//
// Flow:
//   1. Build the system prompt (cacheable) + user prompt (per call).
//   2. Call the Anthropic Messages API with a single `emit_questions`
//      tool. We force tool_choice so Claude must produce structured JSON
//      instead of prose, and instruct it to return the full batch in one
//      shot.
//   3. Validate the tool input with Zod. Per-item validation: if a single
//      generated question fails the schema (e.g. wrong option count, no
//      factBlurb), we DROP THAT QUESTION and keep the rest. The host
//      always gets something usable, even if Claude went off-spec on a
//      few items.
//   4. Return the typed array.
//
// Prompt caching:
//   We use the beta Prompt Caching API (`client.beta.promptCaching`) — the
//   `cache_control: { type: "ephemeral" }` hint lives on the system block.
//   The system prompt is large and stable; the user prompt is small and
//   per-call. The 2nd category a host generates in quick succession is
//   cheaper because the system prefix is read from cache.
//
// Tests live in tests/unit/generate-questions.test.ts (Anthropic SDK
// mocked, no live network).
//
// Model: claude-haiku-4-5-20251001. Timeout: 30 seconds.
//
// Why Haiku over Sonnet for this: head-to-head benchmark on 4 topics
// (movie actors, 90s hip-hop, world capitals, kitchen science, classic
// rock albums) showed Haiku is ~2.5× faster (20s vs 50s avg) and ~3.2×
// cheaper, with comparable distractor quality. Speed matters here — at
// 50s Sonnet was hitting the production 30s timeout under load. Sonnet
// has a slight edge on difficulty spread for narrow/easy topics; if
// that becomes a problem we'll add a "regenerate with deeper model"
// fallback rather than paying the latency tax every time.

import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { SYSTEM_PROMPT, userPromptFor } from "./prompts";

// ─── Public types ─────────────────────────────────────────────────────

const DifficultyEnum = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
]);

const CorrectIndexEnum = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

const GeneratedQuestionSchema = z
  .object({
    prompt: z.string().trim().min(8).max(400),
    options: z
      .array(z.string().trim().min(1).max(160))
      .length(4),
    correctIndex: CorrectIndexEnum,
    difficulty: DifficultyEnum,
    factBlurb: z.string().trim().min(8).max(280),
    photoQuery: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .transform((s) => s.replace(/\s+/g, " ")),
  })
  // Enforce unique options — protects against Claude returning two
  // distractors that paraphrase each other.
  .refine((q) => new Set(q.options.map((o) => o.toLowerCase())).size === 4, {
    message: "options must be four distinct values",
  });

// Once-validated runtime shape. The transform on photoQuery normalizes
// whitespace; we still want the strict 4-tuple on options for downstream.
export interface GeneratedQuestion {
  prompt: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  difficulty: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  factBlurb: string;
  photoQuery: string;
}

export interface GenerateQuestionsOptions {
  topic: string;
  flavor?: string[];
  difficulty?: "easy" | "normal" | "hard";
  /** How many candidate questions to ask Claude for. Default 20. */
  count?: number;
  /** Optional: inject a client for testing. */
  client?: Pick<Anthropic, "beta">;
  /** Optional override of the model id. */
  model?: string;
  /** Optional override of the request timeout in ms. Default 30_000. */
  timeoutMs?: number;
}

// ─── Tool definition ──────────────────────────────────────────────────

const EMIT_QUESTIONS_TOOL_NAME = "emit_questions";

// JSON Schema — kept manually in lockstep with GeneratedQuestionSchema.
// Anthropic's tool_input is validated by the model against this schema;
// we re-validate with Zod after the call because models can drift.
const emitQuestionsTool = {
  name: EMIT_QUESTIONS_TOOL_NAME,
  description:
    "Emit the batch of generated trivia questions for TR1VIA. Call exactly once.",
  input_schema: {
    type: "object" as const,
    properties: {
      questions: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            prompt: { type: "string", minLength: 8, maxLength: 400 },
            options: {
              type: "array",
              minItems: 4,
              maxItems: 4,
              items: { type: "string", minLength: 1, maxLength: 160 },
            },
            correctIndex: { type: "integer", minimum: 0, maximum: 3 },
            difficulty: { type: "integer", minimum: 1, maximum: 7 },
            factBlurb: { type: "string", minLength: 8, maxLength: 280 },
            photoQuery: { type: "string", minLength: 2, maxLength: 80 },
          },
          required: [
            "prompt",
            "options",
            "correctIndex",
            "difficulty",
            "factBlurb",
            "photoQuery",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["questions"],
    additionalProperties: false,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing env: ${name} — set in .env.local before generating questions`,
    );
  }
  return v;
}

function makeClient(): Anthropic {
  // The SDK reads ANTHROPIC_API_KEY from env automatically, but we
  // surface a clearer error if it's missing.
  return new Anthropic({ apiKey: getEnv("ANTHROPIC_API_KEY") });
}

/**
 * Default model id. Haiku 4.5 was benchmarked against Sonnet 4.6 on four
 * topics — 2.5× faster (20s vs 50s) and 3.2× cheaper with comparable
 * distractor quality. See scripts/compare-models-batch.mjs.
 */
export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

/** Default request timeout in ms. */
export const DEFAULT_TIMEOUT_MS = 30_000;

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Ask Claude for `count` (default 20) TR1VIA-style questions on a topic.
 *
 * Validates each emitted question independently. Items that fail
 * validation are dropped (with a console.warn so we can spot patterns in
 * dev) — the function returns the valid subset rather than throwing.
 *
 * Throws only if:
 *   - the Anthropic call itself fails (network, rate limit, auth)
 *   - Claude returns no tool_use block at all
 *   - the tool_use block's `input.questions` is not an array
 *
 * In those cases callers should surface a retry-friendly error to the
 * host UI.
 */
export async function generateQuestions(
  opts: GenerateQuestionsOptions,
): Promise<GeneratedQuestion[]> {
  const client = opts.client ?? makeClient();
  const model = opts.model ?? DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const count = opts.count ?? 20;

  const userPrompt = userPromptFor({
    topic: opts.topic,
    flavor: opts.flavor,
    difficulty: opts.difficulty,
    count,
  });

  const response = await client.beta.promptCaching.messages.create(
    {
      model,
      max_tokens: 8_000,
      // System prompt as a single text block with the ephemeral cache
      // hint. The SDK forwards this to the Prompt Caching beta endpoint.
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
      tools: [emitQuestionsTool],
      tool_choice: { type: "tool", name: EMIT_QUESTIONS_TOOL_NAME },
      // Slight temperature for creative variety without going off-spec.
      temperature: 0.7,
    },
    { timeout: timeoutMs },
  );

  const toolBlock = response.content.find(
    (block): block is Extract<typeof block, { type: "tool_use" }> =>
      block.type === "tool_use" && block.name === EMIT_QUESTIONS_TOOL_NAME,
  );
  if (!toolBlock) {
    throw new Error(
      "generateQuestions: Claude returned no emit_questions tool call",
    );
  }

  const input = toolBlock.input;
  if (!isQuestionsContainer(input)) {
    throw new Error(
      "generateQuestions: emit_questions input missing `questions` array",
    );
  }

  const valid: GeneratedQuestion[] = [];
  for (let i = 0; i < input.questions.length; i++) {
    const parsed = GeneratedQuestionSchema.safeParse(input.questions[i]);
    if (!parsed.success) {
      // Drop the item, keep the batch. Log so dev notices recurring
      // drift (never log keys or full Claude response).
      console.warn(
        `[generateQuestions] dropped invalid question at index ${i}: ${parsed.error.issues
          .map((iss) => iss.message)
          .join("; ")}`,
      );
      continue;
    }
    // Re-narrow options to the strict tuple shape for downstream consumers.
    const q = parsed.data;
    valid.push({
      prompt: q.prompt,
      options: [q.options[0]!, q.options[1]!, q.options[2]!, q.options[3]!],
      correctIndex: q.correctIndex,
      difficulty: q.difficulty,
      factBlurb: q.factBlurb,
      photoQuery: q.photoQuery,
    });
  }

  return valid;
}

function isQuestionsContainer(value: unknown): value is { questions: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "questions" in value &&
    Array.isArray((value as { questions: unknown }).questions)
  );
}
