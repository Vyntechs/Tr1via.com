import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAnswerSubmit } from "@/lib/hooks/useAnswerSubmit";
import {
  notePhoneAtZero,
  notePhoneReplyWait,
  notePhoneResend,
  returnPhoneStats,
  takePhoneStats,
} from "@/lib/live/phoneStats";

describe("phone stats for the heartbeat", () => {
  beforeEach(() => {
    takePhoneStats();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has nothing to hand over until something happens", () => {
    expect(takePhoneStats()).toBeNull();
  });

  it("counts resends, keeps the longest wait, adds up seconds at zero", () => {
    notePhoneResend();
    notePhoneResend();
    notePhoneReplyWait(900);
    notePhoneReplyWait(6_200);
    notePhoneReplyWait(300);
    notePhoneAtZero(2_400);
    notePhoneAtZero(1_000);
    expect(takePhoneStats()).toEqual({
      resendCount: 2,
      longestReplyWaitMs: 6_200,
      secondsAtZero: 3,
    });
    expect(takePhoneStats()).toBeNull();
  });

  it("a failed heartbeat gives its numbers back, so a blip isn't lost", () => {
    notePhoneResend();
    notePhoneReplyWait(5_000);
    const taken = takePhoneStats()!;
    notePhoneResend();
    notePhoneReplyWait(1_000);
    returnPhoneStats(taken);
    expect(takePhoneStats()).toEqual({
      resendCount: 2,
      longestReplyWaitMs: 5_000,
      secondsAtZero: 0,
    });
  });

  it("the answer send counts a resend and its reply wait", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { result } = renderHook(() =>
      useAnswerSubmit({ questionId: "q1", scramble: [0, 1, 2, 3], backoffMs: [1] }),
    );
    act(() => {
      result.current.submit(2);
    });
    await waitFor(() => expect(result.current.status).toBe("sent"));
    expect(takePhoneStats()?.resendCount).toBe(1);
  });
});
