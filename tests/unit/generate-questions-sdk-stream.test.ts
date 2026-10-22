// @vitest-environment node
//
// The #221 stream behavior, proved through the REAL SDK MessageStream (not a
// hand-made fake): a real Anthropic client whose injected `fetch` returns a
// server-sent-event body this test feeds piece by piece. No network, no key.
//
//   * progress ticks arrive while the reply is still streaming
//   * the 60 s idle guard aborts a silent stream (fake timers), retried once
//   * stop_reason max_tokens drops the possibly cut-off last question
//   * a failing request is tried twice in total (maxRetries 1)
//   * a reply that breaks off after HTTP 200 (error event, idle abort, bad
//     JSON, dropped connection) gets one retry of our own; status errors and fatal types do not

import { describe, it, expect, vi, afterEach } from "vitest";
import Anthropic from "@anthropic-ai/sdk";

import {
  generateQuestions,
  DEFAULT_TIMEOUT_MS,
  STREAM_RETRY_CUTOFF_MS,
} from "@/lib/ai/generate-questions";

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

const ERROR_EVENT = (type: string) =>
  ev({ type: "error", error: { type, message: `mid-stream ${type}` } });

/** A client whose response bodies the test writes to by hand. Each request
 *  gets its own body; `send`/`close` act on the newest one. */
