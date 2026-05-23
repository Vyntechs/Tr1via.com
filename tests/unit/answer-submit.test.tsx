// useAnswerSubmit — optimistic POST /api/answers with exponential backoff
// retry on transient failures (5xx, network), no retry on 4xx (other than
// 409 which is "already answered" success-equivalent).
//
// Real-timer mode with `backoffMs: [0, 0, 0]` so the retry path runs at
// microtask speed in tests — pinning the schedule is exercised in the
// runtime behavior, not the test (waitFor would flake on actual sleeps).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAnswerSubmit } from "@/lib/hooks/useAnswerSubmit";

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
});
