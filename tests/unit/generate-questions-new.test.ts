// @vitest-environment node
//
// The NEW question writer (engine "new"), driven through the REAL SDK stream:
// a real Anthropic client whose injected `fetch` answers with a canned
// server-sent-event body. No network, no key, no cost.

import { describe, it, expect, vi, afterEach } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";

import {
  generateQuestionsNew,
  countCompleteNewQuestions,
  NEW_WRITER_IDLE_MS,
  NEW_WRITER_MAX_TOKENS,
  NEW_WRITER_MIN_START_MS,
  NEW_WRITER_MODEL,
  NEW_WRITER_STOP_AFTER_MS,
} from "@/lib/ai/generate-questions-new";
import { collectVerifiedQuestions } from "@/lib/ai/collect-verified-questions";
import type { GenerateQuestionsRejectedCandidate } from "@/lib/ai/generate-questions";

const NOW = new Date("2026-10-21T18:00:00Z"); // Wed Oct 21, 1pm in Texas

const Q = (n: number, overrides: Record<string, unknown> = {}) => ({
  question: `Which U.S. city hosts test question number ${n} of this batch?`,
  rightAnswer: `Right ${n}`,
  wrongAnswer1: `Wrong A${n}`,
  wrongAnswer2: `Wrong B${n}`,
  wrongAnswer3: `Wrong C${n}`,
  difficulty: (n % 7) + 1,
  factNote: `Test fact note for question ${n}, long enough to pass.`,
  photoWords: "city skyline dusk",
  ...overrides,
});

function ev(e: Record<string, unknown>): string {
  return `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`;
}

/** A Sonnet 5.5 style reply: an (empty, omitted) thinking block, then the
 *  structured-output JSON as text deltas. */
function replySse(text: string, stopReason = "end_turn"): string {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 60) chunks.push(text.slice(i, i + 60));
  return [
    ev({
      type: "message_start",
      message: {
        id: "msg_new",
        type: "message",
        role: "assistant",
        model: NEW_WRITER_MODEL,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: 1 },
      },
    }),
    ev({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }),
    ev({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } }),
    ev({ type: "content_block_stop", index: 0 }),
    ev({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }),
    ...chunks.map((c) =>
      ev({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: c } }),
    ),
    ev({ type: "content_block_stop", index: 1 }),
    ev({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 4200 } }),
    ev({ type: "message_stop" }),
  ].join("");
}

function clientReplying(...bodies: string[]) {
  const sent: Array<Record<string, unknown>> = [];
  let call = 0;
  const fetchFn = async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const body = bodies[Math.min(call++, bodies.length - 1)]!;
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const client = new Anthropic({ apiKey: "test-key", fetch: fetchFn as unknown as typeof fetch });
  return { client, sent };
}

const batchJson = (qs: unknown[]) => JSON.stringify({ questions: qs });
const twenty = () => Array.from({ length: 20 }, (_, i) => Q(i + 1));

