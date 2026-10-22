// The NEW question writer (step 4 of the question-engine plan).
//
// Runs only for hosts whose switch reads "new" (host_question_engine_settings,
// read once per build in app/api/categories/[id]/generate/route.ts). Classic
// keeps lib/ai/generate-questions.ts exactly as it was.
//
// What is different from Classic:
//   - Model claude-sonnet-5-5 at effort "medium". No temperature (the 5.5
//     models refuse a non-default one). Thinking stays adaptive (the default;
//     "disabled" is refused) but is shown as a summary, so the stream keeps
//     sending thinking updates while the model thinks (see the idle guard).
//   - Structured output (`output_config.format`, a JSON schema) instead of a
//     forced tool call, which the 5.5 models refuse.
//   - The model writes the right answer and three wrong answers as separate
//     fields. The code builds the four choices and shuffles them, so the right
//     answer's slot is random, not the model's habit (it put the key first on
//     ~96% of Classic questions).
//   - Today's date goes in the per-call message.
//   - A short prose prompt with real loved/flopped examples (prompts-new.ts).
//   - Output limit 20,000 tokens. Thinking shares it and can't be capped on
//     Sonnet 5.5 (budget_tokens is refused; effort is the only lever), so the
//     limit covers ~5k of answer JSON plus ~15k of thinking. It is a ceiling,
//     not a charge. At ~100 tokens/s a reply that uses all of it takes ~200s.
//     New builds run under the route's 800s limit (Classic still plans
//     around 300s), so that fits, refill rounds included.
//   - Total time cap, a safety net: the writer stops NEW_WRITER_STOP_AFTER_MS
//     after the route's request began (the route passes its startedAtMs, the
//     same clock its photo cutoff uses). Hitting it is handled like the output-limit
//     cutoff: finished questions are kept and checked, the unfinished one is
//     reported, and a refill round that has no time left throws, which lands
//     in the route's "paused, resume to finish" handling. Never a silent
//     partial batch stored as complete.
//
// Output lands in the SAME GeneratedQuestion shape Classic returns, so the
// checker, photo and pick steps after it are untouched:
//   question -> prompt, rightAnswer + wrongAnswer1..3 -> options/correctIndex,
//   difficulty -> difficulty, factNote -> factBlurb, photoWords -> photoQuery.
//
// Short-batch guard ("never store fewer silently"): every dropped question is
// reported through onRejectedCandidate (the route records it in the quality
// report), a short batch is logged loudly, and the short batch goes back to the
// existing collect loop, whose next round asks for exactly the gap. A reply that cannot
// be read at all (refusal, no text, broken JSON, zero valid questions) throws,
// which lands in the route's existing "paused, resume to finish" handling.

import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import {
  DEFAULT_TIMEOUT_MS,
  GeneratedQuestionSchema,
  type GenerateQuestionsOptions,
  type GeneratedQuestion,
} from "./generate-questions";
import { NEW_SYSTEM_PROMPT, newUserPromptFor } from "./prompts-new";
import { shuffleChoices } from "./shuffle-choices";

export const NEW_WRITER_MODEL = "claude-sonnet-5-5";
export const NEW_WRITER_EFFORT = "medium" as const;
/** Questions per call. Brandon's call (2026-10-21): 20, not the review's 30. */
export const NEW_WRITER_BATCH = 20;
/** 20 questions run ~4-5k output tokens; thinking shares this limit and has
 *  no separate cap on Sonnet 5.5, so the rest is thinking headroom. */
export const NEW_WRITER_MAX_TOKENS = 20_000;
/**
 * Longest quiet spell the New writer allows on the stream before it gives up.
 * Classic uses 60s, but the SDK drops the server's keep-alive pings, so a
 * thinking stretch with nothing shown would look dead. Summarized thinking
 * sends updates; this wider window covers a quiet gap between them. It limits
 * gaps only; the total is limited by NEW_WRITER_STOP_AFTER_MS below.
 */
