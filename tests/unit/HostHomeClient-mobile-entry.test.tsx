import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

import { HostHomeClient } from "@/app/host/HostHomeClient";
import { ThemeProvider } from "@/components/system/ThemeProvider";

const props = {
  hostName: "Brandon",
  hostSubtitle: "Founder",
  defaultVenue: "Soul Fire Pizza",
  isFirstNightComplete: true,
  previousGames: [],
  inSetup: [],
  lifetime: { nights: 1, questions: 42 },
  tonight: {
    nightId: "night-live",
    venue: "Soul Fire Pizza",
    date: "Sun Jul 19",
    roomCode: "ABC123",
    themeKey: "house" as const,
    status: "live" as const,
    isToday: true,
  },
};

function setPhoneViewport(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      media: "(max-width: 860px)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

beforeEach(() => {
  push.mockReset();
  window.localStorage.setItem(
    "tr1via-host-whats-new-original-v1",
    "dismissed",
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HostHomeClient live-night entry", () => {
  it("opens the usable host controller when resumed from a phone", () => {
    setPhoneViewport(true);
    render(
      <ThemeProvider themeKey="house">
        <HostHomeClient {...props} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /host from this phone/i }));
    expect(push).toHaveBeenCalledWith("/host/phone/night-live");
  });

  it("uses the same phone-aware destination after opening a prepared room", () => {
    const setupClient = readFileSync(
      join(process.cwd(), "app/host/setup/[nightId]/HostSetupOverviewClient.tsx"),
      "utf8",
    );

    expect(setupClient).toContain("hostRunPath(nightId)");
  });

  it("keeps the combined laptop and venue console on wider screens", () => {
    setPhoneViewport(false);
    render(
      <ThemeProvider themeKey="house">
        <HostHomeClient {...props} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /resume the live game/i }));
    expect(push).toHaveBeenCalledWith("/host/live/night-live");
  });
});
