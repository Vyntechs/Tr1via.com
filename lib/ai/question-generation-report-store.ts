import "server-only";

import type { QuestionGenerationReportInsert } from "./question-generation-report";

interface ReportInsertClient {
  from(table: string): {
    insert(row: QuestionGenerationReportInsert): PromiseLike<{
      error: { message: string } | null;
    }>;
  };
}

export async function persistQuestionGenerationReport(
  admin: ReportInsertClient,
  insert: QuestionGenerationReportInsert,
): Promise<void> {
  try {
    const { error } = await admin
      .from("question_generation_reports")
      .insert(insert);
    if (error) {
      console.warn(
        "[generate] question generation report write failed:",
        error.message,
      );
    }
  } catch (err) {
    console.warn(
      "[generate] question generation report write failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
