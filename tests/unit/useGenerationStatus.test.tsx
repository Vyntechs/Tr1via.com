// Unit tests for the question-generation safety-net hook.
// Verifies the timeout escalation and the polled-rollback escalation —
// the two cases where the broadcast happy path failed us.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import type { CategoryRow } from "@/lib/supabase/types";

const supaMock = vi.hoisted(() => {
  let nextState: CategoryRow["state"] | null = "generating";
  const setNextState = (s: CategoryRow["state"] | null) => {
    nextState = s;
  };
  const client = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: nextState ? { state: nextState } : null,
            error: null,
          })),
        })),
      })),
    })),
  };
  return {
    getSupabaseBrowser: () => client,
    setNextState,
  };
});

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: supaMock.getSupabaseBrowser,
}));

import {
  GENERATION_STALL_TIMEOUT_MS,
  useGenerationStatus,
} from "@/lib/hooks/useGenerationStatus";

describe("useGenerationStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    supaMock.setNextState("generating");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits beyond the route's 300-second ceiling before declaring a silent worker dead", () => {
    expect(GENERATION_STALL_TIMEOUT_MS).toBeGreaterThan(300_000);
  });

  it("returns 'ok' when the parent state is not 'generating'", () => {
    const { result } = renderHook(() =>
      useGenerationStatus({
        categoryId: "cat-1",
        state: "review",
        loadedCount: 20,
      }),
    );
    expect(result.current.kind).toBe("ok");
  });

  it("returns 'ok' immediately while inside the safety window", () => {
    const { result } = renderHook(() =>
      useGenerationStatus({
        categoryId: "cat-1",
        state: "generating",
        loadedCount: 0,
        timeoutMs: 60_000,
        pollIntervalMs: 5_000,
      }),
    );
    expect(result.current.kind).toBe("ok");
  });

  it("escalates to 'timeout' after the safety window when zero rows landed", async () => {
    const { result } = renderHook(() =>
      useGenerationStatus({
        categoryId: "cat-1",
        state: "generating",
        loadedCount: 0,
        timeoutMs: 1_000,
        pollIntervalMs: 200,
      }),
    );
    await act(async () => {
      vi.advanceTimersByTime(1_500);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.kind).toBe("timeout");
    });
  });

  it("does NOT escalate to 'timeout' once rows have landed", async () => {
    const { result } = renderHook(() =>
      useGenerationStatus({
        categoryId: "cat-1",
        state: "generating",
        loadedCount: 3,
        timeoutMs: 1_000,
        pollIntervalMs: 200,
      }),
    );
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(result.current.kind).toBe("ok");
  });

  it("escalates to 'rolled-back' when the DB shows state='draft'", async () => {
    supaMock.setNextState("draft");
    const { result } = renderHook(() =>
      useGenerationStatus({
        categoryId: "cat-1",
        state: "generating",
        loadedCount: 0,
        timeoutMs: 60_000,
        pollIntervalMs: 100,
      }),
    );
    await waitFor(() => {
      expect(result.current.kind).toBe("rolled-back");
    });
  });

  it("reports completion when polling sees review after the done broadcast was missed", async () => {
    supaMock.setNextState("review");
    const { result } = renderHook(() =>
      useGenerationStatus({
        categoryId: "cat-1",
        state: "generating",
        loadedCount: 0,
        timeoutMs: 60_000,
        pollIntervalMs: 100,
      }),
    );

    await waitFor(() => {
      expect(result.current).toEqual({ kind: "completed", state: "review" });
    });
  });

  it("stays 'ok' across the idle window while heartbeats keep lastActivityAt fresh", async () => {
    // The server emits progress heartbeats during the long write+verify run.
    // Each refresh of lastActivityAt re-arms the idle timer, so a healthy but
    // slow job (loadedCount stays 0 the whole time) never false-times-out.
    const { result, rerender } = renderHook(
      ({ activity }: { activity: number }) =>
        useGenerationStatus({
          categoryId: "cat-1",
          state: "generating",
          loadedCount: 0,
          lastActivityAt: activity,
          timeoutMs: 1_000,
          pollIntervalMs: 200,
        }),
      { initialProps: { activity: Date.now() } },
    );
    // Advance well past the idle window in sub-window steps, sending a fresh
    // heartbeat (lastActivityAt = now) after each step.
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        vi.advanceTimersByTime(600);
        await Promise.resolve();
      });
      rerender({ activity: Date.now() });
    }
    expect(result.current.kind).toBe("ok");
  });

  it("escalates to 'timeout' when heartbeats stop (lastActivityAt goes stale)", async () => {
    const stale = Date.now();
    const { result } = renderHook(() =>
      useGenerationStatus({
        categoryId: "cat-1",
        state: "generating",
        loadedCount: 0,
        lastActivityAt: stale, // never refreshed → the worker went silent
        timeoutMs: 1_000,
        pollIntervalMs: 200,
      }),
    );
    await act(async () => {
      vi.advanceTimersByTime(1_500);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.kind).toBe("timeout");
    });
  });

  it("is a no-op when disabled", async () => {
    const { result } = renderHook(() =>
      useGenerationStatus({
        categoryId: "cat-1",
        state: "generating",
        loadedCount: 0,
        timeoutMs: 1,
        pollIntervalMs: 1,
        disabled: true,
      }),
    );
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(result.current.kind).toBe("ok");
  });

  it("is a no-op when categoryId is null", async () => {
    const { result } = renderHook(() =>
      useGenerationStatus({
        categoryId: null,
        state: "generating",
        loadedCount: 0,
        timeoutMs: 1,
        pollIntervalMs: 1,
      }),
    );
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(result.current.kind).toBe("ok");
  });
});
