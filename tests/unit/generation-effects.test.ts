import { describe, expect, it, vi } from "vitest";
import { commitGenerationQuestions } from "@/lib/ai/generation-effects";
import type { GeneratedQuestion } from "@/lib/ai/generate-questions";

const question: GeneratedQuestion = {
  prompt: "Which television format debuted first?",
  options: ["A", "B", "C", "D"],
  correctIndex: 0,
  difficulty: 4,
  factBlurb: "A verified television fact.",
  photoQuery: "surveillance television studio",
};

describe("commitGenerationQuestions", () => {
  it("keeps photo intent and represents a new row with its actual null image URL", async () => {
    const rpc = vi.fn(async () => ({
      data: { applied: true, code: "applied" },
      error: null,
    }));

    const rows = await commitGenerationQuestions(
      { rpc },
      {
        categoryId: "category-1",
        attempt: 2,
        questions: [question],
      },
    );

    expect(rpc).toHaveBeenCalledWith(
      "commit_generation_questions",
      expect.objectContaining({
        p_questions: [expect.objectContaining({ photoQuery: question.photoQuery })],
      }),
    );
    expect(rows).toEqual([
      {
        id: expect.any(String),
        q: question,
        imageUrl: null,
      },
    ]);
  });
});
