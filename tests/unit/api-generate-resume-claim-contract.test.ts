import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  "app/api/categories/[id]/generate/route.ts",
  "utf8",
);

describe("category generation resume claim wiring", () => {
  it("claims a stale durable row before it schedules a resumed worker", () => {
    expect(route).toContain("claimQuestionGenerationResume");
    expect(route).toContain("observedHeartbeatAt: existingJob!.heartbeat_at");
    expect(route).toMatch(/const claimed = await claimQuestionGenerationResume\([\s\S]*?if \(!claimed\)\s*return conflict/);
    expect(route).toContain("attempt: job.attempt");
    expect(route).toContain("commitGenerationQuestions");
    expect(route).toContain("commitGenerationPhoto");
    expect(route).toContain("completeQuestionGeneration");
    expect(route).toContain("failQuestionGeneration");
  });
});
