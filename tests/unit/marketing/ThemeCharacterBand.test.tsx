import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  THEME_TROUPE,
  ThemeCharacterBand,
  type MonthlyThemeKey,
} from "@/components/marketing/ThemeCharacterBand";
import { MONTH_THEME_KEYS } from "@/lib/theme/monthThemeScript";

describe("ThemeCharacterBand", () => {
  it("covers every monthly theme with an original visual role", () => {
    expect(Object.keys(THEME_TROUPE).sort()).toEqual([...MONTH_THEME_KEYS].sort());
    for (const key of MONTH_THEME_KEYS) {
      const member = THEME_TROUPE[key as MonthlyThemeKey];
      expect(member.role).not.toMatch(/mascot/i);
      expect(member.gesture.length).toBeGreaterThan(0);
    }
  });

  it("renders visual-only magic with no sound language", () => {
    render(<ThemeCharacterBand themeKey="july" activeIndex={6} homeIndex={6} />);
    const band = screen.getByTestId("theme-character-band");
    expect(band.textContent).not.toMatch(/sound|audio|music|speaker|song|listen/i);
    expect(screen.getByText(/sparkler cue/i)).toBeTruthy();
  });

  it("marks itself decorative so product copy remains the accessible focus", () => {
    render(<ThemeCharacterBand themeKey="december" activeIndex={11} homeIndex={6} />);
    expect(screen.getByTestId("theme-character-band")).toHaveAttribute("aria-hidden", "true");
  });
});
