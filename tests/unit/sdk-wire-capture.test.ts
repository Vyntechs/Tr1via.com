// @vitest-environment node
//
// Wire capture for every Anthropic call site (SDK upgrade guard).
//
// Builds a REAL Anthropic client with an injected `fetch` that records the
// exact HTTP request the SDK puts on the wire (URL, headers, raw body string)
// and answers with a canned reply. No network, no API key, no cost.
//
// The baseline in __wire__/sdk-requests.baseline.json was captured on
// @anthropic-ai/sdk 0.32.1 before the upgrade. This test asserts today's
// requests match it byte-for-byte, allowing only the documented removals.
//
// Re-capture (only on purpose): WRITE_WIRE_BASELINE=1 npx vitest run tests/unit/sdk-wire-capture.test.ts
// Dump the current capture for a diff: WIRE_CAPTURE_OUT=/some/file.json ...

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";

import { generateQuestions } from "@/lib/ai/generate-questions";
import { verifyAnswers } from "@/lib/ai/verify-answers";
import { generateFactBlurb } from "@/lib/ai/generate-fact-blurb";
import type { GeneratedQuestion } from "@/lib/ai/generate-questions";

const BASELINE = path.join(__dirname, "__wire__", "sdk-requests.baseline.json");

interface WireRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

interface CallSiteCapture {
  /** The request options the app code passed to the SDK method (timeout, maxRetries). */
  callOptions: unknown[];
  requests: WireRequest[];
  /** How many HTTP attempts the SDK makes when every attempt gets a 500. */
  attemptsOn500: number;
}

type Capture = Record<string, CallSiteCapture>;

// ─── canned replies ───────────────────────────────────────────────────

const QUESTION = {
  prompt: "Which Pixar film features a rat who wants to be a chef?",
  options: ["Ratatouille", "Up", "Cars", "Coco"],
  correctIndex: 0,
  difficulty: 3,
  factBlurb: "Remy cooks in Gusteau's kitchen in Paris.",
  photoQuery: "paris kitchen",
};

function sse(events: Array<Record<string, unknown>>): string {
  return events
    .map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
}

function writerSse(): string {
  const json = JSON.stringify({ questions: [QUESTION, QUESTION, QUESTION] });
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += 40) chunks.push(json.slice(i, i + 40));
  return sse([
    {
      type: "message_start",
      message: {
        id: "msg_wire",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_wire", name: "emit_questions", input: {} },
    },
    ...chunks.map((partial_json) => ({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json },
    })),
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 50 },
    },
    { type: "message_stop" },
  ]);
}

