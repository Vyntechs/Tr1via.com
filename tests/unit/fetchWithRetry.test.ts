// fetchJsonWithRetry — resilient GET for the server-route fallback. Retries a
// failed/slow fetch a bounded number of times with jittered backoff, each
// attempt bounded by its own timeout, and aborts cleanly on an external signal.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchJsonWithRetry, fetchWithRetry } from "@/lib/realtime/fetchWithRetry";

describe("fetchJsonWithRetry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("returns parsed JSON on a first-try success (no retries)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ hello: "world" }));
    const p = fetchJsonWithRetry("/api/x", { fetchImpl, rand: () => 0.5 });
    await expect(p).resolves.toEqual({ hello: "world" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries on a network error, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("dropped"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const p = fetchJsonWithRetry("/api/x", { attempts: 3, fetchImpl, rand: () => 0.5 });
    // Let the backoff between attempt 1 and 2 elapse.
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries on a non-OK HTTP status, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const p = fetchJsonWithRetry("/api/x", { attempts: 3, fetchImpl, rand: () => 0.5 });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting all attempts", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("always down"));
    const p = fetchJsonWithRetry("/api/x", { attempts: 3, fetchImpl, rand: () => 0.5 });
    const assertion = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("treats a per-attempt timeout as a failure and retries", async () => {
    const fetchImpl = vi
      .fn()
      // First attempt never resolves → should time out.
      .mockImplementationOnce(() => new Promise<Response>(() => {}))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const p = fetchJsonWithRetry("/api/x", {
      attempts: 3,
      perAttemptTimeoutMs: 5000,
      fetchImpl,
      rand: () => 0.5,
    });
    await vi.advanceTimersByTimeAsync(5001); // trip the timeout
    await vi.advanceTimersByTimeAsync(5000); // ride out the backoff
    await expect(p).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

// POST/mutation-safe resilient fetch: retries only transient network failures
// and per-attempt timeouts, returns the Response, and NEVER retries a completed
// HTTP response (so a create/generate mutation can't be double-applied).
describe("fetchWithRetry (mutation-safe)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("returns the Response on a first-try success (no retries)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }, 201));
    const res = await fetchWithRetry("/api/x", { method: "POST" }, { fetchImpl, rand: () => 0.5 });
    expect(res.status).toBe(201);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a network error, then returns the success Response", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("Load failed"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 202));
    const p = fetchWithRetry("/api/x", { method: "POST" }, { attempts: 3, fetchImpl, rand: () => 0.5 });
    await vi.advanceTimersByTimeAsync(5000);
    const res = await p;
    expect(res.status).toBe(202);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a completed HTTP response (even 500) — returns it as-is", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, 500));
    const res = await fetchWithRetry("/api/x", { method: "POST" }, { attempts: 3, fetchImpl, rand: () => 0.5 });
    expect(res.status).toBe(500);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("passes method/body/headers through to the fetch impl", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await fetchWithRetry(
      "/api/x",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{\"a\":1}" },
      { fetchImpl, rand: () => 0.5 },
    );
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{\"a\":1}");
  });

  it("rejects after exhausting attempts on a persistent network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("Load failed"));
    const p = fetchWithRetry("/api/x", { method: "POST" }, { attempts: 3, fetchImpl, rand: () => 0.5 });
    const assertion = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
