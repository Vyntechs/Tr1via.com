// useAnswerSubmit — the player's choice is held the instant they tap, the send
// reports "Sending" → "Locked in" from its own reply, and a bad network keeps
// retrying until the question closes.
//
// Fake timers throughout, so the 6 s "didn't go through" limit and the retry
// pauses are exercised exactly, not guessed at.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAnswerSubmit, loadPendingAnswer } from "@/lib/hooks/useAnswerSubmit";

function reply(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
    json: async () => body ?? {},
  } as Response;
}

interface Call {
  signal: AbortSignal | undefined;
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
}

/** A fetch whose every request stays open until the test answers it. */
function openFetch() {
  const calls: Call[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(
    (_input, init) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal ?? undefined;
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        calls.push({ signal, resolve, reject });
      }),
  );
  return { calls, spy };
}

const OPTS = { questionId: "q1", scramble: [0, 1, 2, 3], backoffMs: [100], attemptTimeoutMs: 6000 };

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useAnswerSubmit — instant lock, sending, retrying", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the choice the moment of the tap, before the server has said anything", () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    expect(result.current.chosenSlot).toBeNull();

    act(() => result.current.submit(3));

    // Same frame as the tap: choice held, status pending, request already out,
    // nothing confirmed yet.
    expect(result.current.chosenSlot).toBe(3);
    expect(result.current.status).toBe("pending");
    expect(result.current.confirmedAt).toBeNull();
    expect(calls).toHaveLength(1);
    expect(loadPendingAnswer()).toEqual({ questionId: "q1", slotChosen: 3 });
  });

  it("is confirmed by the send reply itself (204), with no other fetch needed", async () => {
    const { calls, spy } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    act(() => result.current.submit(2));

    await act(async () => calls[0].resolve(reply(204)));

    expect(result.current.status).toBe("sent");
    expect(result.current.confirmedAt).not.toBeNull();
    expect(result.current.chosenSlot).toBe(2);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(loadPendingAnswer()).toBeNull();
  });

  it("does not call a 200 'deadline_passed' reply a lock-in", async () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    act(() => result.current.submit(2));

    await act(async () => calls[0].resolve(reply(200, { code: "deadline_passed" })));

    expect(result.current.status).toBe("failed");
    expect(result.current.failure).toBe("rejected");
    expect(result.current.confirmedAt).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("a 409 'already answered' is locked in, but a 409 'question is not live' is not", async () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    act(() => result.current.submit(2));
    await act(async () => calls[0].resolve(reply(409, { error: "already answered" })));
    expect(result.current.status).toBe("sent");

    const second = openFetch();
    const other = renderHook(() => useAnswerSubmit({ ...OPTS, questionId: "q9" }));
    act(() => other.result.current.submit(2));
    await act(async () => second.calls[0].resolve(reply(409, { error: "question is not live" })));
    expect(other.result.current.status).toBe("failed");
    expect(other.result.current.failure).toBe("rejected");
    expect(other.result.current.confirmedAt).toBeNull();
  });

  it("retries a 200 'retry_later' reply, and counts a 200 'confirmed' reply as locked in", async () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    act(() => result.current.submit(1));

    await act(async () => calls[0].resolve(reply(200, { code: "retry_later" })));
    expect(result.current.status).toBe("retrying");
    await advance(200);
    expect(calls).toHaveLength(2);

    await act(async () => calls[1].resolve(reply(200, { code: "confirmed", confirmedSlot: 1 })));
    expect(result.current.status).toBe("sent");
  });

  it("a 200 reply with an HTML page body is NOT a lock-in: stays unconfirmed and retries", async () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    act(() => result.current.submit(2));

    const html = {
      ok: true,
      status: 200,
      text: async () => "<html><body>Sign in to the venue Wi-Fi</body></html>",
    } as Response;
    await act(async () => calls[0].resolve(html));

    expect(result.current.status).toBe("retrying");
    expect(result.current.confirmedAt).toBeNull();
    expect(result.current.chosenSlot).toBe(2);
    await advance(200);
    expect(calls).toHaveLength(2); // it tries again

    // The answer may well have been saved: the next try says "already answered".
    await act(async () => calls[1].resolve(reply(409, { error: "already answered" })));
    expect(result.current.status).toBe("sent");
  });

  it("a 200 reply with an empty {} body (or no body, or no code) is NOT a lock-in", async () => {
    for (const body of [{}, undefined, { ok: true }, []] as unknown[]) {
      const { calls } = openFetch();
      const { result, unmount } = renderHook(() => useAnswerSubmit(OPTS));
      act(() => result.current.submit(1));
      await act(async () => calls[0].resolve(reply(200, body)));
      expect(result.current.status).toBe("retrying");
      expect(result.current.confirmedAt).toBeNull();
      unmount();
      vi.restoreAllMocks();
      window.localStorage.clear();
    }
  });

  it("a bare 409 (no body, unreadable body, or no reason) is NOT a lock-in", async () => {
    for (const make of [
      () => reply(409),
      () => reply(409, {}),
      () => reply(409, { error: "" }),
      () => ({ ok: false, status: 409, text: async () => "<html>conflict</html>" }) as Response,
    ]) {
      const { calls } = openFetch();
      const { result, unmount } = renderHook(() => useAnswerSubmit(OPTS));
      act(() => result.current.submit(3));
      await act(async () => calls[0].resolve(make()));
      expect(result.current.status).toBe("retrying");
      expect(result.current.confirmedAt).toBeNull();
      unmount();
      vi.restoreAllMocks();
      window.localStorage.clear();
    }
  });

  it("a lost reply, then 409 'already answered' on the retry, locks in (one answer saved)", async () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    act(() => result.current.submit(2));
    await act(async () => calls[0].reject(new TypeError("Failed to fetch")));
    expect(result.current.status).toBe("retrying");
    await advance(200);
    await act(async () => calls[1].resolve(reply(409, { error: "already answered" })));
    expect(result.current.status).toBe("sent");
    expect(result.current.confirmedAt).not.toBeNull();
  });

  it("a failed send says retrying, keeps the choice, then locks in when a retry lands", async () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    act(() => result.current.submit(4));

    await act(async () => calls[0].resolve(reply(503)));
    expect(result.current.status).toBe("retrying");
    expect(result.current.chosenSlot).toBe(4);
    expect(result.current.confirmedAt).toBeNull();

    await advance(200);
    expect(calls).toHaveLength(2);
    await act(async () => calls[1].resolve(reply(204)));

    expect(result.current.status).toBe("sent");
    expect(result.current.chosenSlot).toBe(4);
  });

  it("keeps retrying well past the old four-try limit while the question is open", async () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    act(() => result.current.submit(1));

    for (let i = 0; i < 8; i += 1) {
      await act(async () => calls[i].reject(new TypeError("Failed to fetch")));
      expect(result.current.status).toBe("retrying");
      await advance(200);
    }
    expect(calls).toHaveLength(9);
    await act(async () => calls[8].resolve(reply(204)));
    expect(result.current.status).toBe("sent");
  });

  it("treats a request with no reply after 6 s as 'didn't go through' and tries again alongside it", async () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    act(() => result.current.submit(2));

    await advance(5900);
    expect(result.current.status).toBe("pending");
    expect(calls).toHaveLength(1);

    await advance(200); // past 6 s
    expect(result.current.status).toBe("retrying");
    expect(result.current.chosenSlot).toBe(2);

    await advance(200);
    expect(calls).toHaveLength(2);
    // The slow one is not thrown away: on a bad connection it may still land.
    expect(calls[0].signal?.aborted).toBe(false);

    // ...and when it does, that is a lock-in and the spare request is dropped.
    await act(async () => calls[0].resolve(reply(204)));
    expect(result.current.status).toBe("sent");
    expect(calls[1].signal?.aborted).toBe(true);
  });

  it("never has more than three requests out at once", async () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    act(() => result.current.submit(2));

    await advance(6000 * 5);
    expect(calls.length).toBeGreaterThan(3);
    expect(calls.filter((c) => !c.signal?.aborted)).toHaveLength(3);
    expect(result.current.status).toBe("retrying");
  });

  it("question closes while the first send is out: waits for it, and locks in if it lands", async () => {
    const { calls } = openFetch();
    const { result, rerender } = renderHook(
      ({ accepting }: { accepting: boolean }) => useAnswerSubmit({ ...OPTS, accepting }),
      { initialProps: { accepting: true } },
    );
    act(() => result.current.submit(2));

    rerender({ accepting: false });
    expect(result.current.status).toBe("pending");

    await act(async () => calls[0].resolve(reply(204)));
    expect(result.current.status).toBe("sent");
  });

  it("question closes while the send is failing: stops, and says it was never confirmed", async () => {
    const { calls } = openFetch();
    const { result, rerender } = renderHook(
      ({ accepting }: { accepting: boolean }) => useAnswerSubmit({ ...OPTS, accepting }),
      { initialProps: { accepting: true } },
    );
    act(() => result.current.submit(2));
    await act(async () => calls[0].reject(new TypeError("Failed to fetch")));
    expect(result.current.status).toBe("retrying");

    // Window ends with nothing in flight (waiting out the pause): settled at once.
    rerender({ accepting: false });

    expect(result.current.status).toBe("failed");
    expect(result.current.failure).toBe("closed");
    expect(result.current.chosenSlot).toBe(2);
    expect(result.current.confirmedAt).toBeNull();
    await advance(5000);
    expect(calls).toHaveLength(1); // no more tries once closed
    expect(loadPendingAnswer()).toBeNull();
  });

  it("question closes while a send is quiet: it is called unconfirmed at the 6 s mark, not left spinning", async () => {
    const { calls } = openFetch();
    const { result, rerender } = renderHook(
      ({ accepting }: { accepting: boolean }) => useAnswerSubmit({ ...OPTS, accepting }),
      { initialProps: { accepting: true } },
    );
    act(() => result.current.submit(2));
    rerender({ accepting: false });
    expect(result.current.status).toBe("pending");

    await advance(6100);

    expect(result.current.status).toBe("failed");
    expect(result.current.failure).toBe("closed");
    expect(calls).toHaveLength(1);
  });

  it("a double tap sends one answer, the first one", () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));

    act(() => {
      result.current.submit(1);
      result.current.submit(3); // same frame, before React re-renders
    });
    act(() => result.current.submit(4)); // and later

    expect(calls).toHaveLength(1);
    expect(result.current.chosenSlot).toBe(1);
    expect(loadPendingAnswer()).toEqual({ questionId: "q1", slotChosen: 1 });
  });

  it("a refused answer (4xx) can be sent again with retry()", async () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    act(() => result.current.submit(2));
    await act(async () => calls[0].resolve(reply(403)));
    expect(result.current.status).toBe("failed");
    expect(result.current.failure).toBe("rejected");
    expect(result.current.chosenSlot).toBe(2);

    act(() => result.current.retry());
    expect(result.current.status).toBe("pending");
    await act(async () => calls[1].resolve(reply(204)));
    expect(result.current.status).toBe("sent");
  });

  it("after the server refuses an answer, a different answer can be picked and sent", async () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    act(() => result.current.submit(2));
    await act(async () => calls[0].resolve(reply(400, { error: "answer deadline passed" })));
    expect(result.current.status).toBe("failed");
    expect(result.current.failure).toBe("rejected");

    act(() => result.current.submit(4));
    expect(result.current.status).toBe("pending");
    expect(result.current.chosenSlot).toBe(4);
    expect(result.current.failure).toBeNull();
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body))).toMatchObject({ slotChosen: 4 });
    expect(loadPendingAnswer()).toEqual({ questionId: "q1", slotChosen: 4 });

    await act(async () => calls[1].resolve(reply(204)));
    expect(result.current.status).toBe("sent");
    expect(result.current.chosenSlot).toBe(4);
  });

  it("an old question's late reply cannot mark the next question locked in", async () => {
    const { calls } = openFetch();
    const { result, rerender } = renderHook(
      ({ questionId }: { questionId: string }) => useAnswerSubmit({ ...OPTS, questionId }),
      { initialProps: { questionId: "q1" } },
    );
    act(() => result.current.submit(2));

    rerender({ questionId: "q2" });
    expect(result.current.status).toBe("idle");
    expect(result.current.chosenSlot).toBeNull();
    expect(calls[0].signal?.aborted).toBe(true);

    // The old request answers anyway (or a retry timer fires): nothing happens.
    await act(async () => calls[0].resolve(reply(204)));
    await advance(10_000);
    expect(result.current.status).toBe("idle");
    expect(result.current.confirmedAt).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("stops resending once the signed snapshot already holds the answer", async () => {
    const { calls } = openFetch();
    const { result, rerender } = renderHook(
      ({ serverHasAnswer }: { serverHasAnswer: boolean }) => useAnswerSubmit({ ...OPTS, serverHasAnswer }),
      { initialProps: { serverHasAnswer: false } },
    );
    act(() => result.current.submit(2));
    await act(async () => calls[0].reject(new TypeError("Failed to fetch")));
    expect(result.current.status).toBe("retrying");

    rerender({ serverHasAnswer: true });
    await advance(10_000);

    expect(calls).toHaveLength(1);
    expect(loadPendingAnswer()).toBeNull();
    // Taps are ignored once the server has the answer.
    act(() => result.current.submit(4));
    expect(calls).toHaveLength(1);
  });

  // ── Round 2 ────────────────────────────────────────────────────────────

  /** First send goes quiet (6 s), the retry of the same slot is out too. */
  async function slowFirstSendThenRetry(result: { current: ReturnType<typeof useAnswerSubmit> }, slot: 1 | 2 | 3 | 4) {
    act(() => result.current.submit(slot));
    await advance(6000); // first request: no reply yet -> "retrying"
    await advance(200); // the retry's pause is over: a second request is out
  }

  it("slow slot 1, a refused retry, then slot 3: the late slot-1 reply cannot make card 3 say Locked in", async () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    await slowFirstSendThenRetry(result, 1);
    expect(calls).toHaveLength(2);

    await act(async () => calls[1].resolve(reply(403))); // a venue proxy refuses the retry
    expect(result.current.status).toBe("failed");
    expect(calls[0].signal?.aborted).toBe(true); // the refusal ends the old request too

    act(() => result.current.submit(3));
    expect(result.current.chosenSlot).toBe(3);
    expect(result.current.status).toBe("pending");
    expect(calls[0].signal?.aborted).toBe(true);

    // The slow slot-1 request finally answers. It is no longer ours: nothing changes.
    await act(async () => calls[0].resolve(reply(204)));
    expect(result.current.status).toBe("pending");
    expect(result.current.chosenSlot).toBe(3);
    expect(result.current.confirmedAt).toBeNull();

    // Only slot 3's own confirm locks in, on card 3.
    await act(async () => calls[2].resolve(reply(204)));
    expect(result.current.status).toBe("sent");
    expect(result.current.chosenSlot).toBe(3);
  });

  it("choosing a different card while a send is still out stops the old send", async () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    await slowFirstSendThenRetry(result, 1);
    await act(async () => calls[1].resolve(reply(400, { error: "bad" })));
    act(() => result.current.submit(4));
    expect(calls[0].signal?.aborted).toBe(true); // the old, still-quiet request
    expect(calls[2].signal?.aborted).toBe(false); // the new pick's own send
  });

  it("'Locked in' marks the card the server confirmed, even if that is not the one tapped", async () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    act(() => result.current.submit(2));
    await act(async () => calls[0].resolve(reply(200, { code: "confirmed", confirmedSlot: 4 })));
    expect(result.current.status).toBe("sent");
    expect(result.current.chosenSlot).toBe(4);
  });

  it("a bare 'already answered' after two different cards were sent marks no card until the saved row says which", async () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    act(() => result.current.submit(1));
    await act(async () => calls[0].resolve(reply(403)));
    act(() => result.current.submit(3));
    await act(async () => calls[1].resolve(reply(409, { error: "already answered" })));
    expect(result.current.status).toBe("sent");
    expect(result.current.chosenSlot).toBeNull();
  });

  it("a bare 'already answered' for the only card ever sent keeps that card", async () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    act(() => result.current.submit(2));
    await act(async () => calls[0].reject(new TypeError("Failed to fetch"))); // reply lost after the server saved
    await advance(200);
    await act(async () => calls[1].resolve(reply(409, { error: "already answered" })));
    expect(result.current.status).toBe("sent");
    expect(result.current.chosenSlot).toBe(2);
  });

  for (const code of [408, 425, 429]) {
    it(`a ${code} reply retries like a dropped connection (never "Try again" after one send)`, async () => {
      const { calls } = openFetch();
      const { result } = renderHook(() => useAnswerSubmit(OPTS));
      act(() => result.current.submit(2));
      await act(async () => calls[0].resolve(reply(code)));
      expect(result.current.status).toBe("retrying");
      expect(result.current.failure).toBeNull();
      await advance(200);
      expect(calls).toHaveLength(2);
      await act(async () => calls[1].resolve(reply(204)));
      expect(result.current.status).toBe("sent");
    });
  }

  it("other 4xx replies (400, 401, 403, 404) are still final", async () => {
    for (const code of [400, 401, 403, 404]) {
      window.localStorage.clear();
      const { calls } = openFetch();
      const { result, unmount } = renderHook(() => useAnswerSubmit({ ...OPTS, questionId: `q-${code}` }));
      act(() => result.current.submit(2));
      await act(async () => calls[0].resolve(reply(code)));
      expect(result.current.status).toBe("failed");
      expect(result.current.failure).toBe("rejected");
      unmount();
      vi.restoreAllMocks();
    }
  });

  it("a refusal stays a refusal: a lingering request going quiet later does not flip it back to retrying", async () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    await slowFirstSendThenRetry(result, 2);
    expect(calls).toHaveLength(2);

    // The OLD request is refused while the newer one is still out.
    await act(async () => calls[0].resolve(reply(403)));
    expect(result.current.status).toBe("failed");
    expect(result.current.failure).toBe("rejected");

    await advance(20_000); // long enough for any quiet timer / backoff to fire
    expect(result.current.status).toBe("failed");
    expect(result.current.failure).toBe("rejected");
    expect(calls).toHaveLength(2); // the refused answer was not sent again
    expect(calls[1].signal?.aborted).toBe(true);
  });

  it("after a refusal the player can still send again, and that send works normally", async () => {
    const { calls } = openFetch();
    const { result } = renderHook(() => useAnswerSubmit(OPTS));
    await slowFirstSendThenRetry(result, 2);
    await act(async () => calls[0].resolve(reply(403)));
    act(() => result.current.retry());
    expect(result.current.status).toBe("pending");
    expect(calls).toHaveLength(3);
    await act(async () => calls[2].resolve(reply(204)));
    expect(result.current.status).toBe("sent");
    expect(result.current.chosenSlot).toBe(2);
  });
});
