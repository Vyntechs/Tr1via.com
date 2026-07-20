import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { HostHomeClient } from "@/app/host/HostHomeClient";
import { ThemeProvider } from "@/components/system/ThemeProvider";

const NOTICE_KEY = "tr1via-host-whats-new-original-v2";

const baseProps = {
  hostName: "Heather",
  hostSubtitle: "Soul Fire Pizza",
  defaultVenue: "Soul Fire Pizza",
  isFirstNightComplete: true,
  previousGames: [],
  inSetup: [],
  lifetime: { nights: 12, questions: 504 },
  tonight: null,
};

function renderThemed(node: ReactNode) {
  return render(<ThemeProvider themeKey="house">{node}</ThemeProvider>);
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
  vi.restoreAllMocks();
});

describe("HostHomeClient host-only What's New", () => {
  it("explains the host benefits and the honest Brandon escalation on first visit", async () => {
    renderThemed(<HostHomeClient {...baseProps} />);

    expect(
      await screen.findByRole("dialog", {
        name: /your games now protect themselves/i,
      }),
    ).toBeVisible();
    expect(
      screen.getByText(/AI-generated questions are checked before you can use them/i),
    ).toBeVisible();
    expect(screen.getByText(/Sign in on any device\. Control the same live game\./i)).toBeVisible();
    expect(screen.getByText(/TV preview shows what players see/i)).toBeVisible();
    expect(screen.getByText(/Players scan the only QR/i)).toBeVisible();
    expect(screen.getByText(/no fact-check is perfect/i)).toBeVisible();
    expect(screen.getByText(/contact Brandon/i)).toBeVisible();
  });

  it("remembers dismissal and lets the host reopen the notice", async () => {
    const first = renderThemed(<HostHomeClient {...baseProps} />);
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    expect(window.localStorage.getItem(NOTICE_KEY)).toBe("dismissed");
    expect(screen.queryByRole("dialog")).toBeNull();

    first.unmount();
    renderThemed(<HostHomeClient {...baseProps} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /what's new/i }));
    expect(await screen.findByRole("dialog")).toBeVisible();
  });

  it("keeps the dashboard fixed while the notice scrolls, then restores it", async () => {
    document.body.style.overflow = "auto";
    document.documentElement.style.overflow = "scroll";

    renderThemed(<HostHomeClient {...baseProps} />);

    const dialog = await screen.findByRole("dialog");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(dialog.style.overscrollBehavior).toBe("contain");

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    expect(document.body.style.overflow).toBe("auto");
    expect(document.documentElement.style.overflow).toBe("scroll");
  });

  it("does not interrupt a brand-new host's onboarding flow", async () => {
    renderThemed(
      <HostHomeClient {...baseProps} isFirstNightComplete={false} />,
    );

    expect(await screen.findByTestId("host-onboarding-first")).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /what's new/i })).toBeNull();
  });
});
