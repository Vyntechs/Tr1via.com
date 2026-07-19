import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import PlayerJoinPage from "@/app/(player)/join/page";
import { ThemeProvider } from "@/components/system";

describe("bare player join device session", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("removes the legacy browser-readable identity before a room code is entered", async () => {
    window.localStorage.setItem("tr1via_device_id", "legacy-raw-device-id");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ready: true }),
    } as Response);

    render(
      <ThemeProvider themeKey="house">
        <PlayerJoinPage />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(window.localStorage.getItem("tr1via_device_id")).toBeNull();
    });
    expect(fetchSpy).toHaveBeenCalledWith("/api/session/init", {
      method: "POST",
      credentials: "same-origin",
    });
  });
});
