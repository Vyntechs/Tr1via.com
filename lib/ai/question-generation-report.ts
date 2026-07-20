import type { GeneratedQuestion } from "./generate-questions";
import { riskFlagsForQuestion, type QuestionRiskFlag } from "./question-risk-flags";
import { costUsd, type TokenUsage } from "./usage-cost";
import type { Json, QuestionGenerationReportRow } from "@/lib/supabase/types";

export type QuestionGenerationMode =
  | "initial"
  | "reroll"
  | "auto_build"
  | "unknown";

export type QuestionGenerationStatus = "completed" | "partial" | "failed";

export type QuestionRejectionReason =
  | "invalid_schema"
  | "verifier_wrong"
  | "verifier_ambiguous"
  | "missing_verdict"
  | "fact_blurb_wrong"
  | "image_required"
  | "category_mismatch"
  | "deterministic_risk"
  | "duplicate_prompt"
  | "generation_empty"
  | "max_rounds_exhausted";

export interface RejectedCandidateTrace {
  prompt: string;
  reasons: QuestionRejectionReason[];
}

export interface GenerationRoundTrace {
  round: number;
  requested: number;
  generated: number;
  accepted: number;
  rejected: RejectedCandidateTrace[];
}

export interface QuestionRiskTrace {
  prompt: string;
  flags: QuestionRiskFlag[];
}

export interface QuestionGenerationReportJson {
  reasonCounts: Partial<Record<QuestionRejectionReason, number>>;
  rounds: GenerationRoundTrace[];
  invalidCandidates: RejectedCandidateTrace[];
  riskFlags: QuestionRiskTrace[];
}

export interface QuestionGenerationReportSnapshot {
  status: QuestionGenerationStatus;
  requestedCount: number;
  acceptedCount: number;
  generatedCount: number;
  rejectedCount: number;
  rounds: number;
  verifyPasses: number;
  llmCalls: number;
  tokensIn: number;
  tokensOut: number;
  estimatedCostUsd: number;
  imageTargetCount: number;
  imageAttachedCount: number;
  imageSkippedCount: number;
  riskFlagCount: number;
  report: QuestionGenerationReportJson;
}

export interface HostQuestionAuditSummary {
  acceptedCount: number;
  generatedCount: number;
  verifyPasses: number;
  estimatedCostUsd: number;
  imageTargetCount: number;
  imageAttachedCount: number;
  riskFlagCount: number;
}

export interface QuestionGenerationReportContext {
  categoryId: string;
  gameId: string;
  nightId: string;
  hostId: string;
  categoryName: string;
  topic: string;
  mode: QuestionGenerationMode;
}

export interface QuestionGenerationReportInsert {
  category_id: string | null;
  game_id: string | null;
  night_id: string | null;
  host_id: string | null;
  category_name: string | null;
  topic: string;
  mode: QuestionGenerationMode;
  status: QuestionGenerationStatus;
  requested_count: number;
  accepted_count: number;
  generated_count: number;
  rejected_count: number;
  rounds: number;
  verify_passes: number;
  llm_calls: number;
  tokens_in: number;
  tokens_out: number;
  estimated_cost_usd: number;
  image_target_count: number;
  image_attached_count: number;
  image_skipped_count: number;
  risk_flag_count: number;
  report: Json;
}

export interface QuestionGenerationReportAccumulator {
  recordUsage(model: string, usage: TokenUsage): void;
  recordRound(round: GenerationRoundTrace): void;
  recordInvalidCandidate(prompt: string, issues: string[]): void;
  recordAcceptedQuestions(questions: GeneratedQuestion[]): void;
  recordImageTargets(count: number): void;
  recordImageAttached(): void;
  snapshot(status: QuestionGenerationStatus): QuestionGenerationReportSnapshot;
}

