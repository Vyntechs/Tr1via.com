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

  it("re-certifies persisted AI rows and fences deletion of only rejected IDs", () => {
    expect(route).toContain("classifyVerifiedQuestions");
    expect(route).toContain("certifiedStoredQuestions");
    expect(route).toContain("rejectedStoredIds");
    expect(route).toMatch(/commitGenerationQuestions\(rpcClient, \{[\s\S]*?questions: \[\],[\s\S]*?deleteIds: rejectedStoredIds/);
    expect(route).toContain("insertedQuestions.push(...certifiedStoredQuestions)");
    expect(route).toContain("initialClean: certifiedStoredQuestions.map");
    expect(route).not.toContain("initialClean: storedQuestions.map");
  });

  it("restores photo intent and excludes every category image during attachment", () => {
    expect(route).toContain(
      '.select("id, prompt, options, correct_index, difficulty, fact_blurb, image_url, photo_query")',
    );
    expect(route).toContain("photoQuery: row.photo_query?.trim() || opts.topic");
    expect(route).toContain("imageUrl: row.image_url");
    expect(route).toContain("seedCategoryImageUrls(");
    expect(route).toContain("excludeImageUrls: usedImageUrls");
    expect(route).toContain("recordCategoryImageUrl(usedImageUrls, photo.imageUrl)");
  });

  it("finishes playable partial sets with their actual certified count", () => {
    expect(route).toContain("generated.length < MIN_PLAYABLE_QUESTIONS");
    expect(route).toContain("writtenCount: generated.length");
    expect(route).toContain("certifiedCount: generated.length");
    expect(route).not.toContain("writtenCount: 20");
    expect(route).not.toContain("certifiedCount: 20");
  });
});
