import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistQuestionGenerationReport } from "@/lib/ai/question-generation-report-store";
import type { QuestionGenerationReportInsert } from "@/lib/ai/question-generation-report";

const insert: QuestionGenerationReportInsert = {
  category_id: "11111111-1111-1111-1111-111111111111",
  game_id: "22222222-2222-2222-2222-222222222222",
  night_id: "33333333-3333-3333-3333-333333333333",
  host_id: "44444444-4444-4444-4444-444444444444",
  category_name: "Movies",
  topic: "Pixar",
  mode: "initial",
  status: "completed",
  requested_count: 20,
  accepted_count: 20,
  generated_count: 22,
  rejected_count: 2,
  rounds: 2,
  verify_passes: 2,
  llm_calls: 4,
  tokens_in: 100,
  tokens_out: 50,
  estimated_cost_usd: 0.1234,
  image_target_count: 20,
  image_attached_count: 18,
  image_skipped_count: 2,
  risk_flag_count: 3,
  report: { reasonCounts: {} },
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("persistQuestionGenerationReport", () => {
  it("inserts the report row", async () => {
    const insertMock = vi.fn(async () => ({ error: null }));
    const admin = { from: vi.fn(() => ({ insert: insertMock })) };

    await persistQuestionGenerationReport(admin, insert);

    expect(admin.from).toHaveBeenCalledWith("question_generation_reports");
    expect(insertMock).toHaveBeenCalledWith(insert);
  });

  it("swallows insert failures and logs a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const admin = {
      from: vi.fn(() => ({
        insert: vi.fn(async () => ({ error: { message: "table unavailable" } })),
      })),
    };

    await expect(
      persistQuestionGenerationReport(admin, insert),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[generate] question generation report write failed:",
      "table unavailable",
    );
  });
});
