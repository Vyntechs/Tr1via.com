import { describe, expect, it, vi } from "vitest";
import {
  commitGenerationPhoto,
  commitGenerationQuestions,
  settleGenerationPhotoCommit,
} from "@/lib/ai/generation-effects";
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
        q: expect.objectContaining({ prompt: question.prompt, factBlurb: question.factBlurb }),
        imageUrl: null,
      },
    ]);
  });

  it("shuffles the four choices on save and keeps the right answer text", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
      calls.push(args);
      return { data: { applied: true, code: "applied" }, error: null };
    });
    // random() = 0 pins the order to [1,2,3,0]: B C D A.
    const rows = await commitGenerationQuestions(
      { rpc },
      { categoryId: "category-1", attempt: 2, questions: [question], random: () => 0 },
    );

    const saved = (calls[0]!.p_questions as Array<Record<string, unknown>>)[0]!;
    expect(saved.options).toEqual(["B", "C", "D", "A"]);
    expect(saved.correctIndex).toBe(3);
    // What the route gets back matches what was stored, not the writer's order.
    expect(rows![0]!.q.options).toEqual(["B", "C", "D", "A"]);
    expect(rows![0]!.q.correctIndex).toBe(3);
    expect(rows![0]!.q.options[rows![0]!.q.correctIndex]).toBe("A");
  });
});

describe("generation photo commit outcomes", () => {
  it.each(["applied", "host_override", "stale"] as const)(
    "returns the explicit %s SQL outcome",
    async (code) => {
      const rpc = vi.fn(async () => ({
        data: { applied: code === "applied", code },
        error: null,
      }));

      await expect(
        commitGenerationPhoto(
          { rpc },
          {
            categoryId: "category-1",
            attempt: 2,
            questionId: "question-1",
            imageUrl: "https://images.pexels.com/auto.jpg",
            attribution: "Pexels photographer",
            source: "pexels",
          },
        ),
      ).resolves.toBe(code);
    },
  );

  it("fences but neither counts nor broadcasts a host override", async () => {
    const onApplied = vi.fn();
    const fence = vi.fn(async () => undefined);
    const broadcast = vi.fn(async () => undefined);

    await expect(
      settleGenerationPhotoCommit("host_override", {
        onApplied,
        fence,
        broadcast,
      }),
    ).resolves.toBe(true);

    expect(fence).toHaveBeenCalledOnce();
    expect(onApplied).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