function toolMessage(name: string, input: unknown) {
  return {
    id: "msg_wire",
    type: "message",
    role: "assistant",
    model: "claude-opus-4-8",
    content: [{ type: "tool_use", id: "toolu_wire", name, input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

function verdictsFor(n: number) {
  return {
    verdicts: Array.from({ length: n }, (_, index) => ({
      index,
      ambiguous: false,
      answerableWithoutImage: true,
      fitsRequestedTopic: true,
      basis: "Plain fact.",
      derivedCorrectIndex: 0,
      markedAnswerIsCorrect: true,
      factBlurbIsCorrect: true,
    })),
  };
}

// ─── recording client ─────────────────────────────────────────────────

function headersToObject(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(h ?? {}).forEach((v, k) => {
    out[k.toLowerCase()] = k.toLowerCase() === "x-api-key" ? "<test-key>" : v;
  });
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function makeRecordingClient(
  reply: (body: string) => Response,
  requests: WireRequest[],
  callOptions: unknown[],
): Anthropic {
  const recordingFetch = async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String((input as { url?: string }).url ?? input);
    const body = typeof init?.body === "string" ? init.body : String(init?.body ?? "");
    requests.push({
      method: init?.method ?? "GET",
      url,
      headers: headersToObject(init?.headers as HeadersInit),
      body,
    });
    return reply(body);
  };
  const client = new Anthropic({
    apiKey: "test-key",
    fetch: recordingFetch as unknown as typeof fetch,
  });
  // Record the options the APP passes (timeout, maxRetries). The SDK's own
  // inner call from a stream carries an AbortSignal; the app never passes one,
  // so calls with a signal are the SDK talking to itself and are skipped.
  const wrap = (obj: Record<string, unknown> | undefined, name: string) => {
    if (!obj || typeof obj[name] !== "function") return;
    const original = (obj[name] as (...a: unknown[]) => unknown).bind(obj);
    obj[name] = (params: unknown, options?: Record<string, unknown>) => {
      if (!options || !("signal" in options)) callOptions.push(options ?? null);
      return original(params, options);
    };
  };
  // (The 0.32.1 baseline was captured with the same wrapper on
  // client.beta.promptCaching.messages, which no longer exists.)
  const anyClient = client as unknown as { messages: Record<string, unknown> };
  wrap(anyClient.messages, "create");
  wrap(anyClient.messages, "stream");
  return client;
}

function okReply(body: string): Response {
  if (/"stream":\s*true/.test(body)) {
    return new Response(writerSse(), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }
  const parsed = JSON.parse(body) as {
    tool_choice?: { name?: string };
    messages: Array<{ content: string }>;
  };
  const toolName = parsed.tool_choice?.name ?? "";
  const input =
    toolName === "emit_fact_blurb"
      ? { blurb: "Remy cooks in Paris." }
      : verdictsFor(6);
  return new Response(JSON.stringify(toolMessage(toolName, input)), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function failReply(): Response {
  return new Response(
    JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }),
    {
      status: 500,
      headers: { "content-type": "application/json", "retry-after-ms": "1" },
    },
  );
}

const SIX: GeneratedQuestion[] = Array.from({ length: 6 }, (_, i) => ({
  prompt: `${QUESTION.prompt} (${i})`,
  options: ["Ratatouille", "Up", "Cars", "Coco"],
  correctIndex: 0,
  difficulty: 3,
  factBlurb: QUESTION.factBlurb,
  photoQuery: QUESTION.photoQuery,
}));

const CALL_SITES: Record<string, (client: Anthropic) => Promise<unknown>> = {
  writer: (client) =>
    generateQuestions({
      topic: "Pixar movies",
      flavor: ["More pop"],
      difficulty: "hard",
      count: 20,
      avoidPrompts: ["Who directed Toy Story?"],
      client,
    }),
  checker_blind: (client) =>
    verifyAnswers(SIX, { topic: "Pixar movies", mode: "blind", client }),
  checker_adversarial: (client) =>
    verifyAnswers(SIX, { topic: "Pixar movies", mode: "adversarial", client }),
  fact_note: (client) =>
    generateFactBlurb({
      prompt: QUESTION.prompt,
      options: ["Ratatouille", "Up", "Cars", "Coco"],
      correctIndex: 0,
      client,
    }),
};

async function captureAll(): Promise<Capture> {
  const out: Capture = {};
  for (const [name, run] of Object.entries(CALL_SITES)) {
    const requests: WireRequest[] = [];
    const callOptions: unknown[] = [];
    await run(makeRecordingClient(okReply, requests, callOptions));

    const failed: WireRequest[] = [];
    await run(makeRecordingClient(failReply, failed, [])).catch(() => undefined);

    out[name] = { callOptions, requests, attemptsOn500: failed.length };
  }
  return out;
}

// ─── comparison ───────────────────────────────────────────────────────

/** Headers that are SDK self-description (version, runtime, retry/timeout
 *  telemetry) and legitimately change with any SDK release. Not compared. */
function isSdkTelemetryHeader(name: string): boolean {
  return name === "user-agent" || name.startsWith("x-stainless-");
}

/** The only differences the upgrade is allowed to make: the old prompt-caching
 *  beta path and header go away (prompt caching is GA). */
function compactJson(body: string): string {
  return JSON.stringify(JSON.parse(body));
}

function normalize(req: WireRequest) {
  const headers = Object.fromEntries(
    Object.entries(req.headers).filter(
      // content-length follows the body's whitespace (checked via the body).
      ([k]) =>
        !isSdkTelemetryHeader(k) && k !== "anthropic-beta" && k !== "content-length",
    ),
  );
  return {
    // 0.32.1 handed fetch "post" (its fetch upper-cased it on the wire);
    // current SDKs hand over "POST". Same HTTP request line either way.
    method: req.method.toUpperCase(),
    url: req.url.replace("?beta=prompt_caching", ""),
    headers,
    body: compactJson(req.body),
  };
}

describe("Anthropic wire capture (SDK upgrade guard)", () => {
  it("every call site sends the same request as the 0.32.1 baseline, minus the prompt-caching beta", async () => {
    const current = await captureAll();

    if (process.env.WIRE_CAPTURE_OUT) {
      fs.writeFileSync(process.env.WIRE_CAPTURE_OUT, JSON.stringify(current, null, 2) + "\n");
    }
    if (process.env.WRITE_WIRE_BASELINE === "1" || !fs.existsSync(BASELINE)) {
      fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
      fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + "\n");
    }
    const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8")) as Capture;

    expect(Object.keys(current).sort()).toEqual(Object.keys(baseline).sort());
    for (const site of Object.keys(baseline)) {
      const b = baseline[site]!;
      const c = current[site]!;
      expect(c.requests.length, `${site}: request count`).toBe(b.requests.length);
      b.requests.forEach((breq, i) => {
        const creq = c.requests[i]!;
        // SDK 0.32.1 pretty-prints the JSON body (2-space indent); current
        // SDKs send it compact. Whitespace between JSON tokens carries no
        // meaning, so compare the compact form as a raw STRING: same keys,
        // same key order, same characters in every value.
        expect(compactJson(creq.body), `${site}[${i}]: body`).toBe(compactJson(breq.body));
        expect(normalize(creq), `${site}[${i}]: request`).toEqual(normalize(breq));
      });
      expect(c.callOptions, `${site}: timeout/maxRetries passed by app`).toEqual(b.callOptions);
      expect(c.attemptsOn500, `${site}: attempts when every try fails`).toBe(b.attemptsOn500);
      // The removals themselves: no prompt-caching beta path or header left.
      for (const creq of c.requests) {
        expect(creq.url, `${site}: plain endpoint`).toBe("https://api.anthropic.com/v1/messages");
        expect(creq.headers["anthropic-beta"], `${site}: no beta header`).toBeUndefined();
        expect(creq.headers["anthropic-version"], `${site}: API version`).toBe("2023-06-01");
      }
    }
  });
});
