import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
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
});
