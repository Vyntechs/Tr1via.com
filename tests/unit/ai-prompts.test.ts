import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { SYSTEM_PROMPT, userPromptFor } from "@/lib/ai/prompts";

describe("SYSTEM_PROMPT", () => {
  it("is non-empty and substantially-sized — this prompt is THE quality bar", () => {
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(1_000);
  });

  it("documents the prompt-caching hint as a doc-comment in lib/ai/prompts.ts", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "lib/ai/prompts.ts"),
      "utf-8",
    );
    // Per the spec, the file's documentation must mention cache_control so
    // future maintainers don't accidentally interpolate per-call values
    // into SYSTEM_PROMPT and silently break caching.
    expect(source).toMatch(/cache_control/);
    expect(source).toMatch(/ephemeral/);
  });

  it("encodes TR1VIA's design constraints from the plan", () => {
    // The exact phrasing from tr1via-plan.md:
    expect(SYSTEM_PROMPT).toMatch(/unique/i);
    expect(SYSTEM_PROMPT).toMatch(/learnable/i);
    // All four options plausible — no throwaways:
    expect(SYSTEM_PROMPT).toMatch(/plausible/i);
    expect(SYSTEM_PROMPT).toMatch(/throwaway/i);
    // 1..7 internal difficulty rating:
    expect(SYSTEM_PROMPT).toMatch(/1.{0,3}7/);
    // fact blurb:
    expect(SYSTEM_PROMPT).toMatch(/blurb/i);
    // photo query:
    expect(SYSTEM_PROMPT).toMatch(/photoQuery/);
    // never leak the answer in the photo query URL:
    expect(SYSTEM_PROMPT).toMatch(/(do not include|never).*answer/i);
  });

  it("instructs Claude to call the emit_questions tool", () => {
    expect(SYSTEM_PROMPT).toMatch(/emit_questions/);
  });
});

describe("userPromptFor", () => {
  it("includes the topic verbatim", () => {
    const out = userPromptFor({ topic: "Pixar movies" });
    expect(out).toContain("Pixar movies");
  });

  it("trims whitespace around the topic", () => {
    const out = userPromptFor({ topic: "  Pixar movies   \n" });
    expect(out).toContain("Topic: Pixar movies");
  });

  it("defaults to normal difficulty and 20 questions", () => {
    const out = userPromptFor({ topic: "US states" });
    expect(out).toMatch(/Difficulty target: normal/);
    expect(out).toMatch(/Number of questions: 20/);
  });

  it("honors difficulty and count overrides", () => {
    const out = userPromptFor({
      topic: "US states",
      difficulty: "hard",
      count: 12,
    });
    expect(out).toMatch(/Difficulty target: hard/);
    expect(out).toMatch(/Number of questions: 12/);
  });

  it("includes flavor when provided, joined as a comma list", () => {
    const out = userPromptFor({
      topic: "Sci-fi cinema",
      flavor: ["sharper", "more local", "more pop culture"],
    });
    expect(out).toMatch(/Flavor: sharper, more local, more pop culture/);
  });

  it("filters out empty flavor entries", () => {
    const out = userPromptFor({
      topic: "X",
      flavor: ["sharper", "", "   "],
    });
    expect(out).toMatch(/Flavor: sharper/);
    expect(out).not.toMatch(/,\s*,/);
  });

  it("omits the Flavor line entirely when no flavor entries pass the filter", () => {
    const out = userPromptFor({ topic: "X", flavor: ["  ", ""] });
    expect(out).not.toMatch(/Flavor:/);
  });
});