export const NEW_WRITER_IDLE_MS = 120_000;
/**
 * Total time cap for writing, counted from when the route's request began
 * (route.ts startedAtMs). A safety net, not a target: a normal build is done
 * writing in well under a minute, and a reply using all 20,000 tokens takes
 * ~200s. Without it, a writer that keeps sending updates could run into
 * Vercel's 800s wall and be killed mid-build. Budget on New's clock: writing
 * stops by 660s; the two checker passes run side by side, each up to a 60s
 * wait for the first byte plus ~20s of answer, so they end by ~740s; photos
 * stop at 770s (NEW_PHOTO_STOP_AFTER_MS); Vercel ends the request at 800s.
 */
export const NEW_WRITER_STOP_AFTER_MS = 660_000;
/** A writing round is not started with less time than this left before the
 *  cap: it could not finish a question, so it would only cost money. */
export const NEW_WRITER_MIN_START_MS = 20_000;
/** Thinking stays adaptive (Sonnet 5.5's only "on" mode) but streams summary
 *  updates, so a long think is not silent. Display only: billed the same. */
export const NEW_WRITER_THINKING = { type: "adaptive", display: "summarized" } as const;

export interface GenerateQuestionsNewOptions extends GenerateQuestionsOptions {
  /** Injectable clock for the date line (tests pin it). */
  now?: Date;
  /** Injectable randomness for the answer shuffle (tests pin it). */
  random?: () => number;
  /** Quiet spell on the stream before the call is aborted. Default NEW_WRITER_IDLE_MS. */
  idleMs?: number;
  /** When the route's request began (ms since epoch); the total time cap
   *  counts from here. Absent = from the start of this call. */
  startedAtMs?: number;
  /** Total time cap from startedAtMs. Default NEW_WRITER_STOP_AFTER_MS. */
  stopAfterMs?: number;
}

// JSON schema for structured output. The API refuses length and number
// limits (minLength, minimum, minItems...) in these schemas, so the limits
// live in GeneratedQuestionSchema (Zod) and are checked per question below.
export const NEW_WRITER_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          rightAnswer: { type: "string" },
          wrongAnswer1: { type: "string" },
          wrongAnswer2: { type: "string" },
          wrongAnswer3: { type: "string" },
          difficulty: { type: "integer", enum: [1, 2, 3, 4, 5, 6, 7] },
          factNote: { type: "string" },
          photoWords: { type: "string" },
        },
        required: [
          "question",
          "rightAnswer",
          "wrongAnswer1",
          "wrongAnswer2",
          "wrongAnswer3",
          "difficulty",
          "factNote",
          "photoWords",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

function makeClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "Missing env: ANTHROPIC_API_KEY — set in .env.local before generating questions",
    );
  }
  return new Anthropic({ apiKey: key });
}

/** Maps one raw item from the model into Classic's candidate shape, with the
 *  right answer first. Non-objects pass through so Zod reports them. */
function toClassicCandidate(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const r = raw as Record<string, unknown>;
  return {
    prompt: r.question,
    options: [r.rightAnswer, r.wrongAnswer1, r.wrongAnswer2, r.wrongAnswer3],
    correctIndex: 0,
    difficulty: r.difficulty,
    factBlurb: r.factNote,
    photoQuery: r.photoWords,
  };
}

function questionsOf(value: unknown): unknown[] | null {
  if (typeof value !== "object" || value === null) return null;
  const qs = (value as { questions?: unknown }).questions;
  return Array.isArray(qs) ? qs : null;
}

/**
 * Reads a possibly unfinished `{"questions":[{...},{...` reply and returns
 * every question object that has fully closed, plus whether an unfinished one
 * was left at the end. A small bracket scanner that skips over strings; it
 * avoids the SDK's private partial-JSON parser, whose import path is not part
 * of the SDK's public surface.
 */
export function completeNewQuestions(text: string): {
  items: unknown[];
  unfinished: boolean;
} {
  const items: unknown[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let itemStart = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") {
      depth++;
      // depth 1 = the outer object, 2 = the questions array, 3 = one question.
      if (ch === "{" && depth === 3) itemStart = i;
    } else if (ch === "}" || ch === "]") {
      if (ch === "}" && depth === 3 && itemStart >= 0) {
        try {
          items.push(JSON.parse(text.slice(itemStart, i + 1)));
        } catch {
          /* not a clean object; leave it out */
        }
        itemStart = -1;
      }
      depth--;
    }
  }
  return { items, unfinished: itemStart >= 0 };
}