/** Deterministic randomness so the shuffle test cannot flake. */
function lcg(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("new writer · request", () => {
  it("asks Sonnet 5.5 at effort medium for structured output, 20,000 tokens, summarized thinking, no temperature or forced tool", async () => {
    const { client, sent } = clientReplying(replySse(batchJson(twenty())));
    await generateQuestionsNew({ topic: "Pixar movies", client, now: NOW });

    expect(sent).toHaveLength(1);
    const body = sent[0]!;
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.max_tokens).toBe(20_000);
    expect(NEW_WRITER_MAX_TOKENS).toBe(20_000);
    const oc = body.output_config as { effort: string; format: { type: string; schema: unknown } };
    expect(oc.effort).toBe("medium");
    expect(oc.format.type).toBe("json_schema");
    for (const key of ["temperature", "tools", "tool_choice", "top_p", "top_k"]) {
      expect(body, key).not.toHaveProperty(key);
    }
    // Adaptive thinking, shown as a summary so a long think keeps the stream alive.
    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    const user = (body.messages as Array<{ content: string }>)[0]!.content;
    expect(user).toContain("Today's date: Wednesday, October 21, 2026");
    expect(user).toContain("Topic: Pixar movies");
    expect(user).toContain("Write exactly 20 questions");
  });

  it("the schema has separate right and wrong answer fields and no limits the API refuses", async () => {
    const { client, sent } = clientReplying(replySse(batchJson(twenty())));
    await generateQuestionsNew({ topic: "Pixar movies", client, now: NOW });
    const schema = (sent[0]!.output_config as { format: { schema: unknown } }).format.schema;
    const text = JSON.stringify(schema);
    for (const f of ["question", "rightAnswer", "wrongAnswer1", "wrongAnswer2", "wrongAnswer3", "difficulty", "factNote", "photoWords"]) {
      expect(text).toContain(`"${f}"`);
    }
    for (const banned of ["minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems"]) {
      expect(text).not.toContain(banned);
    }
  });

  it("never asks for more than 20 in one call", async () => {
    const { client, sent } = clientReplying(replySse(batchJson(twenty())));
    await generateQuestionsNew({ topic: "Pixar movies", client, now: NOW, count: 30 });
    expect((sent[0]!.messages as Array<{ content: string }>)[0]!.content).toContain("Write exactly 20 questions");
  });
});

describe("new writer · today's date is worked out on every call", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("two calls on different days (no clock passed in) carry two different date lines", async () => {
    // Only Date is faked; the stream's own timers stay real.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { client, sent } = clientReplying(replySse(batchJson(twenty())));

    vi.setSystemTime(new Date("2027-01-15T18:00:00Z"));
    await generateQuestionsNew({ topic: "Cities", client });
    vi.setSystemTime(new Date("2027-03-02T18:00:00Z"));
    await generateQuestionsNew({ topic: "Cities", client });

    const dateLine = (i: number) =>
      (sent[i]!.messages as Array<{ content: string }>)[0]!.content.split("\n")[0];
    expect(dateLine(0)).toBe("Today's date: Friday, January 15, 2027");
    expect(dateLine(1)).toBe("Today's date: Tuesday, March 2, 2027");
    vi.restoreAllMocks();
  });
});

describe("new writer · output", () => {
  it("maps into Classic's storage shape and keeps the right answer marked after the shuffle", async () => {
    const { client } = clientReplying(replySse(batchJson(twenty())));
    const out = await generateQuestionsNew({ topic: "Cities", client, now: NOW, random: lcg() });

    expect(out).toHaveLength(20);
    out.forEach((q, i) => {
      expect(Object.keys(q).sort()).toEqual(
        ["correctIndex", "difficulty", "factBlurb", "options", "photoQuery", "prompt"],
      );
      expect(q.prompt).toBe(Q(i + 1).question);
      expect(q.options[q.correctIndex]).toBe(`Right ${i + 1}`);
      expect([...q.options].sort()).toEqual(
        [`Right ${i + 1}`, `Wrong A${i + 1}`, `Wrong B${i + 1}`, `Wrong C${i + 1}`].sort(),
      );
      expect(q.factBlurb).toBe(Q(i + 1).factNote);
      expect(q.photoQuery).toBe("city skyline dusk");
    });
    // The code, not the model, decides the slot: all four slots get used.
    expect(new Set(out.map((q) => q.correctIndex)).size).toBe(4);
  });

  it("ticks the written count while the reply is still arriving", async () => {
    const { client } = clientReplying(replySse(batchJson(twenty())));
    const ticks: number[] = [];
    await generateQuestionsNew({ topic: "Cities", client, now: NOW, onWritten: (n) => ticks.push(n) });
    expect(ticks.length).toBeGreaterThan(5);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    expect(ticks.at(-1)).toBe(20);
    expect(countCompleteNewQuestions('{"questions":[{"question":"a"},{"quest')).toBe(1);
    expect(countCompleteNewQuestions("not json at all {{{")).toBe(0);
  });
});

