// August is the one month that changes the screen, not just the palette.
//
// Two things about this theme are decisions, not implementation details, and
// both are easy to undo by accident:
//
//   1. August must not spend fall's palette. It is the handoff month — the
//      world stays summer and only the leaves say fall. September, October
//      and November own the full-autumn grounds and accents; if August
//      creeps onto them, all four months read the same.
//   2. Nothing ornamental may cover functional text. The marginalia is
//      placed per-screen against verified empty page, so an unknown screen
//      gets no hand at all, a phone gets none either (no spare page), and a
//      surface that paints its own background never gets the paper painted
//      over it.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Weather } from "@/components/system/Weather";
import { TR1VIA_THEMES } from "@/lib/theme/tokens";
import { resolveTheme } from "@/lib/theme/resolve";

describe("August · the palette leaves fall something to wear", () => {
  it("is a light paper theme, not another dark autumn room", () => {
    expect(TR1VIA_THEMES.august.mode).toBe("light");
    expect(resolveTheme("august").dark).toBe(false);
  });

  it("shares no accent or pop with September, October or November", () => {
    const august = TR1VIA_THEMES.august;
    for (const key of ["september", "october", "november"] as const) {
      const fall = TR1VIA_THEMES[key];
      expect(august.accent.toUpperCase()).not.toBe(fall.accent.toUpperCase());
      expect(august.accent.toUpperCase()).not.toBe(fall.pop.toUpperCase());
      expect(august.pop.toUpperCase()).not.toBe(fall.pop.toUpperCase());
      expect(august.paper.toUpperCase()).not.toBe(fall.paper.toUpperCase());
    }
  });
});

describe("August · the notebook page", () => {
  it("renders the page instead of the shared fall drift", () => {
    render(<Weather themeKey="august" />);
    expect(screen.getByTestId("august-page")).toBeInTheDocument();
    expect(screen.getByTestId("august-substrate")).toBeInTheDocument();
  });

  it("leaves the other fall months on their own weather", () => {
    for (const key of ["september", "october", "november"] as const) {
      const { unmount } = render(<Weather themeKey={key} />);
      expect(screen.queryByTestId("august-page")).toBeNull();
      unmount();
    }
  });

  it("draws no marginalia on a screen it has not been told the name of", () => {
    render(<Weather themeKey="august" />);
    expect(screen.queryByTestId("august-marginalia")).toBeNull();
  });

  it("draws marginalia once it knows which screen it is on", () => {
    render(<Weather themeKey="august" page="question" />);
    expect(screen.getByTestId("august-marginalia")).toBeInTheDocument();
  });

  it("never draws marginalia on a phone — there is no spare page", () => {
    render(<Weather themeKey="august" page="question" compact />);
    expect(screen.getByTestId("august-page")).toBeInTheDocument();
    expect(screen.queryByTestId("august-marginalia")).toBeNull();
  });

  it("does not repaint a surface that paints its own background", () => {
    // The reveal drops a curtain of the correct-color. Leaves keep falling
    // through it; the paper does not get painted over it.
    render(<Weather themeKey="august" page="reveal" substrate={false} />);
    expect(screen.getByTestId("august-page")).toBeInTheDocument();
    expect(screen.queryByTestId("august-substrate")).toBeNull();
    expect(screen.queryByTestId("august-marginalia")).toBeNull();
  });

  it("renders nothing at all when weather is switched off", () => {
    render(<Weather themeKey="august" intensity={0} />);
    expect(screen.queryByTestId("august-page")).toBeNull();
  });
});

describe("August · the bonfire", () => {
  // The host's note after the first live night: it needed the campfire the
  // month is actually about. The answer is embers rising against leaves
  // falling — not an orange repaint, which would spend fall's palette and
  // dull a venue TV. Both halves of that opposition have to survive.
  it("sends embers up on every surface that gets the page", () => {
    render(<Weather themeKey="august" />);
    expect(screen.getByTestId("august-embers")).toBeInTheDocument();
  });

  it("keeps the embers on a phone, where the page is the whole atmosphere", () => {
    render(<Weather themeKey="august" compact />);
    expect(screen.getByTestId("august-embers")).toBeInTheDocument();
  });

  it("keeps embers on a surface that paints its own background", () => {
    // Sparks are in the air between the viewer and the fire; they carry even
    // where the paper itself must not be painted.
    render(<Weather themeKey="august" substrate={false} />);
    expect(screen.getByTestId("august-embers")).toBeInTheDocument();
    expect(screen.queryByTestId("august-substrate")).toBeNull();
  });

  it("gives no other month embers", () => {
    for (const key of ["july", "september", "october", "november"] as const) {
      const { unmount } = render(<Weather themeKey={key} />);
      expect(screen.queryByTestId("august-embers")).toBeNull();
      unmount();
    }
  });

  it("keeps the warmed paper clear of fall's grounds and accents", () => {
    // The paper went warmer and a shade deeper at the host's request. It must
    // still not land on any month that owns the real autumn.
    const august = TR1VIA_THEMES.august;
    expect(august.paper.toUpperCase()).toBe("#EADEBE");
    for (const key of ["september", "october", "november"] as const) {
      const fall = TR1VIA_THEMES[key];
      expect(august.paper.toUpperCase()).not.toBe(fall.paper.toUpperCase());
      expect(august.accent.toUpperCase()).not.toBe(fall.accent.toUpperCase());
      expect(august.accent.toUpperCase()).not.toBe(fall.pop.toUpperCase());
      expect(august.pop.toUpperCase()).not.toBe(fall.pop.toUpperCase());
    }
  });
});
