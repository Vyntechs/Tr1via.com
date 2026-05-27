// Tests for the confirmedAt field added to useAnswerSubmit.
//
// confirmedAt is the timestamp (Date.now()) captured the moment the server
// confirms a lock — used by Task 15 to fire the lock-in ceremony only after
// the DB has the answer, not just after the tap.

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

describe("useAnswerSubmit confirmedAt", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("starts as null before any submit", () => {
    const { result } = renderHook(() =>
      useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3] }),
    );
    expect(result.current.confirmedAt).toBeNull();
  });

  it("becomes a timestamp (number) after a 200 response", async () => {
    const before = Date.now();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(200));
    const { result } = renderHook(() =>
      useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3] }),
    );
    act(() => {
      result.current.submit(2);
    });
    await waitFor(() => expect(result.current.confirmedAt).not.toBeNull());
    const after = Date.now();
    // Should be a finite number within the wall-clock window of the test.
    expect(typeof result.current.confirmedAt).toBe("number");
    expect(result.current.confirmedAt).toBeGreaterThanOrEqual(before);
    expect(result.current.confirmedAt).toBeLessThanOrEqual(after);
  });

  it("becomes a timestamp after a 409 (already answered = success-equivalent)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(409));
    const { result } = renderHook(() =>
      useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3] }),
    );
    act(() => {
      result.current.submit(1);
    });
    await waitFor(() => expect(result.current.confirmedAt).not.toBeNull());
    expect(typeof result.current.confirmedAt).toBe("number");
  });

  it("stays null when the server returns a terminal 4xx error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(400));
    const { result } = renderHook(() =>
      useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3], backoffMs: FAST_BACKOFF }),
    );
    act(() => {
      result.current.submit(1);
    });
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.confirmedAt).toBeNull();
  });

  it("stays null when all retries are exhausted (network errors)", async () => {
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
      result.current.submit(3);
    });
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.confirmedAt).toBeNull();
  });

  it("resets to null when the question changes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200));
    const { result, rerender } = renderHook(
      ({ questionId }: { questionId: string }) =>
        useAnswerSubmit({ questionId, scramble: [0, 1, 2, 3] }),
      { initialProps: { questionId: "q1" } },
    );
    // Confirm the first question.
    act(() => {
      result.current.submit(2);
    });
    await waitFor(() => expect(result.current.confirmedAt).not.toBeNull());

    // Now move to the next question.
    rerender({ questionId: "q2" });
    expect(result.current.confirmedAt).toBeNull();
  });
});