/** Questions fully written so far, for the live "N written" count. */
export function countCompleteNewQuestions(partialText: string): number {
  return completeNewQuestions(partialText).items.length;
}

export async function generateQuestionsNew(
  opts: GenerateQuestionsNewOptions,
): Promise<GeneratedQuestion[]> {
  const client = opts.client ?? makeClient();
  const model = opts.model ?? NEW_WRITER_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const idleMs = opts.idleMs ?? NEW_WRITER_IDLE_MS;
  const count = Math.max(1, Math.min(NEW_WRITER_BATCH, opts.count ?? NEW_WRITER_BATCH));

  const userPrompt = newUserPromptFor({
    topic: opts.topic,
    flavor: opts.flavor,
    difficulty: opts.difficulty,
    count,
    themeKey: opts.themeKey,
    avoidPrompts: opts.avoidPrompts,
    now: opts.now,
  });

  const t0 = Date.now();
  const stopAfterMs = opts.stopAfterMs ?? NEW_WRITER_STOP_AFTER_MS;
  const deadlineAtMs = (opts.startedAtMs ?? t0) + stopAfterMs;
  const timeLeftMs = deadlineAtMs - t0;
  if (timeLeftMs < NEW_WRITER_MIN_START_MS) {
    // A refill round with no time left: stop here (no paid call) and let the
    // route pause the build so the host can resume it.
    const err = new Error(
      `generateQuestionsNew: out of writing time (${stopAfterMs}ms cap, ${Math.max(0, timeLeftMs)}ms left); paused before another round`,
    );
    console.log(`[generateQuestionsNew] ${err.message}`);
    throw err;
  }
  console.log(
    `[generateQuestionsNew] calling ${model} topic="${opts.topic}" count=${count} timeoutMs=${timeoutMs} idleMs=${idleMs} timeLeftMs=${timeLeftMs}`,
  );
  const stream = client.messages.stream(
    {
      model,
      max_tokens: NEW_WRITER_MAX_TOKENS,
      system: [
        {
          type: "text",
          text: NEW_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userPrompt }],
      thinking: NEW_WRITER_THINKING,
      output_config: {
        effort: NEW_WRITER_EFFORT,
        format: { type: "json_schema", schema: NEW_WRITER_OUTPUT_SCHEMA },
      },
    },
    // Same retry and timeout policy as Classic (see generate-questions.ts).
    { timeout: timeoutMs, maxRetries: 1 },
  );

  // Idle guard: the SDK timeout covers only the wait for response headers,
  // not a stalled streamed body. Any event the SDK passes on (thinking
  // updates included) re-arms it; the server's pings never reach us.
  let idleTimedOut = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const armIdleGuard = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimedOut = true;
      stream.abort();
    }, idleMs);
  };
  let reportedWritten = 0;
  const reportWritten = (n: number) => {
    if (n <= reportedWritten) return;
    reportedWritten = n;
    try {
      opts.onWritten?.(n);
    } catch (err) {
      console.warn(`[generateQuestionsNew] onWritten threw: ${String(err)}`);
    }
  };
  stream.on("connect", armIdleGuard);
  stream.on("streamEvent", armIdleGuard);
  // Structured output streams as text, not tool input.
  let latestText = "";
  stream.on("text", (_delta, snapshot) => {
    latestText = snapshot;
    reportWritten(countCompleteNewQuestions(snapshot));
  });
  // Total time cap. Armed now, not on connect: the wait for headers and a
  // retry spend the same budget.
  let deadlineHit = false;
  const deadlineTimer = setTimeout(() => {
    deadlineHit = true;
    stream.abort();
  }, timeLeftMs);

  let response: Anthropic.Message | null = null;
  try {
    response = await stream.finalMessage();
  } catch (err) {
    const dt = Date.now() - t0;
    if (deadlineHit) {
      console.log(
        `[generateQuestionsNew] stopped at the time cap after ${dt}ms (${stopAfterMs}ms from request start); usage unknown for a stopped call`,
      );
    } else if (idleTimedOut) {
      const idleErr = new Error(
        `Request timed out: no stream data for ${idleMs}ms (idle timeout)`,
      );
      console.log(`[generateQuestionsNew] FAILED after ${dt}ms (IdleTimeout): ${idleErr.message}`);
      throw idleErr;
    } else {
      const errName = err instanceof Error ? err.constructor.name : typeof err;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`[generateQuestionsNew] FAILED after ${dt}ms (${errName}): ${errMsg}`);
      throw err;
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(deadlineTimer);
  }

  let truncated = false;
  let text = latestText;
  if (response) {
    console.log(
      `[generateQuestionsNew] returned in ${Date.now() - t0}ms stop=${response.stop_reason}`,
    );
    opts.onUsage?.(model, response.usage);

    if (response.stop_reason === "refusal") {
      throw new Error("generateQuestionsNew: the model declined to write this topic");
    }
    // Checked before anything reads the text: thinking shares the output
    // limit, so a cut-off reply can hold little or no question text at all.
    truncated = response.stop_reason === "max_tokens";
    text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
  // Stopped early: at the output limit, or at the time cap (no response).
  const cutOffBy = response === null ? "time" : truncated ? "output" : null;

  let rawQuestions: unknown[];
  if (cutOffBy) {
    // Keep the questions that closed and drop the unfinished one, which may
    // have stopped mid-field. A partial batch goes back to the collect loop,
    // whose refill round asks for the gap (or pauses if no time is left).
    const limitName =
      cutOffBy === "time"
        ? `${stopAfterMs}ms time cap`
        : `${NEW_WRITER_MAX_TOKENS}-token output limit`;
    const { items, unfinished } = completeNewQuestions(text);
    if (items.length === 0) {
      throw new Error(
        `generateQuestionsNew: hit the ${limitName} before any question finished`,
      );
    }
    rawQuestions = items;
    console.warn(
      `[generateQuestionsNew] hit the ${limitName}; kept ${items.length} finished questions`,
    );
    if (unfinished) {
      opts.onRejectedCandidate?.({
        index: items.length,
        reason: "invalid_schema",
        issues: [
          cutOffBy === "time" ? "cut off at the time cap" : "cut off at the output limit",
        ],
      });
    }
  } else {
    if (!text.trim()) {
      throw new Error("generateQuestionsNew: the reply had no question text");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("generateQuestionsNew: the reply was not valid JSON");
    }
    const qs = questionsOf(parsed);
    if (!qs) {
      throw new Error("generateQuestionsNew: the reply had no `questions` array");
    }
    rawQuestions = qs;
  }
  reportWritten(rawQuestions.length);

  const valid: GeneratedQuestion[] = [];
  rawQuestions.forEach((raw, i) => {
    const parsed = GeneratedQuestionSchema.safeParse(toClassicCandidate(raw));
    if (!parsed.success) {
      const issues = parsed.error.issues.map((iss) => iss.message);
      const prompt = (raw as { question?: unknown } | null)?.question;
      opts.onRejectedCandidate?.({
        index: i,
        reason: "invalid_schema",
        issues,
        ...(typeof prompt === "string" ? { prompt } : {}),
      });
      console.warn(
        `[generateQuestionsNew] dropped invalid question at index ${i}: ${issues.join("; ")}`,
      );
      return;
    }
    const q = parsed.data;
    valid.push(
      shuffleChoices(
        {
          prompt: q.prompt,
          options: [q.options[0]!, q.options[1]!, q.options[2]!, q.options[3]!],
          correctIndex: q.correctIndex,
          difficulty: q.difficulty,
          factBlurb: q.factBlurb,
          photoQuery: q.photoQuery,
        },
        opts.random,
      ),
    );
  });

  if (valid.length === 0) {
    throw new Error(
      `generateQuestionsNew: 0 of ${count} requested questions were usable`,
    );
  }
  if (valid.length < count) {
    // Loud, never silent: the collect loop's next round asks for the gap.
    console.warn(
      `[generateQuestionsNew] SHORT BATCH: ${valid.length} of ${count} usable${cutOffBy === "output" ? " (output limit hit)" : cutOffBy === "time" ? " (time cap hit)" : ""}; the refill round asks for the rest`,
    );
  }
  return valid;
}
