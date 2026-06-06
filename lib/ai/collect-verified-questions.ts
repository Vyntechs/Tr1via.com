// Generate → verify → regenerate loop. Returns only questions that EVERY
// independent verify pass agrees are correct AND non-ambiguous. Regenerates
// (avoiding prompts already shown) until `target` clean questions exist or
// `maxRounds` is hit. Returns however many passed — fewer, never wrong.
//
// Why multiple passes: a single AI fact-check has wobble on borderline
// questions — it can bless one and flag it the next. Requiring agreement
// across `verifyPasses` independent checks halves the slip rate (measured
// ~5% -> ~2.5% across a broad topic battery) AND drops the genuinely
// contestable questions, not just the clearly wrong ones. It cannot reach 0%
// — some trivia is inherently debatable — so the make-good adjustment path
// remains the catch for the rare residual.
//
// Pure orchestration: `generate` and `verify` are injected so this is unit-
// tested without the network. The route supplies the real implementations.

import type { GeneratedQuestion } from "./generate-questions";
import type { AnswerVerdict } from "./verify-answers";

export interface CollectVerifiedOptions {
  target: number;
  maxRounds: number;
  /** Independent verify passes that must ALL agree a question is clean. Default 2. */
  verifyPasses?: number;
  generate: (avoidPrompts: string[]) => Promise<GeneratedQuestion[]>;
  verify: (questions: GeneratedQuestion[]) => Promise<AnswerVerdict[]>;
}

export async function collectVerifiedQuestions(
  opts: CollectVerifiedOptions,
): Promise<GeneratedQuestion[]> {
  const passes = opts.verifyPasses ?? 2;
  const clean: GeneratedQuestion[] = [];
  const seenPrompts: string[] = [];

  for (let round = 0; round < opts.maxRounds && clean.length < opts.target; round++) {
    const batch = await opts.generate([...seenPrompts]);
    if (batch.length === 0) break;
    for (const q of batch) seenPrompts.push(q.prompt);

    // Independent verify passes, run concurrently. Keep a question only if
    // EVERY pass marks it correct and unambiguous.
    const passResults = await Promise.all(
      Array.from({ length: passes }, () => opts.verify(batch)),
    );
    const cleanByPass = passResults.map((verdicts) => {
      const byIndex = new Map(verdicts.map((v) => [v.index, v]));
      return (i: number) => {
        const v = byIndex.get(i);
        return !!v && v.markedAnswerIsCorrect && !v.ambiguous;
      };
    });
    batch.forEach((q, i) => {
      if (cleanByPass.every((isClean) => isClean(i))) clean.push(q);
    });
  }

  return clean.slice(0, opts.target);
}
