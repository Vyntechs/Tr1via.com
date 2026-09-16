import { describe, it, expect } from "vitest";
import { questionDurationFor } from "@/lib/theme/lockInCeremony";
import { THEME_KEYS } from "@/lib/theme/tokens";

describe("room page duration source", () => {
  it("yields 25s for may", () => {
    expect(questionDurationFor("may")).toBe(25);
  });
  it("yields 25s for every theme (the default)", () => {
    for (const themeKey of THEME_KEYS) {
      expect(questionDurationFor(themeKey)).toBe(25);
    }
  });
});
