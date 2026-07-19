// HostDashboard — the headliner card must tell the truth: the THEME label
// reflects the live resolved theme (not a hardcoded month), and the date
// eyebrow only says "TONIGHT" when the night is actually today.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { HostDashboard, type HostDashboardTonight } from "@/components/host/HostDashboard";

afterEach(cleanup);

function tonight(overrides: Partial<HostDashboardTonight> = {}): HostDashboardTonight {
  return {
    nightId: "n1",
    venue: "Soul Fire Pizza",
    date: "Wed Jun 3",
    dateLong: "Wednesday night",
    roomCode: "3MJKJR",
    themeKey: "june",
    status: "setup",
    isToday: true,
    ...overrides,
  };
}

describe("HostDashboard headliner truthfulness", () => {
  it("offers the explicit private controller separately from the venue-safe live screen", () => {
    render(
      <HostDashboard
        themeKey="june"
        tonight={tonight({ status: "live" })}
      />,
    );

    expect(
      screen.getByRole("link", { name: /private phone controls/i }),
    ).toHaveAttribute("href", "/host/phone/n1");
  });

  it("shows the live resolved theme name, not a hardcoded one", () => {
    render(<HostDashboard themeKey="june" tonight={tonight()} />);
    expect(screen.getByText("June · Summer")).toBeDefined();
    expect(screen.queryByText("May · Storm")).toBeNull();
  });

  it("reflects whatever theme is actually rendering", () => {
    render(<HostDashboard themeKey="october" tonight={tonight({ themeKey: "october" })} />);
    expect(screen.getByText("October · Halloween")).toBeDefined();
  });

  it("says TONIGHT only when the night is actually today", () => {
    render(<HostDashboard themeKey="june" tonight={tonight({ date: "Wed Jun 3", isToday: true })} />);
    expect(screen.getByText("TONIGHT · WED JUN 3")).toBeDefined();
  });

  it("drops the false TONIGHT for a past-dated leftover night", () => {
    render(
      <HostDashboard
        themeKey="june"
        tonight={tonight({ date: "Sun May 31", isToday: false })}
      />,
    );
    // The honest date is shown without claiming it's tonight.
    expect(screen.getByText("SUN MAY 31")).toBeDefined();
    expect(screen.queryByText(/^TONIGHT ·/)).toBeNull();
  });
});

describe("HostDashboard still-in-setup section", () => {
  const setupNight = {
    nightId: "abc",
    date: "Wed Jun 4",
    venue: "Soul Fire Pizza",
    cats: ["Music"],
  };

  it("links each in-setup night to its (writable) setup page", () => {
    render(
      <HostDashboard themeKey="june" tonight={tonight()} inSetup={[setupNight]} />,
    );
    expect(screen.getByText("STILL IN SETUP")).toBeDefined();
    // The href is a hand-built template string — lock it so a route rename
    // can't silently strand the host with no way back into a half-built game.
    const link = screen.getByText("Continue setup →").closest("a");
    expect(link?.getAttribute("href")).toBe("/host/setup/abc");
  });

  it("hides the section entirely when there are no in-setup nights", () => {
    render(<HostDashboard themeKey="june" tonight={tonight()} inSetup={[]} />);
    expect(screen.queryByText("STILL IN SETUP")).toBeNull();
  });
});
