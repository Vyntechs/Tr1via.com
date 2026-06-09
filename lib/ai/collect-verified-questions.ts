// Generate → verify → regenerate loop. Returns only questions an independent
// verifier marked correct AND non-ambiguous. Regenerates (avoiding prompts
// already shown to the verifier) until `target` clean questions exist or
// `maxRounds` is hit. Returns however many passed — fewer, never wrong.
//
// Pure orchestration: `generate` and `verify` are injected so this is unit-
// tested without the network. The route supplies the real implementations.

import type { GeneratedQuestion } from "./generate-questions";
import type { AnswerVerdict } from "./verify-answers";

export interface CollectVerifiedOptions {
  target: number;
  maxRounds: number;
  generate: (avoidPrompts: string[]) => Promise<GeneratedQuestion[]>;
  verify: (questions: GeneratedQuestion[]) => Promise<AnswerVerdict[]>;
}

export async function collectVerifiedQuestions(
  opts: CollectVerifiedOptions,
): Promise<GeneratedQuestion[]> {
  const clean: GeneratedQuestion[] = [];
  const seenPrompts: string[] = [];

  for (let round = 0; round < opts.maxRounds && clean.length < opts.target; round++) {
    const batch = await opts.generate([...seenPrompts]);
    if (batch.length === 0) break;
    for (const q of batch) seenPrompts.push(q.prompt);

    const verdicts = await opts.verify(batch);
    const byIndex = new Map(verdicts.map((v) => [v.index, v]));
    batch.forEach((q, i) => {
      const v = byIndex.get(i);
      if (v && v.markedAnswerIsCorrect && !v.ambiguous) clean.push(q);
    });
  }

  return clean.slice(0, opts.target);
}
