// useLockInSync — 3-second polling fallback for missed lock-in broadcasts.
//
// The TV's Supabase realtime channel can drop individual events; this hook
// polls the REST endpoint every 3s so every lock-in eventually gets a ceremony.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLockInSync } from "@/lib/hooks/useLockInSync";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useLockInSync", () => {
  it("polls /api/games/:id/locks every 3 seconds when active", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ locks: [] }),
    } as Response);

    renderHook(() => useLockInSync({ gameId: "g1", active: true, onMissed: () => {} }));

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("/api/games/g1/locks"));
    fetchSpy.mockClear();

    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not poll when active is false", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ locks: [] }),
    } as Response);

    renderHook(() => useLockInSync({ gameId: "g1", active: false, onMissed: () => {} }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls onMissed for locks not yet acknowledged", async () => {
    vi.useFakeTimers();
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        locks: [
          { playerId: "p1", msToLock: 2300, lockedAtMs: 1000 },
          { playerId: "p2", msToLock: 3800, lockedAtMs: 1100 },
        ],
      }),
    } as Response);
    const onMissed = vi.fn();
    renderHook(() =>
      useLockInSync({
        gameId: "g1",
        active: true,
        acknowledged: new Set(["p1"]),
        onMissed,
      })
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(onMissed).toHaveBeenCalledWith({ playerId: "p2", msToLock: 3800, lockedAtMs: 1100 });
    expect(onMissed).not.toHaveBeenCalledWith(expect.objectContaining({ playerId: "p1" }));
  });
});
