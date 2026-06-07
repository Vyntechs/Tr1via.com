import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useLockCount } from "@/lib/hooks/useLockCount";

describe("useLockCount", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("polls the locks endpoint and returns the number of locked-in players", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ locks: [{ playerId: "a" }, { playerId: "b" }, { playerId: "c" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useLockCount({ gameId: "g1", active: true }));

    await waitFor(() => expect(result.current).toBe(3));
    expect(fetchMock).toHaveBeenCalledWith("/api/games/g1/locks");
  });

  it("stays 0 and never fetches when inactive", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useLockCount({ gameId: "g1", active: false }));

    expect(result.current).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a missing/empty locks list as 0", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ locks: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useLockCount({ gameId: "g1", active: true }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toBe(0);
  });
});