export function createQuestionGenerationReportAccumulator(input: {
  requestedCount: number;
  verifyPasses: number;
}): QuestionGenerationReportAccumulator {
  const rounds: GenerationRoundTrace[] = [];
  const invalidCandidates: RejectedCandidateTrace[] = [];
  const reasonCounts: Partial<Record<QuestionRejectionReason, number>> = {};
  const riskFlags: QuestionRiskTrace[] = [];
  let llmCalls = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let estimatedCostUsd = 0;
  let imageTargetCount = 0;
  let imageAttachedCount = 0;
  let acceptedQuestionCount: number | null = null;

  const countReason = (reason: QuestionRejectionReason) => {
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  };

  return {
    recordUsage(model, usage) {
      llmCalls += 1;
      tokensIn +=
        (usage.input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0);
      tokensOut += usage.output_tokens ?? 0;
      estimatedCostUsd += costUsd(model, usage);
    },
    recordRound(round) {
      rounds.push(round);
      for (const rejected of round.rejected) {
        for (const reason of rejected.reasons) countReason(reason);
      }
      if (round.generated === 0) countReason("generation_empty");
    },
    recordInvalidCandidate(prompt, _issues) {
      void _issues;
      countReason("invalid_schema");
      invalidCandidates.push({ prompt, reasons: ["invalid_schema"] });
    },
    recordAcceptedQuestions(questions) {
      acceptedQuestionCount = questions.length;
      riskFlags.length = 0;
      for (const question of questions) {
        const flags = riskFlagsForQuestion(question);
        if (flags.length > 0) riskFlags.push({ prompt: question.prompt, flags });
      }
    },
    recordImageTargets(count) {
      imageTargetCount = count;
    },
    recordImageAttached() {
      imageAttachedCount += 1;
    },
    snapshot(status) {
      const generatedCount =
        rounds.reduce((sum, round) => sum + round.generated, 0) +
        invalidCandidates.length;
      const roundAcceptedCount = rounds.reduce(
        (sum, round) => sum + round.accepted,
        0,
      );
      const acceptedCount = acceptedQuestionCount ?? roundAcceptedCount;
      const rejectedCount =
        rounds.reduce((sum, round) => sum + round.rejected.length, 0) +
        invalidCandidates.length;
      const imageSkippedCount = Math.max(0, imageTargetCount - imageAttachedCount);
      const snapshotReasonCounts = { ...reasonCounts };
      if (status === "partial" && acceptedCount < input.requestedCount) {
        snapshotReasonCounts.max_rounds_exhausted =
          (snapshotReasonCounts.max_rounds_exhausted ?? 0) + 1;
      }
      return {
        status,
        requestedCount: input.requestedCount,
        acceptedCount,
        generatedCount,
        rejectedCount,
        rounds: rounds.length,
        verifyPasses: input.verifyPasses,
        llmCalls,
        tokensIn,
        tokensOut,
        estimatedCostUsd,
        imageTargetCount,
        imageAttachedCount,
        imageSkippedCount,
        riskFlagCount: riskFlags.reduce((sum, item) => sum + item.flags.length, 0),
        report: {
          reasonCounts: snapshotReasonCounts,
          rounds,
          invalidCandidates,
          riskFlags,
        },
      };
    },
  };
}

export function hostAuditSummaryFromSnapshot(
  snapshot: QuestionGenerationReportSnapshot,
): HostQuestionAuditSummary {
  return {
    acceptedCount: snapshot.acceptedCount,
    generatedCount: snapshot.generatedCount,
    verifyPasses: snapshot.verifyPasses,
    estimatedCostUsd: snapshot.estimatedCostUsd,
    imageTargetCount: snapshot.imageTargetCount,
    imageAttachedCount: snapshot.imageAttachedCount,
    riskFlagCount: snapshot.riskFlagCount,
  };
}

export function hostAuditSummaryFromReportRow(
  row: QuestionGenerationReportRow,
): HostQuestionAuditSummary {
  return {
    acceptedCount: row.accepted_count,
    generatedCount: row.generated_count,
    verifyPasses: row.verify_passes,
    estimatedCostUsd: Number(row.estimated_cost_usd),
    imageTargetCount: row.image_target_count,
    imageAttachedCount: row.image_attached_count,
    riskFlagCount: row.risk_flag_count,
  };
}

export function questionGenerationReportInsertFromSnapshot(
  context: QuestionGenerationReportContext,
  snapshot: QuestionGenerationReportSnapshot,
): QuestionGenerationReportInsert {
  return {
    category_id: context.categoryId,
    game_id: context.gameId,
    night_id: context.nightId,
    host_id: context.hostId,
    category_name: context.categoryName,
    topic: context.topic,
    mode: context.mode,
    status: snapshot.status,
    requested_count: snapshot.requestedCount,
    accepted_count: snapshot.acceptedCount,
    generated_count: snapshot.generatedCount,
    rejected_count: snapshot.rejectedCount,
    rounds: snapshot.rounds,
    verify_passes: snapshot.verifyPasses,
    llm_calls: snapshot.llmCalls,
    tokens_in: snapshot.tokensIn,
    tokens_out: snapshot.tokensOut,
    estimated_cost_usd: Number(snapshot.estimatedCostUsd.toFixed(4)),
    image_target_count: snapshot.imageTargetCount,
    image_attached_count: snapshot.imageAttachedCount,
    image_skipped_count: snapshot.imageSkippedCount,
    risk_flag_count: snapshot.riskFlagCount,
    report: snapshot.report as unknown as Json,
  };
}