describe("new writer · the 20 guard (never store fewer silently)", () => {
  it("a short batch returns only the usable questions, reports every drop, warns about the shortfall, and never pads", async () => {
    const qs = twenty();
    qs[2] = Q(3, { wrongAnswer1: "Right 3" }); // duplicate of the right answer
    qs[5] = Q(6, { question: "Short?" }); // under 8 characters
    qs[8] = Q(9, { factNote: "" }); // empty fact note
    qs[11] = Q(12, { difficulty: 9 }); // off the 1..7 scale
    qs[14] = (({ photoWords: _drop, ...rest }) => rest)(Q(15)) as ReturnType<typeof Q>; // missing field
    qs[17] = Q(18, { rightAnswer: "" }); // empty right answer
    const { client } = clientReplying(replySse(batchJson(qs)));
    const rejected: GenerateQuestionsRejectedCandidate[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const out = await generateQuestionsNew({
      topic: "Cities",
      client,
      now: NOW,
      onRejectedCandidate: (c) => rejected.push(c),
    });

    expect(out).toHaveLength(14);
    expect(rejected.map((r) => r.index)).toEqual([2, 5, 8, 11, 14, 17]);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("SHORT BATCH: 14 of 20"))).toBe(true);
    warn.mockRestore();
  });

  it("a reply cut off at the output limit drops the unfinished last question and reports it", async () => {
    const full = batchJson(twenty());
    // Cut in the middle of question 19's fact note.
    const cutAt = full.indexOf("Test fact note for question 19") + 12;
    const { client } = clientReplying(replySse(full.slice(0, cutAt), "max_tokens"));
    const rejected: GenerateQuestionsRejectedCandidate[] = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const out = await generateQuestionsNew({
      topic: "Cities",
      client,
      now: NOW,
      onRejectedCandidate: (c) => rejected.push(c),
    });

    expect(out).toHaveLength(18);
    expect(out.every((q) => !q.factBlurb.endsWith("question 1"))).toBe(true);
    expect(rejected).toEqual([
      expect.objectContaining({ index: 18, issues: ["cut off at the output limit"] }),
    ]);
    vi.restoreAllMocks();
  });

  it("a reply cut off before any question finished names the output limit, not missing text", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Thinking ate the whole limit: no text block at all.
    const thinkingOnly = clientReplying(replySse("", "max_tokens"));
    await expect(
      generateQuestionsNew({ topic: "x", client: thinkingOnly.client, now: NOW }),
    ).rejects.toThrow(`hit the ${NEW_WRITER_MAX_TOKENS}-token output limit before any question finished`);

    // Thinking ate most of it: the first question was still open at the cut.
    const firstOpen = clientReplying(replySse(batchJson(twenty()).slice(0, 80), "max_tokens"));
    const err = await generateQuestionsNew({ topic: "x", client: firstOpen.client, now: NOW }).catch((e: Error) => e);
    expect(String(err)).toMatch(/output limit before any question finished/);
    expect(String(err)).not.toMatch(/no question text|not valid JSON/);
    vi.restoreAllMocks();
  });

  it("broken JSON, a refusal, or zero usable questions fail loudly instead of storing nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = clientReplying(replySse('{"questions": [ {"question": "oops"'));
    await expect(generateQuestionsNew({ topic: "x", client: broken.client, now: NOW })).rejects.toThrow(/not valid JSON/);

    const refusal = clientReplying(replySse("", "refusal"));
    await expect(generateQuestionsNew({ topic: "x", client: refusal.client, now: NOW })).rejects.toThrow(/declined/);

    const allBad = clientReplying(replySse(batchJson([Q(1, { question: "?" }), Q(2, { question: "?" })])));
    await expect(generateQuestionsNew({ topic: "x", client: allBad.client, now: NOW })).rejects.toThrow(/0 of 20/);
    vi.restoreAllMocks();
  });

  it("a short batch goes down the existing refill path: the next round asks for the gap and the build reaches 20", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = twenty().slice(0, 17);
    const refill = Array.from({ length: 4 }, (_, i) => Q(100 + i));
    const { client, sent } = clientReplying(replySse(batchJson(first)), replySse(batchJson(refill)));

    const result = await collectVerifiedQuestions({
      target: 20,
      maxRounds: 4,
      verifyPasses: 2,
      // Same count rule the route uses for every writer.
      generate: (avoid, need) =>
        generateQuestionsNew({ topic: "Cities", client, now: NOW, count: Math.min(20, need + 1), avoidPrompts: avoid }),
      verify: async (qs) =>
        qs.map((_, index) => ({
          index,
          markedAnswerIsCorrect: true,
          ambiguous: false,
          answerableWithoutImage: true,
          fitsRequestedTopic: true,
          factBlurbIsCorrect: true,
          basis: "test",
          derivedCorrectIndex: 0,
        })) as never,
    });

    expect(result).toHaveLength(20);
    expect(sent).toHaveLength(2);
    expect((sent[1]!.messages as Array<{ content: string }>)[0]!.content).toContain("Write exactly 4 questions");
    vi.restoreAllMocks();
  });
});

