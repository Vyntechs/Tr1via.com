// @vitest-environment node
//
// Wire capture for the NEW question writer (engine "new", step 4).
//
// Kept apart from tests/unit/sdk-wire-capture.test.ts ON PURPOSE: that file
// and its baseline cover only the Classic call sites (writer, checker x2,
// fact note) and are left byte-for-byte untouched, so it still proves
// Heather's Classic requests did not move. This file has its own baseline,
// captured once on @anthropic-ai/sdk 0.137.0 when the new writer was added.
//
// A missing baseline FAILS; it is never re-captured silently.
// Re-capture (only on purpose): WRITE_WIRE_BASELINE_NEW=1 npx vitest run tests/unit/sdk-wire-capture-new-writer.test.ts

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";

import { generateQuestionsNew } from "@/lib/ai/generate-questions-new";

const BASELINE = path.join(__dirname, "__wire__", "sdk-requests-new-writer.baseline.json");
// The per-call message carries today's date, so the capture pins the clock.
const NOW = new Date("2026-10-21T18:00:00Z");

interface WireRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

interface CallSiteCapture {
  callOptions: unknown[];
  requests: WireRequest[];
  attemptsOn500: number;
}

function ev(e: Record<string, unknown>): string {
  return `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`;
}

function textReplySse(): string {
  const q = {
    question: "Which Pixar film features a rat who wants to be a chef?",
    rightAnswer: "Ratatouille",
    wrongAnswer1: "Up",
    wrongAnswer2: "Cars",
    wrongAnswer3: "Coco",
    difficulty: 3,
    factNote: "Remy cooks in Gusteau's kitchen in Paris.",
    photoWords: "paris kitchen",
  };
  const text = JSON.stringify({ questions: [q] });
  return [
    ev({
      type: "message_start",
      message: {
        id: "msg_wire_new",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    }),
    ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }),
    ev({ type: "content_block_stop", index: 0 }),
    ev({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 50 } }),
    ev({ type: "message_stop" }),
  ].join("");
}

function headersToObject(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(h ?? {}).forEach((v, k) => {
    const key = k.toLowerCase();
    // SDK self-description (version, runtime, retry/timeout telemetry) is not compared.
    if (key === "user-agent" || key.startsWith("x-stainless-")) return;
    out[key] = key === "x-api-key" ? "<test-key>" : v;
  });
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function makeRecordingClient(
  reply: () => Response,
  requests: WireRequest[],
  callOptions: unknown[],
): Anthropic {
  const recordingFetch = async (input: unknown, init?: RequestInit) => {
    requests.push({
      method: (init?.method ?? "GET").toUpperCase(),
      url: typeof input === "string" ? input : String((input as { url?: string }).url ?? input),
      headers: headersToObject(init?.headers as HeadersInit),
      body: typeof init?.body === "string" ? init.body : String(init?.body ?? ""),
    });
    return reply();
  };
  const client = new Anthropic({ apiKey: "test-key", fetch: recordingFetch as unknown as typeof fetch });
  const messages = (client as unknown as { messages: Record<string, unknown> }).messages;
  const original = (messages.stream as (...a: unknown[]) => unknown).bind(messages);
  messages.stream = (params: unknown, options?: Record<string, unknown>) => {
    if (!options || !("signal" in options)) callOptions.push(options ?? null);
    return original(params, options);
  };
  return client;
}

const run = (client: Anthropic) =>
  generateQuestionsNew({
    topic: "Pixar movies",
    flavor: ["More pop"],
    difficulty: "hard",
    count: 20,
    avoidPrompts: ["Who directed Toy Story?"],
    client,
    now: NOW,
  });

async function capture(): Promise<CallSiteCapture> {
  const requests: WireRequest[] = [];
  const callOptions: unknown[] = [];
  await run(
    makeRecordingClient(
      () => new Response(textReplySse(), { status: 200, headers: { "content-type": "text/event-stream" } }),
      requests,
      callOptions,
    ),
  );
  const failed: WireRequest[] = [];
  await run(
    makeRecordingClient(
      () =>
        new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }), {
          status: 500,
          headers: { "content-type": "application/json", "retry-after-ms": "1" },
        }),
      failed,
      [],
    ),
  ).catch(() => undefined);
  return { callOptions, requests, attemptsOn500: failed.length };
}

describe("Anthropic wire capture (new writer)", () => {
  it("the new writer sends exactly the captured request", async () => {
    const current = await capture();
    if (process.env.WRITE_WIRE_BASELINE_NEW === "1") {
      fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
      fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + "\n");
    }
    expect(fs.existsSync(BASELINE), `baseline missing: ${BASELINE}`).toBe(true);
    const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8")) as CallSiteCapture;

    expect(current.requests.length).toBe(baseline.requests.length);
    baseline.requests.forEach((b, i) => {
      const c = current.requests[i]!;
      expect(c.body, `request ${i}: body`).toBe(b.body);
      expect(c, `request ${i}: request`).toEqual(b);
    });
    expect(current.callOptions).toEqual(baseline.callOptions);
    expect(current.attemptsOn500).toBe(baseline.attemptsOn500);

    // What the baseline must say, so a bad re-capture can't sneak through.
    const body = JSON.parse(baseline.requests[0]!.body) as Record<string, unknown>;
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.max_tokens).toBe(20000);
    expect(body.stream).toBe(true);
    expect((body.output_config as { effort: string }).effort).toBe("medium");
    expect((body.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    for (const key of ["temperature", "tools", "tool_choice"]) {
      expect(body, key).not.toHaveProperty(key);
    }
    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(baseline.requests[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(baseline.requests[0]!.headers["anthropic-beta"]).toBeUndefined();
    expect(baseline.requests[0]!.headers["anthropic-version"]).toBe("2023-06-01");
    expect(baseline.callOptions).toEqual([{ timeout: 60000, maxRetries: 1 }]);
    expect(baseline.attemptsOn500).toBe(2);
  });
});
