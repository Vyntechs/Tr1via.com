// useAnswerSubmit — optimistic POST /api/answers with exponential backoff
// retry on transient failures (5xx, network), no retry on 4xx (other than
// 409 which is "already answered" success-equivalent).
//
// Real-timer mode with `backoffMs: [0, 0, 0]` so the retry path runs at
// microtask speed in tests — pinning the schedule is exercised in the
// runtime behavior, not the test (waitFor would flake on actual sleeps).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  useAnswerSubmit,
  PENDING_ANSWER_KEY,
  loadPendingAnswer,
  clearPendingAnswer,
} from "@/lib/hooks/useAnswerSubmit";

function jsonResponse(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

const FAST_BACKOFF = [0, 0, 0];

describe("useAnswerSubmit", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("starts idle", () => {
    const { result } = renderHook(() =>
      useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3] }),
    );
    expect(result.current.status).toBe("idle");
  });

  it("transitions to 'sent' on a 200 response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(200));
    const { result } = renderHook(() =>
      useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3] }),
    );
    act(() => {
      result.current.submit(2);
    });
    await waitFor(() => expect(result.current.status).toBe("sent"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("submits with the signed same-origin cookie and no browser-held identity", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(200));
    const { result } = renderHook(() =>
      useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3] }),
    );

    act(() => {
      result.current.submit(2);
    });
    await waitFor(() => expect(result.current.status).toBe("sent"));

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("/api/answers");
    expect(init?.credentials).toBe("same-origin");

    const serializedRequest = JSON.stringify(init).toLowerCase();
    expect(serializedRequest).not.toContain("deviceid");
    expect(serializedRequest).not.toContain("playerid");
    expect(serializedRequest).not.toContain("x-tr1via-device");
  });

  it("treats 409 (already answered) as 'sent'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(409));
    const { result } = renderHook(() =>
      useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3] }),
    );
    act(() => {
      result.current.submit(1);
    });
    await waitFor(() => expect(result.current.status).toBe("sent"));
  });

  it("retries on 500 then succeeds", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(500))
      .mockResolvedValueOnce(jsonResponse(200));
    const { result } = renderHook(() =>
      useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3], backoffMs: FAST_BACKOFF }),
    );
    act(() => {
      result.current.submit(1);
    });
    await waitFor(() => expect(result.current.status).toBe("sent"));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on a 4xx (other than 409)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(400));
    const { result } = renderHook(() =>
      useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3], backoffMs: FAST_BACKOFF }),
    );
    act(() => {
      result.current.submit(1);
    });
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries on network errors then gives up after maxAttempts", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network down"));
    const { result } = renderHook(() =>
      useAnswerSubmit({
        questionId: "q1",
        scramble: [0, 1, 2, 3],
        maxAttempts: 3,
        backoffMs: FAST_BACKOFF,
      }),
    );
    act(() => {
      result.current.submit(1);
    });
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("retry() re-submits a failed attempt", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(400))
      .mockResolvedValueOnce(jsonResponse(200));
    const { result } = renderHook(() =>
      useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3], backoffMs: FAST_BACKOFF }),
    );
    act(() => {
      result.current.submit(1);
    });
    await waitFor(() => expect(result.current.status).toBe("failed"));
    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe("sent"));
  });

  // ─── Refresh-survives-the-answer (localStorage persistence) ───────────────

  it("persists pending submit to localStorage on tap, clears on sent", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => {
      // Right BEFORE the fetch resolves, the persisted entry should exist.
      expect(loadPendingAnswer()).toEqual({ questionId: "q1", slotChosen: 3 });
      return jsonResponse(200);
    });
    const { result } = renderHook(() =>
      useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3] }),
    );
    act(() => {
      result.current.submit(3);
    });
    await waitFor(() => expect(result.current.status).toBe("sent"));
    expect(loadPendingAnswer()).toBeNull();
  });

  it("auto-resumes a persisted submit on mount when questionId matches", async () => {
    window.localStorage.setItem(
      PENDING_ANSWER_KEY,
      JSON.stringify({ questionId: "q1", slotChosen: 4 }),
    );
    let capturedBody: unknown = null;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_input, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? "{}");
      return jsonResponse(409); // Server already had it — still treated as sent.
    });
    const { result } = renderHook(() =>
      useAnswerSubmit({ questionId: "q1", scramble: [2, 0, 3, 1] }),
    );
    await waitFor(() => expect(result.current.status).toBe("sent"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(capturedBody).toEqual({
      questionId: "q1",
      slotChosen: 4,
      scramble: [2, 0, 3, 1],
    });
    expect(loadPendingAnswer()).toBeNull();
  });

  it("clears stale localStorage entry when mounted on a different questionId", () => {
    window.localStorage.setItem(
      PENDING_ANSWER_KEY,
      JSON.stringify({ questionId: "q-old", slotChosen: 2 }),
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderHook(() =>
      useAnswerSubmit({ questionId: "q-new", scramble: [0, 1, 2, 3] }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(loadPendingAnswer()).toBeNull();
  });

  it("clears persisted entry on terminal 4xx so it doesn't fire on next mount", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(400));
    const { result } = renderHook(() =>
      useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3], backoffMs: FAST_BACKOFF }),
    );
    act(() => {
      result.current.submit(2);
    });
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(loadPendingAnswer()).toBeNull();
  });

  it("keeps persisted entry after retry exhaustion so a refresh can re-fire", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network down"));
    const { result } = renderHook(() =>
      useAnswerSubmit({
        questionId: "q1",
        scramble: [0, 1, 2, 3],
        maxAttempts: 2,
        backoffMs: FAST_BACKOFF,
      }),
    );
    act(() => {
      result.current.submit(1);
    });
    await waitFor(() => expect(result.current.status).toBe("failed"));
    // Network never came back; user can refresh and the next mount will retry.
    expect(loadPendingAnswer()).toEqual({ questionId: "q1", slotChosen: 1 });
  });

  it("loadPendingAnswer returns null for malformed entries", () => {
    window.localStorage.setItem(PENDING_ANSWER_KEY, "not-json");
    expect(loadPendingAnswer()).toBeNull();

    window.localStorage.setItem(
      PENDING_ANSWER_KEY,
      JSON.stringify({ questionId: "q1", slotChosen: 7 }), // out of 1..4 range
    );
    expect(loadPendingAnswer()).toBeNull();

    window.localStorage.setItem(
      PENDING_ANSWER_KEY,
      JSON.stringify({ slotChosen: 1 }), // missing questionId
    );
    expect(loadPendingAnswer()).toBeNull();

    clearPendingAnswer();
    expect(loadPendingAnswer()).toBeNull();
  });
});
