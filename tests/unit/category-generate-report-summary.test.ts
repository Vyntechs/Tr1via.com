import { describe, expect, it } from "vitest";
import {
  createQuestionGenerationReportAccumulator,
  hostAuditSummaryFromSnapshot,
} from "@/lib/ai/question-generation-report";
import type { GeneratedQuestion } from "@/lib/ai/generate-questions";

function q(prompt: string): GeneratedQuestion {
  return {
    prompt,
    options: ["A", "B", "C", "D"],
    correctIndex: 0,
    difficulty: 4,
    factBlurb: "A stable fact blurb.",
    photoQuery: "photo query",
  };
}

describe("generation done audit summary", () => {
  it("contains only compact host-safe metrics", () => {
    const acc = createQuestionGenerationReportAccumulator({
      requestedCount: 20,
      verifyPasses: 2,
    });
    acc.recordRound({
      round: 1,
      requested: 20,
      generated: 21,
      accepted: 20,
      rejected: [{ prompt: "wrong", reasons: ["verifier_wrong"] }],
    });
    acc.recordAcceptedQuestions([
      q("As of 2026, what is the largest country by area in the world?"),
      ...Array.from({ length: 19 }, (_, i) => q(`Accepted question ${i + 2}?`)),
    ]);
    acc.recordImageTargets(20);
    acc.recordImageAttached();
    const summary = hostAuditSummaryFromSnapshot(acc.snapshot("completed"));

    expect(summary).toEqual({
      acceptedCount: 20,
      generatedCount: 21,
      verifyPasses: 2,
      estimatedCostUsd: 0,
      imageTargetCount: 20,
      imageAttachedCount: 1,
      riskFlagCount: 3,
    });
  });
});
