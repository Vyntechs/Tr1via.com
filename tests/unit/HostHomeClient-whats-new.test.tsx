import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { HostHomeClient } from "@/app/host/HostHomeClient";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { shouldAutoShowWhatsNew, whatsNewSeenKey } from "@/lib/host/whats-new";


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

describe("HostHomeClient What's new", () => {
  it("doesn't pop up by itself — no old news interrupting her dashboard", async () => {
    renderThemed(<HostHomeClient {...baseProps} />);
    expect(await screen.findByRole("button", { name: /what's new/i })).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the button shows the current news: passwords, not the old July notes", async () => {
    renderThemed(<HostHomeClient {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /what's new/i }));
    const dialog = await screen.findByRole("dialog", { name: "TR1VIA now uses a password." });
    expect(dialog).toHaveTextContent("Running your night hasn't changed at all.");
    expect(dialog).toHaveTextContent("The first time you sign in, we send you a 6-digit code from TR1VIA.");
    expect(dialog).toHaveTextContent("Stuck? Text Brandon.");
    expect(dialog).not.toHaveTextContent(/protect themselves|fact-check/i);

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the dashboard fixed while the notice scrolls, then restores it", async () => {
    document.body.style.overflow = "auto";
    document.documentElement.style.overflow = "scroll";

    renderThemed(<HostHomeClient {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /what's new/i }));

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

describe("shouldAutoShowWhatsNew — can't show old news", () => {
  const fresh = { date: "2026-09-27", autoShow: true };
  const now = new Date("2026-10-05T12:00:00Z");

  it("opens by itself for fresh, unseen news", () => {
    expect(shouldAutoShowWhatsNew(fresh, false, now)).toBe(true);
  });
  it("never again once she's closed it", () => {
    expect(shouldAutoShowWhatsNew(fresh, true, now)).toBe(false);
  });
  it("stops by itself after 30 days", () => {
    expect(shouldAutoShowWhatsNew(fresh, false, new Date("2026-10-28T12:00:00Z"))).toBe(false);
  });
  it("never for news marked not to pop up", () => {
    expect(shouldAutoShowWhatsNew({ ...fresh, autoShow: false }, false, now)).toBe(false);
  });
  it("a new announcement gets a new 'seen' mark", () => {
    expect(whatsNewSeenKey({ id: "a" })).not.toBe(whatsNewSeenKey({ id: "b" }));
  });
});
