import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDeviceSession } from "@/lib/hooks/useDeviceSession";

describe("useDeviceSession", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("keeps the signed device identity out of browser storage and hook state", async () => {
    window.localStorage.setItem("tr1via_device_id", "stolen-value");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ready: true }),
    } as Response);

    const { result } = renderHook(() => useDeviceSession());

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(fetchSpy).toHaveBeenCalledWith("/api/session/init", {
      method: "POST",
      credentials: "same-origin",
    });
    expect(window.localStorage.getItem("tr1via_device_id")).toBeNull();
    expect(result.current).toEqual({ isReady: true, isLoading: false });
  });
});
