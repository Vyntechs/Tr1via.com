import { describe, expect, it } from "vitest";
import { themeFallbackTokens } from "@/app/(player)/room/[code]/recap/page";
import { TR1VIA_THEMES } from "@/lib/theme/tokens";

describe("player recap theme tokens", () => {
  it("derives September stat colors from the shared registry", () => {
    expect(themeFallbackTokens("september")).toEqual({
      accent: TR1VIA_THEMES.september.accent,
      pop: TR1VIA_THEMES.september.pop,
      correct: TR1VIA_THEMES.september.correct,
    });
  });
});
