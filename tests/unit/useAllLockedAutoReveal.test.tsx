import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAllLockedAutoReveal } from "@/lib/hooks/useAllLockedAutoReveal";
import type { AllLockedAutoRevealDecision } from "@/lib/game/allLockedAutoReveal";

const completeDecision: AllLockedAutoRevealDecision = {
  eligibleCount: 3,
  lockedCount: 3,
  complete: true,
};

const incompleteDecision: AllLockedAutoRevealDecision = {
  eligibleCount: 3,
  lockedCount: 2,
  complete: false,
  reason: "not_everyone_locked",
};

describe("useAllLockedAutoReveal", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fires after the grace window when the decision is complete", () => {
    vi.useFakeTimers();
    const onAutoReveal = vi.fn();

    renderHook(() =>
      useAllLockedAutoReveal({
        questionId: "q1",
        decision: completeDecision,
        onAutoReveal,
      }),
    );

    vi.advanceTimersByTime(1199);
    expect(onAutoReveal).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onAutoReveal).toHaveBeenCalledTimes(1);
  });

  it("does not schedule when the decision is incomplete", () => {
    vi.useFakeTimers();
    const onAutoReveal = vi.fn();

    renderHook(() =>
      useAllLockedAutoReveal({
        questionId: "q1",
        decision: incompleteDecision,
        onAutoReveal,
      }),
    );

    vi.advanceTimersByTime(2000);
    expect(onAutoReveal).not.toHaveBeenCalled();
  });

  it("cancels a pending reveal when completion becomes false", () => {
    vi.useFakeTimers();
    const onAutoReveal = vi.fn();

    const { rerender } = renderHook(
      ({ decision }) =>
        useAllLockedAutoReveal({
          questionId: "q1",
          decision,
          onAutoReveal,
        }),
      { initialProps: { decision: completeDecision } },
    );

    vi.advanceTimersByTime(600);
    rerender({ decision: incompleteDecision });
    vi.advanceTimersByTime(1000);

    expect(onAutoReveal).not.toHaveBeenCalled();
  });

  it("cancels a pending reveal when the question changes", () => {
    vi.useFakeTimers();
    const onAutoReveal = vi.fn();

    const { rerender } = renderHook(
      ({ questionId }) =>
        useAllLockedAutoReveal({
          questionId,
          decision: completeDecision,
          onAutoReveal,
        }),
      { initialProps: { questionId: "q1" } },
    );

    vi.advanceTimersByTime(600);
    rerender({ questionId: "q2" });
    vi.advanceTimersByTime(600);
    expect(onAutoReveal).not.toHaveBeenCalled();

    vi.advanceTimersByTime(600);
    expect(onAutoReveal).toHaveBeenCalledTimes(1);
  });

  it("fires at most once for the same question", () => {
    vi.useFakeTimers();
    const onAutoReveal = vi.fn();

    const { rerender } = renderHook(
      ({ decision }) =>
        useAllLockedAutoReveal({
          questionId: "q1",
          decision,
          onAutoReveal,
        }),
      { initialProps: { decision: completeDecision } },
    );

    vi.advanceTimersByTime(1200);
    rerender({ decision: { ...completeDecision } });
    vi.advanceTimersByTime(1200);

    expect(onAutoReveal).toHaveBeenCalledTimes(1);
  });

  it("does not mark the question fired when auto reveal returns false", async () => {
    vi.useFakeTimers();
    const onAutoReveal = vi
      .fn<() => Promise<boolean | void>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(undefined);

    renderHook(() =>
      useAllLockedAutoReveal({
        questionId: "q1",
        decision: completeDecision,
        onAutoReveal,
      }),
    );

    await vi.advanceTimersByTimeAsync(1200);
    expect(onAutoReveal).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1199);
    expect(onAutoReveal).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(onAutoReveal).toHaveBeenCalledTimes(2);
  });

  it("can fire again for a new question", () => {
    vi.useFakeTimers();
    const onAutoReveal = vi.fn();

    const { rerender } = renderHook(
      ({ questionId }) =>
        useAllLockedAutoReveal({
          questionId,
          decision: completeDecision,
          onAutoReveal,
        }),
      { initialProps: { questionId: "q1" } },
    );

    vi.advanceTimersByTime(1200);
    rerender({ questionId: "q2" });
    vi.advanceTimersByTime(1200);

    expect(onAutoReveal).toHaveBeenCalledTimes(2);
  });
  describe("retries after a failed try", () => {
    const flushAdvance = async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };

    it("waits 1.2, 2.4 and 4.8s, then stops", async () => {
      vi.useFakeTimers();
      const onAutoReveal = vi.fn(async () => false);
      renderHook(() =>
        useAllLockedAutoReveal({ questionId: "q1", decision: completeDecision, onAutoReveal }),
      );

      await flushAdvance(1_200);
      expect(onAutoReveal).toHaveBeenCalledTimes(1);

      await flushAdvance(1_199);
      expect(onAutoReveal).toHaveBeenCalledTimes(1);
      await flushAdvance(1);
      expect(onAutoReveal).toHaveBeenCalledTimes(2);

      await flushAdvance(2_399);
      expect(onAutoReveal).toHaveBeenCalledTimes(2);
      await flushAdvance(1);
      expect(onAutoReveal).toHaveBeenCalledTimes(3);

      await flushAdvance(4_799);
      expect(onAutoReveal).toHaveBeenCalledTimes(3);
      await flushAdvance(1);
      expect(onAutoReveal).toHaveBeenCalledTimes(4);

      await flushAdvance(120_000);
      expect(onAutoReveal).toHaveBeenCalledTimes(4);
    });

    it("the delay runs from when the failed try came back", async () => {
      vi.useFakeTimers();
      const onAutoReveal = vi.fn(
        () => new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8_000)),
      );
      renderHook(() =>
        useAllLockedAutoReveal({ questionId: "q1", decision: completeDecision, onAutoReveal }),
      );

      await flushAdvance(1_200 + 8_000 + 1_199);
      expect(onAutoReveal).toHaveBeenCalledTimes(1);
      await flushAdvance(1);
      expect(onAutoReveal).toHaveBeenCalledTimes(2);
    });

    it("stops the moment a try succeeds", async () => {
      vi.useFakeTimers();
      const onAutoReveal = vi.fn(async () => true as boolean);
      onAutoReveal.mockResolvedValueOnce(false);
      renderHook(() =>
        useAllLockedAutoReveal({ questionId: "q1", decision: completeDecision, onAutoReveal }),
      );

      await flushAdvance(30_000);

      expect(onAutoReveal).toHaveBeenCalledTimes(2);
    });

    it("counts a thrown failure the same as false", async () => {
      vi.useFakeTimers();
      const onAutoReveal = vi.fn(async () => true as boolean);
      onAutoReveal.mockRejectedValueOnce(new Error("boom"));
      renderHook(() =>
        useAllLockedAutoReveal({ questionId: "q1", decision: completeDecision, onAutoReveal }),
      );

      await flushAdvance(1_200 + 1_200);

      expect(onAutoReveal).toHaveBeenCalledTimes(2);
    });

    it("a new question gets its own three retries", async () => {
      vi.useFakeTimers();
      const onAutoReveal = vi.fn(async () => false);
      const { rerender } = renderHook(
        ({ questionId }) =>
          useAllLockedAutoReveal({ questionId, decision: completeDecision, onAutoReveal }),
        { initialProps: { questionId: "q1" } },
      );
      await flushAdvance(30_000);
      expect(onAutoReveal).toHaveBeenCalledTimes(4);

      rerender({ questionId: "q2" });
      await flushAdvance(30_000);

      expect(onAutoReveal).toHaveBeenCalledTimes(8);
    });

    it("everyone locking again after someone unlocked starts the count afresh", async () => {
      vi.useFakeTimers();
      const onAutoReveal = vi.fn(async () => false);
      const { rerender } = renderHook(
        ({ decision }) =>
          useAllLockedAutoReveal({ questionId: "q1", decision, onAutoReveal }),
        { initialProps: { decision: completeDecision } },
      );
      await flushAdvance(30_000);
      expect(onAutoReveal).toHaveBeenCalledTimes(4);

      rerender({ decision: incompleteDecision });
      rerender({ decision: completeDecision });
      await flushAdvance(30_000);

      expect(onAutoReveal).toHaveBeenCalledTimes(8);
    });

    it("drops a waiting retry when the question moves on", async () => {
      vi.useFakeTimers();
      const onAutoReveal = vi.fn(async () => false);
      const { rerender } = renderHook(
        ({ questionId }: { questionId: string | null }) =>
          useAllLockedAutoReveal({ questionId, decision: completeDecision, onAutoReveal }),
        { initialProps: { questionId: "q1" as string | null } },
      );
      await flushAdvance(1_200);
      expect(onAutoReveal).toHaveBeenCalledTimes(1);

      rerender({ questionId: null });
      await flushAdvance(30_000);

      expect(onAutoReveal).toHaveBeenCalledTimes(1);
    });
  });
});
