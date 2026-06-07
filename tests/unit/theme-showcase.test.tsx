// tests/unit/theme-showcase.test.tsx
//
// Guards the monthly-theme showcase — the "color year" wall shown as a teaser on
// /trivia-night and in full on /themes. The whole point of the feature is that
// each card wears its OWN month's palette, not the page's daylight theme, so the
// tests pin exactly that:
//   1. all twelve months render, in calendar order (single source = SHOWCASE_MONTHS)
//   2. cards paint from the real registry (month accent hexes appear in the DOM)
//   3. cards do NOT fall back to the page's daylight accent (proves per-card theming)
//   4. the teaser links to the full gallery at /themes

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThemeShowcase, SHOWCASE_MONTHS } from "@/components/marketing/ThemeShowcase";
import { TR1VIA_THEMES } from "@/lib/theme/tokens";

const CALENDAR = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
] as const;

describe("ThemeShowcase — the color year", () => {
  it("renders all twelve months in calendar order", () => {
    expect(SHOWCASE_MONTHS).toEqual(CALENDAR);
  });

  it("renders each month's display name in the full gallery", () => {
    render(<ThemeShowcase variant="full" />);
    for (const key of CALENDAR) {
      const monthName = TR1VIA_THEMES[key].name.split("·")[0].trim();
      expect(screen.getByText(monthName)).toBeTruthy();
    }
  });

  it("paints each card from its own month palette (registry accents present)", () => {
    const { container } = render(<ThemeShowcase variant="full" />);
    const html = container.innerHTML;
    // Sample three months that span the palette: icy blue, festive red, pumpkin.
    expect(html).toContain(TR1VIA_THEMES.january.accent); // #5AA8E0
    expect(html).toContain(TR1VIA_THEMES.july.accent); // #E63946
    expect(html).toContain(TR1VIA_THEMES.october.accent); // #F08C2A
  });

  it("does NOT fall back to the page's daylight accent (per-card theming holds)", () => {
    const { container } = render(<ThemeShowcase variant="full" />);
    // No month uses daylight's accent; if a card leaked the page theme, this hex
    // would appear. Its absence proves each card resolves its own palette.
    expect(container.innerHTML).not.toContain(TR1VIA_THEMES.daylight.accent); // #D9421F
  });

  it("teaser links to the full gallery at /themes", () => {
    render(<ThemeShowcase variant="teaser" />);
    const link = screen.getByTestId("themes-teaser-link");
    expect(link.getAttribute("href")).toBe("/themes");
  });
});
