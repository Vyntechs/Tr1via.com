import { describe, expect, it } from "vitest";
import {
  createQuestionGenerationReportAccumulator,
  hostAuditSummaryFromSnapshot,
  questionGenerationReportInsertFromSnapshot,
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

describe("question generation report accumulator", () => {
  it("aggregates usage, round results, image counts, and risk flags", () => {
    const acc = createQuestionGenerationReportAccumulator({
      requestedCount: 20,
      verifyPasses: 2,
    });

    acc.recordUsage("claude-sonnet-4-6", {
      input_tokens: 1_000,
      output_tokens: 500,
    });
    acc.recordRound({
      round: 1,
      requested: 20,
      generated: 3,
      accepted: 1,
      rejected: [
        { prompt: "wrong", reasons: ["verifier_wrong"] },
        { prompt: "ambiguous", reasons: ["verifier_ambiguous"] },
      ],
    });
    acc.recordAcceptedQuestions([
      q("As of 2026, what is the largest country by area in the world?"),
    ]);
    acc.recordImageTargets(2);
    acc.recordImageAttached();

    const snapshot = acc.snapshot("partial");

    expect(snapshot.acceptedCount).toBe(1);
    expect(snapshot.generatedCount).toBe(3);
    expect(snapshot.rejectedCount).toBe(2);
    expect(snapshot.rounds).toBe(1);
    expect(snapshot.llmCalls).toBe(1);
    expect(snapshot.tokensIn).toBe(1_000);
    expect(snapshot.tokensOut).toBe(500);
    expect(snapshot.imageTargetCount).toBe(2);
    expect(snapshot.imageAttachedCount).toBe(1);
    expect(snapshot.imageSkippedCount).toBe(1);
    expect(snapshot.riskFlagCount).toBe(3);
    expect(snapshot.report.reasonCounts).toEqual({
      verifier_wrong: 1,
      verifier_ambiguous: 1,
      max_rounds_exhausted: 1,
    });
  });

  it("maps a snapshot to host summary and database insert shape", () => {
    const acc = createQuestionGenerationReportAccumulator({
      requestedCount: 20,
      verifyPasses: 2,
    });
    acc.recordRound({
      round: 1,
      requested: 20,
      generated: 20,
      accepted: 20,
      rejected: [],
    });
    acc.recordAcceptedQuestions([q("Which state is Alaska?")]);
    acc.recordImageTargets(20);
    acc.recordImageAttached();
    const snapshot = acc.snapshot("completed");

    expect(hostAuditSummaryFromSnapshot(snapshot)).toMatchObject({
      acceptedCount: 20,
      generatedCount: 20,
      verifyPasses: 2,
      imageTargetCount: 20,
      imageAttachedCount: 1,
    });

    const insert = questionGenerationReportInsertFromSnapshot(
      {
        categoryId: "11111111-1111-1111-1111-111111111111",
        gameId: "22222222-2222-2222-2222-222222222222",
        nightId: "33333333-3333-3333-3333-333333333333",
        hostId: "44444444-4444-4444-4444-444444444444",
        categoryName: "Movies",
        topic: "Pixar Movies",
        mode: "initial",
      },
      snapshot,
    );

    expect(insert.status).toBe("completed");
    expect(insert.topic).toBe("Pixar Movies");
    expect(insert.report).toMatchObject({ reasonCounts: {} });
  });
});