function controlledClient() {
  const enc = new TextEncoder();
  const ctrls: ReadableStreamDefaultController<Uint8Array>[] = [];
  const attempts: string[] = [];
  const fetchImpl = async (_url: unknown, init?: RequestInit) => {
    attempts.push(String(init?.body ?? ""));
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c;
      },
    });
    ctrls.push(ctrl);
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
    send: (s: string) => ctrls.at(-1)!.enqueue(enc.encode(s)),
    close: () => ctrls.at(-1)!.close(),
    fail: (e: unknown) => ctrls.at(-1)!.error(e),
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

  it("aborts after 60 s of silence (idle guard), retries once, then fails", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const c = controlledClient();
    const run = generateQuestions({ topic: "Pixar", client: c.client, retryDelayMs: 0 });
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
    // The idle abort is retried once: attempt 2 also goes quiet.
    for (let i = 0; i < 20 && c.attempts.length < 2; i++) await flush();
    expect(c.attempts.length).toBe(2);
    expect(done).toBe(false);
    c.send(START);
    for (let i = 0; i < 10; i++) await flush();
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
    for (let i = 0; i < 20 && !done; i++) await flush();
    expect(await outcome).toBe(
      `Request timed out: no stream data for ${DEFAULT_TIMEOUT_MS}ms (idle timeout)`,
    );
    expect(c.attempts.length).toBe(2); // one retry, never a third try
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

  it("retries once after a mid-stream overloaded_error and returns attempt 2's questions", async () => {
    const c = controlledClient();
    const usage: number[] = [];
    const run = generateQuestions({
      topic: "Pixar",
      client: c.client,
      retryDelayMs: 0,
      onUsage: (_m, u) => usage.push(u.output_tokens ?? -1),
    });
    await vi.waitFor(() => expect(c.attempts.length).toBe(1));
    c.send(START + ERROR_EVENT("overloaded_error"));
    c.close();

    await vi.waitFor(() => expect(c.attempts.length).toBe(2));
    c.send(START + delta(JSON.stringify({ questions: [Q(1), Q(2), Q(3)] })) + END("tool_use"));
    c.close();
    const out = await run;
    expect(out).toHaveLength(3);
    expect(c.attempts.length).toBe(2);
    expect(c.attempts[1]).toBe(c.attempts[0]); // same request body both times
    expect(usage).toEqual([99]); // only the successful attempt is reported
  });

  it("gives up after a second mid-stream overload (2 requests in total)", async () => {
    const c = controlledClient();
    const run = generateQuestions({ topic: "Pixar", client: c.client, retryDelayMs: 0 });
    const outcome = run.then(() => null, (e: unknown) => e);
    await vi.waitFor(() => expect(c.attempts.length).toBe(1));
    c.send(START + ERROR_EVENT("overloaded_error"));
    c.close();
    await vi.waitFor(() => expect(c.attempts.length).toBe(2));
    c.send(START + ERROR_EVENT("overloaded_error"));
    c.close();
    const err = await outcome;
    expect(err).toBeInstanceOf(Anthropic.APIError);
    expect((err as InstanceType<typeof Anthropic.APIError>).type).toBe("overloaded_error");
    expect(c.attempts.length).toBe(2);
  });

  it.each(["invalid_request_error", "authentication_error"])(
    "does not retry a mid-stream %s",
    async (type) => {
      const c = controlledClient();
      const run = generateQuestions({ topic: "Pixar", client: c.client, retryDelayMs: 0 });
      const outcome = run.then(() => null, (e: unknown) => e);
      await vi.waitFor(() => expect(c.attempts.length).toBe(1));
      c.send(START + ERROR_EVENT(type));
      c.close();
      const err = await outcome;
      expect((err as InstanceType<typeof Anthropic.APIError>).type).toBe(type);
      for (let i = 0; i < 10; i++) await flush();
      expect(c.attempts.length).toBe(1);
    },
  );

  it("adds no retry of its own to an HTTP 400 at connect", async () => {
    let calls = 0;
    const client = new Anthropic({
      apiKey: "test-key",
      fetch: (async () => {
        calls++;
        return new Response(
          JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch,
    });
    await expect(
      generateQuestions({ topic: "Pixar", client, retryDelayMs: 0 }),
    ).rejects.toBeInstanceOf(Anthropic.BadRequestError);
    expect(calls).toBe(1);
  });

  it("succeeds on attempt 2 after an idle timeout on attempt 1", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const c = controlledClient();
    const run = generateQuestions({ topic: "Pixar", client: c.client, retryDelayMs: 0 });
    const outcome = run.then((qs) => qs.length, (e: Error) => e.message);
    for (let i = 0; i < 20 && c.attempts.length === 0; i++) await flush();
    c.send(START);
    for (let i = 0; i < 10; i++) await flush();
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
    for (let i = 0; i < 20 && c.attempts.length < 2; i++) await flush();
    expect(c.attempts.length).toBe(2);
    c.send(START + delta(JSON.stringify({ questions: [Q(1), Q(2)] })) + END("tool_use"));
    c.close();
    expect(await outcome).toBe(2);
  });

  it("does not retry when the first attempt failed after the time cap", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const c = controlledClient();
    // Idle guard longer than the cap, so attempt 1 fails past it.
    const idleMs = STREAM_RETRY_CUTOFF_MS + 10_000;
    const run = generateQuestions({
      topic: "Pixar",
      client: c.client,
      timeoutMs: idleMs,
      retryDelayMs: 0,
    });
    let done = false;
    const outcome = run.then(
      () => "resolved",
      (e: Error) => e.message,
    );
    void outcome.then(() => (done = true));
    for (let i = 0; i < 20 && c.attempts.length === 0; i++) await flush();
    c.send(START);
    for (let i = 0; i < 10; i++) await flush();
    await vi.advanceTimersByTimeAsync(idleMs);
    for (let i = 0; i < 20 && !done; i++) await flush();
    expect(await outcome).toBe(
      `Request timed out: no stream data for ${idleMs}ms (idle timeout)`,
    );
    expect(c.attempts.length).toBe(1);
  });

  it("retries once after unparseable streamed tool JSON (SyntaxError)", async () => {
    const c = controlledClient();
    const run = generateQuestions({ topic: "Pixar", client: c.client, retryDelayMs: 0 });
    await vi.waitFor(() => expect(c.attempts.length).toBe(1));
    c.send(START + delta('{"questions":[1,,2'));
    await vi.waitFor(() => expect(c.attempts.length).toBe(2));
    c.send(START + delta(JSON.stringify({ questions: [Q(1)] })) + END("tool_use"));
    c.close();
    expect(await run).toHaveLength(1);
  });

  it("retries once when the connection drops mid-body (TypeError: terminated)", async () => {
    const c = controlledClient();
    const run = generateQuestions({ topic: "Pixar", client: c.client, retryDelayMs: 0 });
    await vi.waitFor(() => expect(c.attempts.length).toBe(1));
    c.send(START);
    for (let i = 0; i < 10; i++) await flush();
    c.fail(new TypeError("terminated"));
    await vi.waitFor(() => expect(c.attempts.length).toBe(2));
    c.send(START + delta(JSON.stringify({ questions: [Q(1), Q(2)] })) + END("tool_use"));
    c.close();
    expect(await run).toHaveLength(2);
    expect(c.attempts.length).toBe(2);
  });

  it("does not retry past the caller's retry deadline", async () => {
    const c = controlledClient();
    const run = generateQuestions({
      topic: "Pixar",
      client: c.client,
      retryDelayMs: 0,
      retryDeadlineMs: Date.now() - 1, // the build's retry window has closed
    });
    const outcome = run.then(() => null, (e: unknown) => e);
    await vi.waitFor(() => expect(c.attempts.length).toBe(1));
    c.send(START + ERROR_EVENT("overloaded_error"));
    c.close();
    const err = await outcome;
    expect((err as InstanceType<typeof Anthropic.APIError>).type).toBe("overloaded_error");
    for (let i = 0; i < 10; i++) await flush();
    expect(c.attempts.length).toBe(1);
  });

  it("still retries while the caller's retry deadline is ahead", async () => {
    const c = controlledClient();
    const run = generateQuestions({
      topic: "Pixar",
      client: c.client,
      retryDelayMs: 0,
      retryDeadlineMs: Date.now() + 60_000,
    });
    await vi.waitFor(() => expect(c.attempts.length).toBe(1));
    c.send(START + ERROR_EVENT("overloaded_error"));
    c.close();
    await vi.waitFor(() => expect(c.attempts.length).toBe(2));
    c.send(START + delta(JSON.stringify({ questions: [Q(1)] })) + END("tool_use"));
    c.close();
    expect(await run).toHaveLength(1);
  });

  it("leaves a connect-phase APIConnectionError to the SDK's one retry (no extra try)", async () => {
    let calls = 0;
    const client = new Anthropic({
      apiKey: "test-key",
      fetch: (async () => {
        calls++;
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    const err = await generateQuestions({ topic: "Pixar", client, retryDelayMs: 0 }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Anthropic.APIConnectionError);
    expect(calls).toBe(2); // the SDK's maxRetries 1, nothing from us
  });

  it("never lets the written count go backward across a retry", async () => {
    const c = controlledClient();
    const written: number[] = [];
    const run = generateQuestions({
      topic: "Pixar",
      client: c.client,
      retryDelayMs: 0,
      onWritten: (n) => written.push(n),
    });
    await vi.waitFor(() => expect(c.attempts.length).toBe(1));
    // Attempt 1 gets 3 questions in (2 counted), then the API overloads.
    const four = JSON.stringify({ questions: [Q(1), Q(2), Q(3), Q(4)] });
    const intoQ4 = four.indexOf(JSON.stringify(Q(4))) + 12;
    c.send(START + delta(four.slice(0, intoQ4)));
    await vi.waitFor(() => expect(written).toEqual([3]));
    c.send(ERROR_EVENT("overloaded_error"));
    c.close();

    // Attempt 2 starts from 0: its lower counts must not be reported.
    await vi.waitFor(() => expect(c.attempts.length).toBe(2));
    const intoQ2 = four.indexOf(JSON.stringify(Q(2))) + 12;
    c.send(START + delta(four.slice(0, intoQ2)));
    for (let i = 0; i < 10; i++) await flush();
    expect(written).toEqual([3]);
    c.send(delta(four.slice(intoQ2)) + END("tool_use"));
    c.close();
    expect(await run).toHaveLength(4);
    expect(written).toEqual([3, 4]);
  });
});