/** A client whose single response body the test writes to by hand, so the
 *  test controls the gaps between events (same pattern as Classic's
 *  generate-questions-sdk-stream.test.ts). */
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
  const client = new Anthropic({ apiKey: "test-key", fetch: fetchImpl as unknown as typeof fetch });
  return {
    client,
    attempts,
    send: (s: string) => ctrl.enqueue(enc.encode(s)),
    close: () => ctrl.close(),
  };
}

const flush = () => new Promise((r) => setImmediate(r));
const flushMany = async (n = 20) => {
  for (let i = 0; i < n; i++) await flush();
};

const THINK_START = [
  ev({
    type: "message_start",
    message: {
      id: "msg_idle",
      type: "message",
      role: "assistant",
      model: NEW_WRITER_MODEL,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 900, output_tokens: 1 },
    },
  }),
  ev({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }),
].join("");
const thinkingUpdate = (t: string) =>
  ev({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: t } });
/** Everything after the thinking: close it, then the 20 questions as text. */
const ANSWER_AND_END = replySse(batchJson(twenty())).split(
  ev({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } }),
)[1]!;

describe("new writer · idle guard (long thinking vs a dead stream)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function startRun(c: ReturnType<typeof controlledClient>) {
    const run = generateQuestionsNew({ topic: "Cities", client: c.client, now: NOW });
    let settled = false;
    const outcome = run.then(
      (qs) => {
        settled = true;
        return qs.length;
      },
      (e: Error) => {
        settled = true;
        return e.message;
      },
    );
    for (let i = 0; i < 20 && c.attempts.length === 0; i++) await flush();
    expect(c.attempts.length).toBe(1);
    return { outcome, isSettled: () => settled };
  }

  it("the quiet window is wider than Classic's 60s and fits inside the route's 300s", () => {
    expect(NEW_WRITER_IDLE_MS).toBeGreaterThanOrEqual(90_000);
    expect(NEW_WRITER_IDLE_MS).toBeLessThanOrEqual(150_000);
  });

  it("a 4-minute think that keeps sending summary updates is never cut off", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const c = controlledClient();
    const { outcome, isSettled } = await startRun(c);
    c.send(THINK_START);
    await flushMany();
    // 240s in total, far past any idle window, but an update every 55s.
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(55_000);
      c.send(thinkingUpdate(`still weighing city ${i}`));
      await flushMany();
      expect(isSettled()).toBe(false);
    }
    c.send(ANSWER_AND_END);
    c.close();
    expect(await outcome).toBe(20);
    vi.restoreAllMocks();
  });

  it("a 100s stretch with nothing shown (Classic's 60s guard would kill it) still finishes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const c = controlledClient();
    const { outcome, isSettled } = await startRun(c);
    c.send(THINK_START);
    await flushMany();
    await vi.advanceTimersByTimeAsync(100_000);
    await flushMany();
    expect(isSettled()).toBe(false);
    c.send(ANSWER_AND_END);
    c.close();
    expect(await outcome).toBe(20);
    vi.restoreAllMocks();
  });

  it("a stream that stays silent for the whole window is aborted as an idle timeout, not retried", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const c = controlledClient();
    const { outcome, isSettled } = await startRun(c);
    c.send(THINK_START);
    await flushMany();

    await vi.advanceTimersByTimeAsync(NEW_WRITER_IDLE_MS - 1);
    await flushMany();
    expect(isSettled()).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    for (let i = 0; i < 40 && !isSettled(); i++) await flush();
    expect(isSettled()).toBe(true);
    expect(await outcome).toBe(
      `Request timed out: no stream data for ${NEW_WRITER_IDLE_MS}ms (idle timeout)`,
    );
    expect(c.attempts.length).toBe(1);
    vi.restoreAllMocks();
  });
});

