import { describe, expect, it } from "vitest";
import type { GenerationJobProgress } from "@/lib/ai/generation-job";
import { shouldAutoResumeGeneration } from "@/lib/host/generationAutoResume";

function progress(
  overrides: Partial<GenerationJobProgress> = {},
): GenerationJobProgress {
  return {
    phase: "needs_attention",
    targetCount: 20,
    writtenCount: 0,
    certifiedCount: 0,
    imageCount: 0,
    remainingCount: 20,
    attempt: 1,
    statusLine: "The question writer paused.",
    ready: false,
    ...overrides,
  };
}

describe("shouldAutoResumeGeneration", () => {
  it("resumes a provider timeout with zero saved choices before the ceiling", () => {
    expect(shouldAutoResumeGeneration(progress())).toBe(true);
  });

  it("resumes the final one-choice shortfall before the ceiling", () => {
    expect(
      shouldAutoResumeGeneration(
        progress({
          writtenCount: 20,
          certifiedCount: 19,
          imageCount: 19,
          remainingCount: 1,
          attempt: 2,
        }),
      ),
    ).toBe(true);
  });

  it("keeps attempt three on the manual recovery screen", () => {
    expect(shouldAutoResumeGeneration(progress({ attempt: 3 }))).toBe(false);
  });

  it("does not restart a completed or still-running durable job", () => {
    expect(
      shouldAutoResumeGeneration(progress({ phase: "checking" })),
    ).toBe(false);
    expect(
      shouldAutoResumeGeneration(progress({ remainingCount: 0 })),
    ).toBe(false);
  });
});
