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

export type CollectVerifiedRejectionReason =
  | "verifier_wrong"
  | "verifier_ambiguous"
  | "missing_verdict";

export interface CollectVerifiedRejectedCandidate {
  prompt: string;
  reasons: CollectVerifiedRejectionReason[];
}

export interface CollectVerifiedRoundEvent {
  round: number;
  requested: number;
  generated: number;
  accepted: number;
  rejected: CollectVerifiedRejectedCandidate[];
}

export interface CollectVerifiedOptions {
  target: number;
  maxRounds: number;
  /** Independent verify passes that must ALL agree a question is clean. Default 2. */
  verifyPasses?: number;
  /**
   * Produce a fresh batch. `avoidPrompts` are prompts already shown (skip them);
   * `need` is how many MORE clean questions are still required, so a refill round
   * can request just the shortfall instead of a whole new batch.
   */
  generate: (avoidPrompts: string[], need: number) => Promise<GeneratedQuestion[]>;
  verify: (questions: GeneratedQuestion[]) => Promise<AnswerVerdict[]>;
  /** Optional: observe per-round verification quality. No-op if omitted. */
  onRoundComplete?: (event: CollectVerifiedRoundEvent) => void;
}

export async function collectVerifiedQuestions(
  opts: CollectVerifiedOptions,
): Promise<GeneratedQuestion[]> {
  const passes = opts.verifyPasses ?? 2;
  const clean: GeneratedQuestion[] = [];
  const seenPrompts: string[] = [];

  for (let round = 0; round < opts.maxRounds && clean.length < opts.target; round++) {
    // Refill rounds only ask for the remaining gap, so topping 19 -> 20 costs
    // one extra question + its verify passes, not a whole fresh batch.
    const need = opts.target - clean.length;
    const batch = await opts.generate([...seenPrompts], need);
    if (batch.length === 0) {
      opts.onRoundComplete?.({
        round: round + 1,
        requested: need,
        generated: 0,
        accepted: 0,
        rejected: [],
      });
      break;
    }
    for (const q of batch) seenPrompts.push(q.prompt);

    // Independent verify passes, run concurrently. Keep a question only if
    // EVERY pass marks it correct and unambiguous.
    const passResults = await Promise.all(
      Array.from({ length: passes }, () => opts.verify(batch)),
    );
    const verdictsByPass = passResults.map(
      (verdicts) => new Map(verdicts.map((v) => [v.index, v])),
    );
    const accepted: GeneratedQuestion[] = [];
    const rejected: CollectVerifiedRejectedCandidate[] = [];
    batch.forEach((q, i) => {
      const reasons = rejectionReasonsForIndex(verdictsByPass, i);
      if (reasons.length === 0) {
        clean.push(q);
        accepted.push(q);
      } else {
        rejected.push({ prompt: q.prompt, reasons });
      }
    });
    opts.onRoundComplete?.({
      round: round + 1,
      requested: need,
      generated: batch.length,
      accepted: accepted.length,
      rejected,
    });
  }

  return clean.slice(0, opts.target);
}

function rejectionReasonsForIndex(
  verdictsByPass: Array<Map<number, AnswerVerdict>>,
  index: number,
): CollectVerifiedRejectionReason[] {
  let verifierWrong = false;
  let verifierAmbiguous = false;
  let missingVerdict = false;

  for (const byIndex of verdictsByPass) {
    const verdict = byIndex.get(index);
    if (!verdict) {
      missingVerdict = true;
      continue;
    }
    if (!verdict.markedAnswerIsCorrect) verifierWrong = true;
    if (verdict.ambiguous) verifierAmbiguous = true;
  }

  const reasons: CollectVerifiedRejectionReason[] = [];
  if (verifierWrong) reasons.push("verifier_wrong");
  if (verifierAmbiguous) reasons.push("verifier_ambiguous");
  if (missingVerdict) reasons.push("missing_verdict");
  return reasons;
}
