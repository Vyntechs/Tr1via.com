import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

import { ThemeProvider } from "@/components/system/ThemeProvider";
import { HostHomeClient } from "@/app/host/HostHomeClient";

const renderThemed = (node: ReactNode) =>
  render(<ThemeProvider themeKey="house">{node}</ThemeProvider>);

const baseProps = {
  hostName: "Brandon",
  hostSubtitle: "Founder",
  defaultVenue: "Soul Fire Pizza",
  isFirstNightComplete: true,
  weeks: [],
  previousGames: [],
  inSetup: [],
  lifetime: { nights: 0, questions: 0 },
  tonight: null,
};

afterEach(() => vi.restoreAllMocks());

describe("HostHomeClient founder build button", () => {
  it("is hidden for non-founders", () => {
    renderThemed(<HostHomeClient {...baseProps} isFounder={false} />);
    expect(
      screen.queryByRole("button", { name: /build a full game/i }),
    ).toBeNull();
  });

  it("builds a game and routes into setup for a founder", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ nightId: "night-123" }),
      })) as unknown as typeof fetch,
    );
    renderThemed(<HostHomeClient {...baseProps} isFounder={true} />);
    fireEvent.click(screen.getByRole("button", { name: /build a full game/i }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/host/setup/night-123"),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/founder/build-game",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
