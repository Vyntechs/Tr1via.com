// @vitest-environment node
//
// The #221 stream behavior, proved through the REAL SDK MessageStream (not a
// hand-made fake): a real Anthropic client whose injected `fetch` returns a
// server-sent-event body this test feeds piece by piece. No network, no key.
//
//   * progress ticks arrive while the reply is still streaming
//   * the 60 s idle guard aborts a silent stream (fake timers), no retry
//   * stop_reason max_tokens drops the possibly cut-off last question
//   * a failing request is tried twice in total (maxRetries 1)

import { describe, it, expect, vi, afterEach } from "vitest";
import Anthropic from "@anthropic-ai/sdk";

import { generateQuestions, DEFAULT_TIMEOUT_MS } from "@/lib/ai/generate-questions";

const Q = (n: number) => ({
  prompt: `Which Pixar film is number ${n} in this test list?`,
  options: ["Ratatouille", "Up", "Cars", "Coco"],
  correctIndex: 0,
  difficulty: 3,
  factBlurb: "Remy cooks in Gusteau's kitchen in Paris.",
  photoQuery: "paris kitchen",
});

function ev(e: Record<string, unknown>): string {
  return `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`;
}

const START = [
  ev({
    type: "message_start",
    message: {
      id: "msg_s",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 1 },
    },
  }),
  ev({
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "toolu_s", name: "emit_questions", input: {} },
  }),
].join("");

const delta = (partial_json: string) =>
  ev({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json } });

const END = (stop_reason: string) =>
  [
    ev({ type: "content_block_stop", index: 0 }),
    ev({ type: "message_delta", delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 99 } }),
    ev({ type: "message_stop" }),
  ].join("");

/** A client whose single response body the test writes to by hand. */
function controlledClient() {
  const enc = new TextEncoder();
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const attempts: string[] = [];
  const fetchImpl = async (_url: unknown, init?: RequestInit) => {
    attempts.push(String(init?.body ?? ""));
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c;
      },
    });
    // Behave like real fetch: an abort errors the body being read.
    init?.signal?.addEventListener("abort", () => {
      try {
        ctrl.error(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
      } catch {
        /* already closed */
      }
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const client = new Anthropic({
    apiKey: "test-key",
    fetch: fetchImpl as unknown as typeof fetch,
  });
  return {
    client,
    attempts,
    send: (s: string) => ctrl.enqueue(enc.encode(s)),
    close: () => ctrl.close(),
  };
}

const flush = () => new Promise((r) => setImmediate(r));

afterEach(() => {
  vi.useRealTimers();
});

describe("generateQuestions on the real SDK stream (#221)", () => {
  it("reports written counts while the reply is still streaming", async () => {
    const c = controlledClient();
    const written: number[] = [];
    const run = generateQuestions({ topic: "Pixar", client: c.client, onWritten: (n) => written.push(n) });
    let settled = false;
    void run.then(() => (settled = true), () => (settled = true));

    await vi.waitFor(() => expect(c.attempts.length).toBe(1));
    const full = JSON.stringify({ questions: [Q(1), Q(2), Q(3)] });
    const cut = full.indexOf(JSON.stringify(Q(3))) + 12; // part-way into question 3
    c.send(START);
    c.send(delta(full.slice(0, cut)));
    await vi.waitFor(() => expect(written).toEqual([2]));
    expect(settled).toBe(false); // ticks arrived mid-stream, not at the end

    c.send(delta(full.slice(cut)) + END("tool_use"));
    c.close();
    const out = await run;
    expect(out).toHaveLength(3);
    expect(written).toEqual([2, 3]);
  });

  it("drops the possibly cut-off last question on stop_reason max_tokens", async () => {
    const c = controlledClient();
    const run = generateQuestions({ topic: "Pixar", client: c.client });
    await vi.waitFor(() => expect(c.attempts.length).toBe(1));
    c.send(START + delta(JSON.stringify({ questions: [Q(1), Q(2), Q(3)] })) + END("max_tokens"));
    c.close();
    const out = await run;
    expect(out.map((q) => q.prompt)).toEqual([Q(1).prompt, Q(2).prompt]);
  });

  it("aborts after 60 s of silence (idle guard) and does not retry", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const c = controlledClient();
    const run = generateQuestions({ topic: "Pixar", client: c.client });
    const outcome = run.then(
      () => "resolved",
      (e: Error) => e.message,
    );

    // Headers arrive, one event, then the server goes quiet.
    for (let i = 0; i < 20 && c.attempts.length === 0; i++) await flush();
    expect(c.attempts.length).toBe(1);
    c.send(START);
    for (let i = 0; i < 10; i++) await flush();

    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 1);
    let done = false;
    void outcome.then(() => (done = true));
    for (let i = 0; i < 10; i++) await flush();
    expect(done).toBe(false); // 59.999 s of silence: still waiting

    await vi.advanceTimersByTimeAsync(1);
    for (let i = 0; i < 20 && !done; i++) await flush();
    expect(await outcome).toBe(
      `Request timed out: no stream data for ${DEFAULT_TIMEOUT_MS}ms (idle timeout)`,
    );
    expect(c.attempts.length).toBe(1); // an aborted stream is never retried
  });

  it("tries a failing request twice in total (maxRetries 1)", async () => {
    let calls = 0;
    const client = new Anthropic({
      apiKey: "test-key",
      fetch: (async () => {
        calls++;
        return new Response(
          JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "busy" } }),
          { status: 529, headers: { "content-type": "application/json", "retry-after-ms": "1" } },
        );
      }) as unknown as typeof fetch,
    });
    await expect(generateQuestions({ topic: "Pixar", client })).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
