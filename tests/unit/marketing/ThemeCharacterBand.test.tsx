import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ROOM_MAGIC_PREVIEWS,
  ThemeCharacterBand,
  type MonthlyThemeKey,
} from "@/components/marketing/ThemeCharacterBand";
import { MONTH_THEME_KEYS } from "@/lib/theme/monthThemeScript";

describe("ThemeCharacterBand", () => {
  it("covers every monthly theme with a Room Magic preview", () => {
    expect(Object.keys(ROOM_MAGIC_PREVIEWS).sort()).toEqual([...MONTH_THEME_KEYS].sort());
    for (const key of MONTH_THEME_KEYS) {
      const preview = ROOM_MAGIC_PREVIEWS[key as MonthlyThemeKey];
      expect(preview.effect).not.toMatch(/mascot|troupe|character/i);
      expect(preview.cue.length).toBeGreaterThan(0);
    }
  });

  it("renders visual-only magic with no sound language", () => {
    render(<ThemeCharacterBand themeKey="july" activeIndex={6} homeIndex={6} />);
    const band = screen.getByTestId("theme-character-band");
    expect(band.textContent).not.toMatch(/sound|audio|music|speaker|song|listen/i);
    expect(screen.getByText(/firework pop/i)).toBeTruthy();
  });

  it("frames the month toy as Room Magic instead of unexplained stage labels", () => {
    render(<ThemeCharacterBand themeKey="september" activeIndex={8} homeIndex={6} />);
    const band = screen.getByTestId("theme-character-band");

    expect(screen.getByText(/room magic/i)).toBeTruthy();
    expect(screen.getByText(/players tap reactions/i)).toBeTruthy();
    expect(band.textContent).not.toMatch(/\bMarn\b/);
    expect(band.textContent).not.toMatch(/\bTV\b/);
    expect(band.textContent).not.toMatch(/\bhost\b/i);
  });

  it("marks itself decorative so product copy remains the accessible focus", () => {
    render(<ThemeCharacterBand themeKey="december" activeIndex={11} homeIndex={6} />);
    expect(screen.getByTestId("theme-character-band")).toHaveAttribute("aria-hidden", "true");
  });
});