/** `n` finished questions as a reply still in progress (array left open). */
const openBatch = (n: number) =>
  `{"questions":[${Array.from({ length: n }, (_, i) => JSON.stringify(Q(i + 1))).join(",")},{"question":"Unfinished`;
const textStart = ev({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
const textDelta = (t: string) =>
  ev({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: t } });
const thinkDone = [
  ev({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } }),
  ev({ type: "content_block_stop", index: 0 }),
].join("");

/** Keeps the stream alive (a tiny update every 30s, inside the unfinished
 *  question's text) until the time cap, so only the cap can stop it. */
async function runToCap(c: ReturnType<typeof controlledClient>) {
  for (let t = 0; t < NEW_WRITER_STOP_AFTER_MS; t += 30_000) {
    await vi.advanceTimersByTimeAsync(30_000);
    try {
      c.send(textDelta(" "));
    } catch {
      /* stream already stopped at the cap */
    }
    await flushMany();
  }
}

describe("new writer · total time cap (a safety net under the route's 800s)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("the cap leaves room for both checker passes before New's photos stop, under the 800s wall, and the route hands the writer its start time", () => {
    const route = readFileSync("app/api/categories/[id]/generate/route.ts", "utf8");
    const ms = (name: string) =>
      Number(new RegExp(`const ${name} = ([\\d_]+);`).exec(route)![1]!.replace(/_/g, ""));
    const wallMs = Number(/export const maxDuration = (\d+);/.exec(route)![1]) * 1000;
    expect(wallMs).toBe(800_000);
    const newPhotoStop = ms("NEW_PHOTO_STOP_AFTER_MS");
    // Checker passes run side by side: 60s wait for the first byte + ~20s answer.
    const checkerWorstMs = 60_000 + 20_000;
    expect(NEW_WRITER_STOP_AFTER_MS + checkerWorstMs).toBeLessThanOrEqual(newPhotoStop);
    expect(newPhotoStop + 30_000).toBeLessThanOrEqual(wallMs);
    // A safety net, not a tight cap: room for two maxed-out 20,000-token
    // rounds (~200s each at ~100 tokens/s) plus their checks.
    expect(NEW_WRITER_STOP_AFTER_MS).toBeGreaterThanOrEqual(2 * (200_000 + 80_000));
    expect(route).toContain("generateQuestionsNew({ ...o, startedAtMs: args.startedAtMs })");
    expect(route).toContain("photoStopAfterMs: NEW_PHOTO_STOP_AFTER_MS,");
  });

  it("a think that never ends is stopped at the cap, counted from the request start, and pauses instead of hanging", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const c = controlledClient();
    // The request began 30s before this writing round.
    const run = generateQuestionsNew({
      topic: "Cities",
      client: c.client,
      now: NOW,
      startedAtMs: Date.now() - 30_000,
    });
    let settled = false;
    const outcome = run.then(
      (qs) => ((settled = true), qs.length),
      (e: Error) => ((settled = true), e.message),
    );
    for (let i = 0; i < 20 && c.attempts.length === 0; i++) await flush();
    c.send(THINK_START);
    await flushMany();
    // Updates every 30s keep the quiet-spell guard happy forever.
    for (let t = 0; t < NEW_WRITER_STOP_AFTER_MS - 30_000 - 30_000; t += 30_000) {
      await vi.advanceTimersByTimeAsync(30_000);
      c.send(thinkingUpdate(`still thinking ${t}`));
      await flushMany();
      expect(settled).toBe(false);
    }
    await vi.advanceTimersByTimeAsync(30_000);
    for (let i = 0; i < 40 && !settled; i++) await flush();
    expect(settled).toBe(true);
    expect(await outcome).toBe(
      `generateQuestionsNew: hit the ${NEW_WRITER_STOP_AFTER_MS}ms time cap before any question finished`,
    );
    expect(c.attempts.length).toBe(1);
  });

  it("at the cap, finished questions are kept and the unfinished one is reported", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = controlledClient();
    const drops: GenerateQuestionsRejectedCandidate[] = [];
    const run = generateQuestionsNew({
      topic: "Cities",
      client: c.client,
      now: NOW,
      startedAtMs: Date.now(),
      onRejectedCandidate: (d) => drops.push(d),
    });
    const outcome = run.then((qs) => qs.length, (e: Error) => e.message);
    for (let i = 0; i < 20 && c.attempts.length === 0; i++) await flush();
    c.send(THINK_START + thinkDone + textStart + textDelta(openBatch(5)));
    await flushMany();
    await runToCap(c);
    expect(await outcome).toBe(5);
    expect(drops).toEqual([
      { index: 5, reason: "invalid_schema", issues: ["cut off at the time cap"] },
    ]);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/SHORT BATCH: 5 of 20 usable \(time cap hit\)/);
  });

  it("a refill round with no time left throws before any paid call", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const c = controlledClient();
    await expect(
      generateQuestionsNew({
        topic: "Cities",
        client: c.client,
        now: NOW,
        startedAtMs: Date.now() - (NEW_WRITER_STOP_AFTER_MS - NEW_WRITER_MIN_START_MS + 1_000),
      }),
    ).rejects.toThrow(/out of writing time/);
    expect(c.attempts.length).toBe(0);
  });

  it("through the collect loop: a capped round's questions are checked and saved, then the build pauses instead of storing a short deck", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = controlledClient();
    const startedAtMs = Date.now();
    const saved: number[] = [];
    const run = collectVerifiedQuestions({
      target: 20,
      maxRounds: 4,
      verifyPasses: 2,
      generate: (avoid, need) =>
        generateQuestionsNew({
          topic: "Cities",
          client: c.client,
          now: NOW,
          count: need,
          avoidPrompts: avoid,
          startedAtMs,
        }),
      verify: async (qs) =>
        qs.map((q, index) => ({
          index,
          markedAnswerIsCorrect: true,
          ambiguous: false,
          answerableWithoutImage: true,
          fitsRequestedTopic: true,
          factBlurbIsCorrect: true,
          basis: "test",
          derivedCorrectIndex: q.correctIndex,
        })),
      onAccepted: (qs) => {
        saved.push(qs.length);
      },
    });
    const outcome = run.then((qs) => qs.length, (e: Error) => e.message);
    for (let i = 0; i < 20 && c.attempts.length === 0; i++) await flush();
    c.send(THINK_START + thinkDone + textStart + textDelta(openBatch(5)));
    await flushMany();
    await runToCap(c);
    expect(await outcome).toMatch(/out of writing time/);
    expect(saved).toEqual([5]);
    expect(c.attempts.length).toBe(1);
  });
});
