// Rewrite ONE fun fact to match a question the host has just edited.
//
// Why this exists: the host rewrites a question during setup, and the blurb
// the TV shows on the reveal — the line she reads aloud to the room — was
// written for whatever the question used to say. On 2026-07-29 that put a
// 5-12-13 Pythagorean-triple fact under "The square root of 900 is:", live,
// in front of ~25 players. Making her retype it by hand for every edit is
// the wrong answer: she edits a lot of questions while building a night.
//
// So this is a single, small, cheap call — one question in, one sentence
// out. It reuses the blurb rules from the batch generator's system prompt
// (`FACT_BLURB_RULES` in ./prompts) so a rewritten fact reads exactly like a
// generated one.
//
// Model: DEFAULT_MODEL (Sonnet), deliberately NOT Haiku. The 2026-06-05
// benchmark in generate-questions.ts found Haiku wrote factually-wrong
// content, and this string is read out as truth. Same model that writes
// these today = no quality regression, and one short call is a rounding
// error next to a 20-question batch.
//
// Returns `null` rather than throwing when Claude gives us nothing usable.
// Callers MUST treat null as "clear the blurb", never "keep the old one" —
// no fact is safe, a wrong fact is not.
//
// Tests: tests/unit/generate-fact-blurb.test.ts (SDK mocked, no network).

import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { FACT_BLURB_RULES } from "./prompts";
import { DEFAULT_MODEL } from "./generate-questions";

/** Matches the cap in PatchQuestionBodySchema — a blurb this call produces
 *  has to survive the same PATCH the host's own typing goes through. */
const MAX_BLURB_CHARS = 280;

const BlurbSchema = z.string().trim().min(8).max(MAX_BLURB_CHARS);

const EMIT_TOOL_NAME = "emit_fact_blurb";

const emitFactBlurbTool: Anthropic.Tool = {
  name: EMIT_TOOL_NAME,
  description:
    "Emit the single-sentence fact blurb shown on the TV when the answer is revealed.",
  input_schema: {
    type: "object",
    properties: {
      blurb: {
        type: "string",
        minLength: 8,
        maxLength: MAX_BLURB_CHARS,
        description:
          "One sentence explaining why the answer is the answer. No preamble.",
      },
    },
    required: ["blurb"],
  },
};

export interface GenerateFactBlurbOptions {
  prompt: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  /** Injected in tests. */
  client?: Anthropic;
  model?: string;
  timeoutMs?: number;
}

/** Short by design. One sentence from a warm model should land well inside
 *  this; the host is waiting on it mid-build, so we fail fast and clear the
 *  blurb rather than hang her save. */
export const FACT_BLURB_TIMEOUT_MS = 20_000;

/**
 * Ask Claude for one fact blurb matching the question as it now reads.
 *
 * Never throws for content reasons — returns `null` when Claude emits no
 * tool call, or a blurb that fails validation. Network/auth failures from
 * the SDK still propagate; the route decides what to do with those.
 */
export async function generateFactBlurb(
  opts: GenerateFactBlurbOptions,
): Promise<string | null> {
  const client =
    opts.client ??
    new Anthropic({ apiKey: requireApiKey() });
  const model = opts.model ?? DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? FACT_BLURB_TIMEOUT_MS;

  const answer = opts.options[opts.correctIndex];
  const userPrompt = [
    `Question: ${opts.prompt}`,
    `Options: ${opts.options.map((o, i) => `${i + 1}. ${o}`).join("  ")}`,
    `The correct answer is: ${answer}`,
    "",
    "Write the fact blurb for THIS question and THIS answer. It will be read",
    "aloud to a room, so it must be accurate. If you are not confident of a",
    "colorful detail, state the plain reason the answer is correct instead.",
    `Call the ${EMIT_TOOL_NAME} tool with the result.`,
  ].join("\n");

  const t0 = Date.now();
  const response = await client.messages.create(
    {
      model,
      max_tokens: 400,
      system: FACT_BLURB_RULES,
      messages: [{ role: "user", content: userPrompt }],
      tools: [emitFactBlurbTool],
      tool_choice: { type: "tool", name: EMIT_TOOL_NAME },
      // Lower than the batch generator's 0.7. There is no variety to chase
      // here — one question, one right explanation.
      temperature: 0.3,
    },
    { timeout: timeoutMs },
  );
  console.log(`[generateFactBlurb] ${model} returned in ${Date.now() - t0}ms`);

  const toolBlock = response.content.find(
    (block): block is Extract<typeof block, { type: "tool_use" }> =>
      block.type === "tool_use" && block.name === EMIT_TOOL_NAME,
  );
  if (!toolBlock) {
    console.warn("[generateFactBlurb] no tool call returned");
    return null;
  }

  const input = toolBlock.input as { blurb?: unknown } | null;
  const parsed = BlurbSchema.safeParse(input?.blurb);
  if (!parsed.success) {
    console.warn(
      `[generateFactBlurb] rejected blurb: ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`,
    );
    return null;
  }
  return parsed.data;
}

function requireApiKey(): string {
  const v = process.env.ANTHROPIC_API_KEY;
  if (!v) {
    throw new Error(
      "Missing env: ANTHROPIC_API_KEY — set in .env.local before rewriting fact blurbs",
    );
  }
  return v;
}
