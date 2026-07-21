export type GenerationJobPhase =
  | "queued"
  | "writing"
  | "checking"
  | "repairing"
  | "images"
  | "ready"
  | "needs_attention";

export const MIN_PLAYABLE_QUESTIONS = 7;

export interface QuestionGenerationJobRow {
  id: string;
  category_id: string;
  game_id: string;
  night_id: string;
  host_id: string;
  phase: GenerationJobPhase;
  target_count: number;
  written_count: number;
  certified_count: number;
  image_count: number;
  attempt: number;
  last_error: string | null;
  heartbeat_at: string;
  created_at: string;
  updated_at: string;
}

export interface GenerationJobProgress {
  phase: GenerationJobPhase;
  attempt: number;
  targetCount: number;
  writtenCount: number;
  certifiedCount: number;
  imageCount: number;
  remainingCount: number;
  statusLine: string;
  ready: boolean;
}

interface GenerationJobError {
  message: string;
}

interface GenerationJobResult<T> {
  data: T | null;
  error: GenerationJobError | null;
}

export interface GenerationJobClient {
  from(table: "question_generation_jobs"): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<GenerationJobResult<QuestionGenerationJobRow>>;
      };
    };
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): Promise<GenerationJobResult<unknown>>;
    };
  };
}

export async function readGenerationJob(
  client: GenerationJobClient,
  categoryId: string,
): Promise<QuestionGenerationJobRow | null> {
  const { data, error } = await client
    .from("question_generation_jobs")
    .select("*")
    .eq("category_id", categoryId)
    .maybeSingle();
  if (error) throw new Error(`failed to read generation progress: ${error.message}`);
  return data;
}

/** Returns false when a replacement attempt has fenced this worker out. */
export async function updateGenerationJobForAttempt(
  client: GenerationJobClient,
  categoryId: string,
  attempt: number,
  patch: GenerationJobPatch,
  nowIso = new Date().toISOString(),
): Promise<boolean> {
  const table = client.from("question_generation_jobs") as unknown as {
    update(values: Record<string, unknown>): {
      eq(column: string, value: string | number): {
        eq(column: string, value: string | number): {
          select(columns: string): {
            maybeSingle(): Promise<GenerationJobResult<QuestionGenerationJobRow>>;
          };
        };
      };
    };
  };
  const { data, error } = await table
    .update({ ...patch, heartbeat_at: nowIso, updated_at: nowIso })
    .eq("category_id", categoryId)
    .eq("attempt", attempt)
    .select("*")
    .maybeSingle();
  if (error) {
    throw new Error(`failed to update generation progress: ${error.message}`);
  }
  return data !== null;
}

type GenerationJobPatch = Partial<
  Pick<
    QuestionGenerationJobRow,
    | "phase"
    | "written_count"
    | "certified_count"
    | "image_count"
    | "last_error"
  >
>;

export async function updateGenerationJob(
  client: GenerationJobClient,
  categoryId: string,
  patch: GenerationJobPatch,
  nowIso = new Date().toISOString(),
): Promise<void> {
  const { error } = await client
    .from("question_generation_jobs")
    .update({
      ...patch,
      heartbeat_at: nowIso,
      updated_at: nowIso,
    })
    .eq("category_id", categoryId);
  if (error) throw new Error(`failed to update generation progress: ${error.message}`);
}

export function generationProgressFromRow(
  row: QuestionGenerationJobRow,
  nowMs = Date.now(),
  staleAfterMs = 90_000,
): GenerationJobProgress {
  const targetCount = Math.max(1, row.target_count);
  const writtenCount = Math.max(0, row.written_count);
  const certifiedCount = Math.min(targetCount, Math.max(0, row.certified_count));
  const imageCount = Math.min(certifiedCount, Math.max(0, row.image_count));
  const remainingCount = Math.max(0, targetCount - certifiedCount);
  const heartbeatMs = Date.parse(row.heartbeat_at);
  const terminal = row.phase === "ready" || row.phase === "needs_attention";
  const stale =
    !terminal &&
    Number.isFinite(heartbeatMs) &&
    nowMs - heartbeatMs > staleAfterMs;
  const invalidReady =
    row.phase === "ready" && certifiedCount < MIN_PLAYABLE_QUESTIONS;
  const phase: GenerationJobPhase =
    stale || invalidReady ? "needs_attention" : row.phase;

  const safeCount = `${certifiedCount} certified ${certifiedCount === 1 ? "choice is" : "choices are"} safe`;
  let statusLine: string;
  if (stale) {
    statusLine = `Generation stopped updating. Your ${safeCount}.`;
  } else if (invalidReady) {
    statusLine = `${remainingCount} question ${remainingCount === 1 ? "choice still needs" : "choices still need"} checking.`;
  } else {
    switch (phase) {
      case "queued":
        statusLine = "Waiting for the question writer";
        break;
      case "writing":
        statusLine = `${Math.min(targetCount, writtenCount)} of ${targetCount} question choices written`;
        break;
      case "checking":
        statusLine = `${certifiedCount} of ${targetCount} question choices certified`;
        break;
      case "repairing":
        statusLine = `${remainingCount} question ${remainingCount === 1 ? "choice" : "choices"} still needed`;
        break;
      case "images":
        statusLine = `${imageCount} of ${certifiedCount} optional images added`;
        break;
      case "ready":
        statusLine = `${certifiedCount} certified question choices ready`;
        break;
      case "needs_attention":
        statusLine = row.last_error
          ? `${row.last_error} Your ${safeCount}.`
          : `Generation needs attention. Your ${safeCount}.`;
        break;
    }
  }

  return {
    phase,
    attempt: row.attempt,
    targetCount,
    writtenCount,
    certifiedCount,
    imageCount,
    remainingCount,
    statusLine,
    ready: phase === "ready" && certifiedCount >= MIN_PLAYABLE_QUESTIONS,
  };
}
