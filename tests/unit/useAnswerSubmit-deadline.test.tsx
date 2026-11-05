// The real useAnswerSubmit against a fake clock and a fake server: what the
// phone does in the last seconds, and what it may say about an answer it never
// heard back on. Math.random is pinned so the 500ms backoff is exactly 500.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  PENDING_ANSWER_KEY,
  loadPendingAnswer,
  useAnswerSubmit,
} from "@/lib/hooks/useAnswerSubmit";

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}
const TOO_LATE = { error: "answer deadline passed" };

interface Call {
  signal: AbortSignal | undefined;
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
}

function openFetch() {
  const calls: Call[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (_input, init) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal ?? undefined;
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        calls.push({ signal, resolve, reject });
      }),
  );
  return calls;
}

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

/** The hook with `leftMs` on the clock; `accepting` follows it as useTimer would. */
function setup(leftMs: number) {
  const deadline = Date.now() + leftMs;
  const getRemainingMs = () => Math.max(0, deadline - Date.now());
  const view = renderHook(
    ({ accepting, serverHasAnswer }: { accepting: boolean; serverHasAnswer: boolean }) =>
      useAnswerSubmit({
        questionId: "q1",
        scramble: [0, 1, 2, 3],
        accepting,
        serverHasAnswer,
        getRemainingMs,
      }),
    { initialProps: { accepting: true, serverHasAnswer: false } },
  );
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-04T20:00:00.000Z"));
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("resends that can beat the deadline", () => {
  it("with plenty of time, waits the full 6s and resends after the 500ms backoff", async () => {
    const calls = openFetch();
    const { result } = setup(24_000);
    act(() => result.current.submit(1));
    await advance(5999);
    expect(result.current.status).toBe("pending");
    await advance(1);
    expect(result.current.status).toBe("retrying");
    await advance(499);
    expect(calls).toHaveLength(1);
    await advance(1);
    expect(calls).toHaveLength(2);
  });

  it("with 5s left, resends so the request leaves a full second before zero", async () => {
    const calls = openFetch();
    const { result } = setup(5000);
    act(() => result.current.submit(1));
    await advance(3999); // quiet at 3500, plus the 500 backoff
    expect(calls).toHaveLength(1);
    await advance(1);
    expect(calls).toHaveLength(2);
  });

  it("never goes below the 1.5s floor", async () => {
    const calls = openFetch();
    const { result } = setup(3000);
    act(() => result.current.submit(1));
    await advance(1999);
    expect(calls).toHaveLength(1);
    await advance(1);
    expect(calls).toHaveLength(2);
  });

  it("a second quiet resend also takes the first backoff step, not the second", async () => {
    const calls = openFetch();
    const { result } = setup(11_000);
    act(() => result.current.submit(1));
    await advance(6500); // left: 4500. Send 2 goes, quiet in 3000.
    expect(calls).toHaveLength(2);
    await advance(3499);
    expect(calls).toHaveLength(2);
    await advance(1); // 3000 quiet + 500 backoff: a full second before zero
    expect(calls).toHaveLength(3);
  });

  it("no quiet resend goes out once under 750ms would be left", async () => {
    const calls = openFetch();
    const { result } = setup(9000);
    act(() => result.current.submit(1));
    await advance(6500); // left: 2500. Send 2 goes, quiet in 1500.
    expect(calls).toHaveLength(2);
    await advance(2500); // at 1000 left the 500 backoff would leave 500
    expect(calls).toHaveLength(2);
  });

  it("sends with exactly 800ms left after the backoff, not with 700ms", async () => {
    const yes = openFetch();
    const first = setup(2800);
    act(() => first.result.current.submit(1));
    await advance(2000);
    expect(yes).toHaveLength(2);
    first.unmount();
    vi.restoreAllMocks();
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const no = openFetch();
    const second = setup(2700);
    act(() => second.result.current.submit(1));
    await advance(2700);
    expect(no).toHaveLength(1);
  });

  it("a send that fails outright keeps today's retry, however close to zero", async () => {
    const calls = openFetch();
    const { result } = setup(600);
    act(() => result.current.submit(1));
    await act(async () => calls[0].reject(new TypeError("Failed to fetch")));
    expect(result.current.status).toBe("retrying");
    await advance(500);
    expect(calls).toHaveLength(2);
  });

  it("a slow reply near zero does not change the words before the 6s mark", async () => {
    const calls = openFetch();
    const { result, rerender } = setup(4000);
    act(() => result.current.submit(1));
    await advance(3000); // the quiet resend has gone out
    expect(calls).toHaveLength(2);
    expect(result.current.status).toBe("pending");
    await advance(1000);
    rerender({ accepting: false, serverHasAnswer: false }); // zero, with sends still out
    expect(result.current.status).toBe("pending");
    await advance(1999);
    expect(result.current.status).toBe("pending");
    await advance(1);
    expect(result.current.status).toBe("failed");
    expect(result.current.failure).toBe("closed");
  });
});

describe("what the phone may say about a late answer", () => {
  it("says late only when the one send was refused and nothing else is out", async () => {
    const calls = openFetch();
    const { result } = setup(10_000);
    act(() => result.current.submit(2));
    await act(async () => calls[0].resolve(reply(400, TOO_LATE)));
    expect(result.current.status).toBe("failed");
    expect(result.current.failure).toBe("late");
    expect(result.current.chosenSlot).toBe(2);
    expect(loadPendingAnswer()).toBeNull();
  });

  it("treats 'question is closed' the same way", async () => {
    const calls = openFetch();
    const { result } = setup(10_000);
    act(() => result.current.submit(2));
    await act(async () => calls[0].resolve(reply(400, { error: "question is closed" })));
    expect(result.current.failure).toBe("late");
  });

  it("any other 400 is still a refusal", async () => {
    const calls = openFetch();
    const { result } = setup(10_000);
    act(() => result.current.submit(2));
    await act(async () => calls[0].resolve(reply(400, { error: "invalid answer" })));
    expect(result.current.failure).toBe("rejected");
  });

  it("after a late refusal, a phone showing time left sends nothing more", async () => {
    const calls = openFetch();
    const { result } = setup(10_000);
    act(() => result.current.submit(2));
    await act(async () => calls[0].resolve(reply(400, TOO_LATE)));
    act(() => result.current.submit(3));
    act(() => result.current.retry());
    await advance(10_000);
    expect(calls).toHaveLength(1);
    expect(result.current.failure).toBe("late");
  });

  it("does not stop a request still in flight, and that request can confirm", async () => {
    const calls = openFetch();
    const { result } = setup(9000);
    act(() => result.current.submit(2));
    await advance(6500);
    expect(calls).toHaveLength(2);

    await act(async () => calls[1].resolve(reply(400, TOO_LATE)));
    expect(calls[0].signal?.aborted).toBe(false);
    expect(result.current.failure).toBe("closed");
    expect(loadPendingAnswer()).toEqual({ questionId: "q1", slotChosen: 2 });

    await act(async () => calls[0].resolve(reply(204)));
    expect(result.current.status).toBe("sent");
    expect(result.current.failure).toBeNull();
    expect(loadPendingAnswer()).toBeNull();
  });

  it("stays on still-checking when an earlier send has gone quiet for good", async () => {
    const calls = openFetch();
    const { result } = setup(9000);
    act(() => result.current.submit(2));
    await advance(6500);
    await act(async () => calls[0].reject(new TypeError("Failed to fetch")));
    await act(async () => calls[1].resolve(reply(400, TOO_LATE)));
    expect(result.current.failure).toBe("closed");
  });

  it("a resend the server finds a saved row for still locks in", async () => {
    const calls = openFetch();
    const { result } = setup(9000);
    act(() => result.current.submit(2));
    await advance(6500);
    await act(async () => calls[1].resolve(reply(409, { error: "already answered" })));
    expect(result.current.status).toBe("sent");
  });

  it("an answer resumed after a refresh is never the only send", async () => {
    window.localStorage.setItem(PENDING_ANSWER_KEY, JSON.stringify({ questionId: "q1", slotChosen: 2 }));
    const calls = openFetch();
    const { result } = setup(10_000);
    await advance(0);
    await act(async () => calls[0].resolve(reply(400, TOO_LATE)));
    expect(result.current.failure).toBe("closed");
    expect(loadPendingAnswer()).toEqual({ questionId: "q1", slotChosen: 2 });
  });
});

describe("the stored answer at zero", () => {
  it("survives zero and goes only when a snapshot shows the row", async () => {
    const calls = openFetch();
    const { result, rerender } = setup(1000);
    act(() => result.current.submit(3));
    await act(async () => calls[0].reject(new TypeError("Failed to fetch")));
    await advance(1000);
    rerender({ accepting: false, serverHasAnswer: false });
    await act(async () => calls[1].reject(new TypeError("Failed to fetch")));
    expect(result.current.failure).toBe("closed");
    expect(loadPendingAnswer()).toEqual({ questionId: "q1", slotChosen: 3 });

    rerender({ accepting: false, serverHasAnswer: true });
    expect(loadPendingAnswer()).toBeNull();
  });

  it("survives the quiet path past zero too", async () => {
    const calls = openFetch();
    const { result, rerender } = setup(1000);
    act(() => result.current.submit(3));
    await advance(1000);
    rerender({ accepting: false, serverHasAnswer: false });
    await advance(5000);
    expect(calls).toHaveLength(1);
    expect(result.current.failure).toBe("closed");
    expect(loadPendingAnswer()).toEqual({ questionId: "q1", slotChosen: 3 });
  });
});
