import "server-only";

import type { Json } from "@/lib/supabase/types";
import type { GeneratedQuestion } from "./generate-questions";
import type { QuestionGenerationJobRow } from "./generation-job";
import type { QuestionGenerationReportInsert } from "./question-generation-report";

interface GenerationRpcError {
  message: string;
}

export interface GenerationRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: GenerationRpcError | null }>;
}

interface EffectEnvelope {
  applied: boolean;
  code: "applied" | "stale" | "conflict";
  job?: QuestionGenerationJobRow;
}

function envelope(data: unknown, operation: string): EffectEnvelope {
  if (!data || typeof data !== "object") {
    throw new Error(`${operation} returned no result`);
  }
  const value = data as Partial<EffectEnvelope>;
  if (typeof value.applied !== "boolean" || typeof value.code !== "string") {
    throw new Error(`${operation} returned an invalid result`);
  }
  return value as EffectEnvelope;
}

async function call(
  client: GenerationRpcClient,
  name: string,
  args: Record<string, unknown>,
): Promise<EffectEnvelope> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  return envelope(data, name);
}

export async function beginQuestionGeneration(
  client: GenerationRpcClient,
  input: {
    categoryId: string;
    targetCount: number;
    flavor: Json;
  },
): Promise<QuestionGenerationJobRow | null> {
  const result = await call(client, "begin_question_generation", {
    p_category_id: input.categoryId,
    p_target_count: input.targetCount,
    p_flavor: input.flavor,
  });
  return result.applied && result.job ? result.job : null;
}

export async function claimQuestionGenerationResume(
  client: GenerationRpcClient,
  input: {
    categoryId: string;
    observedAttempt: number;
    observedPhase: string;
    observedHeartbeatAt: string;
    flavor: Json;
  },
): Promise<QuestionGenerationJobRow | null> {
  const result = await call(client, "claim_question_generation_resume", {
    p_category_id: input.categoryId,
    p_observed_attempt: input.observedAttempt,
    p_observed_phase: input.observedPhase,
    p_observed_heartbeat_at: input.observedHeartbeatAt,
    p_flavor: input.flavor,
  });
  return result.applied && result.job ? result.job : null;
}

export interface PersistedGeneratedQuestion {
  id: string;
  q: GeneratedQuestion;
  hasImage: false;
}

export async function commitGenerationQuestions(
  client: GenerationRpcClient,
  input: {
    categoryId: string;
    attempt: number;
    questions: GeneratedQuestion[];
    deleteIds?: string[];
  },
): Promise<PersistedGeneratedQuestion[] | null> {
  const rows = input.questions.map((q) => ({ id: crypto.randomUUID(), ...q }));
  const result = await call(client, "commit_generation_questions", {
    p_category_id: input.categoryId,
    p_attempt: input.attempt,
    p_questions: rows,
    p_delete_ids: input.deleteIds ?? [],
  });
  if (!result.applied) return null;
  return rows.map(({ id, ...q }) => ({
    id,
    q: q as GeneratedQuestion,
    hasImage: false,
  }));
}

export async function commitGenerationPhoto(
  client: GenerationRpcClient,
  input: {
    categoryId: string;
    attempt: number;
    questionId: string;
    imageUrl: string;
    attribution: string | null;
    source: string;
  },
): Promise<boolean> {
  const result = await call(client, "commit_generation_photo", {
    p_category_id: input.categoryId,
    p_attempt: input.attempt,
    p_question_id: input.questionId,
    p_image_url: input.imageUrl,
    p_image_attribution: input.attribution,
    p_image_source: input.source,
  });
  return result.applied;
}

export async function completeQuestionGeneration(
  client: GenerationRpcClient,
  input: {
    categoryId: string;
    attempt: number;
    report: QuestionGenerationReportInsert;
    assignments: Array<{ id: string; pointValue: number }> | null;
    categoryState: "review" | "ready";
    writtenCount: number;
    certifiedCount: number;
    imageCount: number;
  },
): Promise<boolean> {
  const result = await call(client, "complete_question_generation", {
    p_category_id: input.categoryId,
    p_attempt: input.attempt,
    p_report: input.report,
    p_assignments: input.assignments,
    p_category_state: input.categoryState,
    p_written_count: input.writtenCount,
    p_certified_count: input.certifiedCount,
    p_image_count: input.imageCount,
  });
  return result.applied;
}

export async function failQuestionGeneration(
  client: GenerationRpcClient,
  input: {
    categoryId: string;
    attempt: number;
    restoreState: "review" | null;
    error: string;
  },
): Promise<boolean> {
  const result = await call(client, "fail_question_generation", {
    p_category_id: input.categoryId,
    p_attempt: input.attempt,
    p_restore_state: input.restoreState,
    p_error: input.error,
  });
  return result.applied;
}
