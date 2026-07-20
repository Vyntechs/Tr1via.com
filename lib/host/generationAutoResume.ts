import type { GenerationJobProgress } from "@/lib/ai/generation-job";

export const MAX_AUTOMATIC_GENERATION_ATTEMPTS = 3;

/** A durable stopped job gets at most two automatic recovery starts. */
export function shouldAutoResumeGeneration(
  progress: GenerationJobProgress,
): boolean {
  return (
    progress.phase === "needs_attention" &&
    progress.remainingCount > 0 &&
    progress.attempt < MAX_AUTOMATIC_GENERATION_ATTEMPTS
  );
}
