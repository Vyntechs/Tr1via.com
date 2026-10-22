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
// Model: claude-sonnet-4-6. A 2026-06-05 benchmark (scripts/benchmark-answer-correctness.mjs)
// showed Haiku 4.5 wrote 6.4% factually-wrong + 19/78 ambiguous questions (and reproduced a
// live mis-key), vs Sonnet 2.5% (arguable edge-cases) / 10. Haiku is removed for generation.
// An independent Opus fact-check (lib/ai/verify-answers.ts) gates the output regardless.

import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { PromptCachingBetaMessage } from "@anthropic-ai/sdk/resources/beta/prompt-caching/messages";
import { z } from "zod";
import { SYSTEM_PROMPT, userPromptFor } from "./prompts";
import type { ThemeKey } from "@/lib/theme/tokens";
import type { TokenUsage } from "./usage-cost";

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

export interface GenerateQuestionsRejectedCandidate {
  index: number;
  reason: "invalid_schema";
  issues: string[];
  prompt?: string;
}

export interface GenerateQuestionsOptions {
  topic: string;
  flavor?: string[];
  difficulty?: "easy" | "normal" | "hard";
  /** How many candidate questions to ask Claude for. Default 20. */
  count?: number;
  /** Theme key for the night — sets the question timer duration in the prompt. */
  themeKey?: ThemeKey;
  /** Question prompts already shown to the host — excluded from this batch. */
  avoidPrompts?: string[];
  /** Optional: inject a client for testing. */
  client?: Pick<Anthropic, "beta">;
  /** Optional override of the model id. */
  model?: string;
  /** Optional override of the request timeout in ms. Default 30_000. */
  timeoutMs?: number;
  /** Optional: receive token usage for cost logging. No-op if omitted. */
  onUsage?: (model: string, usage: TokenUsage) => void;
  /** Optional: observe local schema-validation drops. No-op if omitted. */
  onRejectedCandidate?: (candidate: GenerateQuestionsRejectedCandidate) => void;
  /**
   * Optional: live count of questions Claude has finished writing so far,
   * read from the streamed tool input. Called only when the count rises;
   * the final call carries the full raw batch size (before schema drops).
   */
  onWritten?: (count: number) => void;
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

export const DEFAULT_MODEL = "claude-sonnet-4-6";

/** Default request timeout in ms. Bumped from 30s after observing repeated
 *  Anthropic `Request timed out` failures in prod logs. The route's
 *  `maxDuration` is 300s, so 60s here leaves ample headroom for the
 *  verification passes and the sequential Pexels photo attach that follow. */
export const DEFAULT_TIMEOUT_MS = 60_000;

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
    themeKey: opts.themeKey,
    avoidPrompts: opts.avoidPrompts,
  });

  // Time the Anthropic call so prod logs surface actual duration on
  // every attempt — needed to know if a future timeout bump or model
  // fallback is warranted. Log line is grep-able as `[generateQuestions]`.
  const t0 = Date.now();
  console.log(
    `[generateQuestions] calling ${model} topic="${opts.topic}" timeoutMs=${timeoutMs}`,
  );
  // Streamed call. The host screen shows a live "N of 20 written" count, so
  // we read the tool input as it arrives (`inputJson` gives the partially
  // parsed `emit_questions` input) instead of waiting for the whole batch.
  //
  // Timeout note (verified against @anthropic-ai/sdk 0.32.1 core.js): the
  // request option `timeout` only guards the time until response HEADERS
  // arrive — `fetchWithTimeout` clears its timer in `fetch().finally()`, and
  // the streamed body is read afterwards with no timer at all. So on a
  // stream, `timeout` alone would let a stalled body hang forever. We keep it
  // for the connect phase and add our own idle guard: if no stream event
  // arrives for `timeoutMs`, abort the stream and fail like a timeout.
  const stream = client.beta.promptCaching.messages.stream(
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
      // eager_input_streaming: without it the API buffers the whole tool
      // input and sends it in one burst at the end, so the live "N written"
      // count would jump 0 -> 20 (measured Oct 21: all 6 ticks at 17.9s).
      // With it, fragments stream as written. The trade-off is that the API
      // no longer validates the input for us; we already Zod-check every
      // question below and drop a cut-off last item on max_tokens.
      // SDK 0.32.1's types predate the field, hence the cast; the SDK sends
      // tool objects through unchanged.
      tools: [
        { ...emitQuestionsTool, eager_input_streaming: true } as typeof emitQuestionsTool,
      ],
      tool_choice: { type: "tool", name: EMIT_QUESTIONS_TOOL_NAME },
      // Slight temperature for creative variety without going off-spec.
      temperature: 0.7,
    },
    // One SDK retry, not the default two: a connection that never opens
    // waits timeoutMs per try, and three 60s tries plus backoff (~3 min) let
    // a late refill round run past the route's 300s limit, so the platform
    // killed the function before it could record a clean "paused".
    { timeout: timeoutMs, maxRetries: 1 },
  );

  let idleTimedOut = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const armIdleGuard = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimedOut = true;
      stream.abort();
    }, timeoutMs);
  };
  let reportedWritten = 0;
  const reportWritten = (count: number) => {
    if (count <= reportedWritten) return;
    reportedWritten = count;
    try {
      opts.onWritten?.(count);
    } catch (err) {
      // A listener bug must never kill the generation itself.
      console.warn(`[generateQuestions] onWritten threw: ${String(err)}`);
    }
  };
  // Listeners go on BEFORE the first await so an early error has a
  // waiting promise (finalMessage) to land in.
  // The idle guard starts on `connect` (response headers in), not now.
  // Before headers the SDK's own `timeout` applies and it retries a stalled
  // request itself; aborting from here first would cancel those retries,
  // because the SDK never retries a request whose signal was aborted.
  stream.on("connect", armIdleGuard);
  stream.on("streamEvent", armIdleGuard);
  stream.on("inputJson", (_partial, snapshot) => {
    reportWritten(countCompleteQuestions(snapshot));
  });

  let response: PromptCachingBetaMessage;
  try {
    response = await stream.finalMessage();
  } catch (err) {
    const dt = Date.now() - t0;
    const errName = err instanceof Error ? err.constructor.name : typeof err;
    const errMsg = err instanceof Error ? err.message : String(err);
    if (idleTimedOut) {
      const idleErr = new Error(
        `Request timed out: no stream data for ${timeoutMs}ms (idle timeout)`,
      );
      console.log(
        `[generateQuestions] FAILED after ${dt}ms (IdleTimeout): ${idleErr.message}`,
      );
      throw idleErr;
    }
    console.log(
      `[generateQuestions] FAILED after ${dt}ms (${errName}): ${errMsg}`,
    );
    throw err;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
  console.log(`[generateQuestions] returned in ${Date.now() - t0}ms`);
  opts.onUsage?.(model, response.usage);

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
  // With eager streaming the API no longer validates the tool input, so a
  // reply cut off at max_tokens can end in a question whose last field was
  // truncated yet still parses (e.g. a fact note stopping mid-sentence).
  // Drop that last item rather than risk saving it.
  if (response.stop_reason === "max_tokens" && input.questions.length > 0) {
    console.log(
      `[generateQuestions] hit max_tokens; dropping the possibly cut-off last question`,
    );
    input.questions.pop();
  }
  // The stream count held back the last (possibly unfinished) item; now the
  // batch is complete, report the true raw size.
  reportWritten(input.questions.length);

  const valid: GeneratedQuestion[] = [];
  for (let i = 0; i < input.questions.length; i++) {
    const candidate = input.questions[i];
    const parsed = GeneratedQuestionSchema.safeParse(candidate);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((iss) => iss.message);
      const prompt = rawCandidatePrompt(candidate);
      opts.onRejectedCandidate?.({
        index: i,
        reason: "invalid_schema",
        issues,
        ...(prompt === undefined ? {} : { prompt }),
      });
      // Drop the item, keep the batch. Log so dev notices recurring
      // drift (never log keys or full Claude response).
      console.warn(
        `[generateQuestions] dropped invalid question at index ${i}: ${issues.join(
          "; ",
        )}`,
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

/**
 * How many questions are COMPLETE in a partially parsed `emit_questions`
 * input. The SDK's partial parser closes the open object/array, so the last
 * item may still be mid-write: it is only counted once a later item has
 * started. Never over-reports.
 */
export function countCompleteQuestions(snapshot: unknown): number {
  if (!isQuestionsContainer(snapshot)) return 0;
  return Math.max(0, snapshot.questions.length - 1);
}

function rawCandidatePrompt(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("prompt" in value)) {
    return undefined;
  }
  const prompt = (value as { prompt: unknown }).prompt;
  return typeof prompt === "string" ? prompt : undefined;
}
