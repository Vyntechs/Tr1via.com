import { describe, expect, it } from "vitest";
import { riskFlagsForQuestion } from "@/lib/ai/question-risk-flags";

const base = {
  prompt: "Which movie features a character named Buzz Lightyear?",
  options: ["Toy Story", "Shrek", "Cars", "Frozen"] as [
    string,
    string,
    string,
    string,
  ],
  factBlurb: "Toy Story introduced Buzz Lightyear in 1995.",
};

describe("riskFlagsForQuestion", () => {
  it("returns no flags for ordinary stable wording", () => {
    expect(riskFlagsForQuestion(base)).toEqual([]);
  });

  it("flags time-sensitive, ranking, and geography-sensitive wording", () => {
    const flags = riskFlagsForQuestion({
      ...base,
      prompt:
        "As of 2026, what is the largest country by area in the world?",
      factBlurb: "Russia is commonly listed as the largest country by area.",
    });

    expect(flags).toEqual([
      "time_sensitive",
      "ranking_or_superlative",
      "geography_sensitive",
    ]);
  });

  it("flags subjective and multiple-answer-risk wording", () => {
    const flags = riskFlagsForQuestion({
      ...base,
      prompt: "Which of these is often called the best movie except by critics?",
      options: ["Movie A", "Movie B", "Movie C", "Movie D"],
    });

    expect(flags).toContain("subjective_wording");
    expect(flags).toContain("multiple_answer_risk");
  });
});
