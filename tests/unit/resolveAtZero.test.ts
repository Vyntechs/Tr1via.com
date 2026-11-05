// The timer-zero ladder, driven on a fake clock: the real function, a fake
// server. `random` is pinned so each wait lands on a known number.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAtZero } from "@/lib/game/resolveAtZero";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function server(replies: Array<Response | "drop" | "hang">) {
  return vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    const next = replies.shift();
    if (next === undefined) throw new Error("the ladder sent more than the test allowed");
    if (next === "drop") return Promise.reject(new TypeError("Failed to fetch"));
    if (next === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    return Promise.resolve(next);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("resolveAtZero", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the caller and stops after one good reply", async () => {
    const fetchImpl = server([json(200, { resolvedAt: "x" })]);
    const onSettled = vi.fn();
    resolveAtZero({ questionId: "q1", caller: "phone", onSettled, fetchImpl });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/questions/q1/resolve",
      expect.objectContaining({
        method: "POST",
        headers: { "x-tr1via-close-caller": "phone" },
      }),
    );
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("waits out retryInMs plus 100-300ms after 'window still open'", async () => {
    const fetchImpl = server([
      json(409, { error: "question answer window is still open", retryInMs: 400 }),
      json(200, {}),
    ]);
    const onSettled = vi.fn();
    resolveAtZero({ questionId: "q1", caller: "phone", onSettled, fetchImpl, random: () => 0.5 });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(599); // 400 + 100 + 0.5 * 200 = 600
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onSettled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("always waits past the window, even at both ends of the spread", async () => {
    for (const [random, wait] of [[0, 300], [1, 500]] as const) {
      const fetchImpl = server([json(409, { error: "open", retryInMs: 200 }), json(200, {})]);
      resolveAtZero({ questionId: "q1", caller: "phone", fetchImpl, random: () => random });
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    }
  });

  it("does not count window waits against the send cap", async () => {
    const fetchImpl = server([
      json(409, { error: "open", retryInMs: 100 }),
      "drop",
      json(409, { error: "open", retryInMs: 100 }),
      "drop",
      json(409, { error: "open", retryInMs: 100 }),
      json(503, {}),
    ]);
    const onSettled = vi.fn();
    resolveAtZero({ questionId: "q1", caller: "phone", onSettled, fetchImpl, random: () => 0 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("gives up on a server that keeps saying not yet", async () => {
    const fetchImpl = server(
      Array.from({ length: 6 }, () => json(409, { error: "open", retryInMs: 100 })),
    );
    const onSettled = vi.fn();
    resolveAtZero({ questionId: "q1", caller: "tv", onSettled, fetchImpl, random: () => 0 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("retries a phone at 1-2s then 2.5-4s and stops at 3 sends", async () => {
    const fetchImpl = server(["drop", json(500, {}), "drop"]);
    const onSettled = vi.fn();
    resolveAtZero({ questionId: "q1", caller: "phone", onSettled, fetchImpl, random: () => 0.5 });
    await vi.advanceTimersByTimeAsync(1499);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3249); // 2500 + 0.5 * 1500 = 3250
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onSettled).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("lets the TV send a fourth time", async () => {
    const fetchImpl = server(["drop", "drop", "drop", "drop"]);
    const onSettled = vi.fn();
    resolveAtZero({ questionId: "q1", caller: "tv", onSettled, fetchImpl });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("counts 3 seconds of silence as a failed send", async () => {
    const fetchImpl = server(["hang", json(200, {})]);
    const onSettled = vi.fn();
    resolveAtZero({ questionId: "q1", caller: "phone", onSettled, fetchImpl, random: () => 0 });
    await vi.advanceTimersByTimeAsync(2999);
    expect(onSettled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1001); // 3s timeout, then the 1s wait
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a 409 with no retryInMs", () => json(409, { error: "question is not live" })],
    ["a nonsense retryInMs", () => json(409, { error: "open", retryInMs: 9_000_000 })],
    ["a 404", () => json(404, { error: "not found" })],
    ["a 409 with an unreadable body", () => new Response("<html>", { status: 409 })],
  ])("stops on %s", async (_name, reply) => {
    const fetchImpl = server([reply()]);
    const onSettled = vi.fn();
    resolveAtZero({ questionId: "q1", caller: "phone", onSettled, fetchImpl });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("cancel stops the ladder mid-wait without settling", async () => {
    const fetchImpl = server(["drop"]);
    const onSettled = vi.fn();
    const cancel = resolveAtZero({ questionId: "q1", caller: "phone", onSettled, fetchImpl });
    await vi.advanceTimersByTimeAsync(100);
    cancel();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("cancel aborts a send in flight without settling", async () => {
    const fetchImpl = server(["hang"]);
    const onSettled = vi.fn();
    const cancel = resolveAtZero({ questionId: "q1", caller: "phone", onSettled, fetchImpl });
    await vi.advanceTimersByTimeAsync(100);
    cancel();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onSettled).not.toHaveBeenCalled();
  });
});
