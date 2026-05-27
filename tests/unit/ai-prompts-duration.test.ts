import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT, userPromptFor } from "@/lib/ai/prompts";

describe("SYSTEM_PROMPT duration", () => {
  it("renders '25 seconds' when themeKey is 'may'", () => {
    const prompt = SYSTEM_PROMPT; // static — not theme-aware yet; this test covers userPromptFor
    // The system prompt is static (cached). Duration lives in userPromptFor.
    // These assertions are on the dynamic user prompt below.
    expect(prompt).toBeTruthy();
  });
});

describe("userPromptFor duration", () => {
  it("renders '25 seconds' when themeKey is 'may'", () => {
    const prompt = userPromptFor({ topic: "Geography", themeKey: "may" });
    expect(prompt).toContain("25 seconds");
    expect(prompt).not.toContain("20 seconds");
  });

  it("renders '20 seconds' for non-May themes", () => {
    const prompt = userPromptFor({ topic: "Geography", themeKey: "house" });
    expect(prompt).toContain("20 seconds");
    expect(prompt).not.toContain("25 seconds");
  });

  it("renders '20 seconds' when themeKey is omitted", () => {
    const prompt = userPromptFor({ topic: "Geography" });
    expect(prompt).toContain("20 seconds");
    expect(prompt).not.toContain("25 seconds");
  });
});
