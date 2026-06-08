import { describe, it, expect } from "vitest";
import { themeVars } from "@/components/marketing/themeVars";
import { TR1VIA_THEMES } from "@/lib/theme/tokens";

describe("themeVars", () => {
  it("maps a theme's core palette to CSS custom properties", () => {
    const v = themeVars("june") as Record<string, string>;
    expect(v["--paper"]).toBe(TR1VIA_THEMES.june.paper);
    expect(v["--ink"]).toBe(TR1VIA_THEMES.june.ink);
    expect(v["--accent"]).toBe(TR1VIA_THEMES.june.accent);
    expect(v["--pop"]).toBe(TR1VIA_THEMES.june.pop);
  });

  it("includes derived tokens so sections are self-sufficient", () => {
    const v = themeVars("october") as Record<string, string>;
    expect(v["--surface"]).toBeTruthy();
    expect(v["--ink-mid"]).toBeTruthy();
    expect(v["--ink-mute"]).toBeTruthy();
    expect(v["--line"]).toBeTruthy();
    expect(v["--line-soft"]).toBeTruthy();
  });

  it("sets color-scheme so native controls/scrollbars match the section mode", () => {
    expect(themeVars("october").colorScheme).toBe("dark");
    expect(themeVars("june").colorScheme).toBe("light");
  });
});
