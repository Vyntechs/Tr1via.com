import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT, userPromptFor } from "@/lib/ai/prompts";

describe("SYSTEM_PROMPT duration", () => {
  it("does not contain '25 seconds' (must stay static for caching)", () => {
    expect(SYSTEM_PROMPT).not.toContain("25 seconds");
  });

  it("does not contain '20 seconds' (must stay static for caching)", () => {
    expect(SYSTEM_PROMPT).not.toContain("20 seconds");
  });
});

describe("userPromptFor duration", () => {
  it("renders '25 seconds' when themeKey is 'may'", () => {
    const prompt = userPromptFor({ topic: "Geography", themeKey: "may" });
    expect(prompt).toContain("25 seconds");
    expect(prompt).not.toContain("20 seconds");
  });

  it("renders '25 seconds' for every theme (the default)", () => {
    const prompt = userPromptFor({ topic: "Geography", themeKey: "house" });
    expect(prompt).toContain("25 seconds");
    expect(prompt).not.toContain("20 seconds");
  });

  it("renders '25 seconds' when themeKey is omitted", () => {
    const prompt = userPromptFor({ topic: "Geography" });
    expect(prompt).toContain("25 seconds");
    expect(prompt).not.toContain("20 seconds");
  });
});
