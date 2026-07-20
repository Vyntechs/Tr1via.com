import { describe, expect, it } from "vitest";
import { contrastRatio, readableForeground } from "@/lib/theme/contrast";
import { THEME_KEYS, TR1VIA_THEMES } from "@/lib/theme/tokens";

describe("host theme action contrast", () => {
  it.each(THEME_KEYS)("keeps %s accent and pop actions at WCAG AA contrast", (themeKey) => {
    const theme = TR1VIA_THEMES[themeKey];

    for (const background of [theme.accent, theme.pop]) {
      const foreground = readableForeground(background);
      expect(["#000000", "#FFFFFF"]).toContain(foreground);
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
