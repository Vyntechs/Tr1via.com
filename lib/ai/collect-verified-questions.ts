// Generate → verify → regenerate loop. Returns only questions that EVERY
// distinct verify pass agrees are correct AND non-ambiguous. Regenerates
// (avoiding prompts already shown) until `target` clean questions exist or
// `maxRounds` is hit. Returns however many passed — fewer, never wrong.
//
// Why multiple passes: pass 0 derives the answer without seeing the proposed
// answer; later passes actively challenge ambiguity and supporting facts.
// Agreement between distinct checks drops contestable questions instead of
// counting repeated, correlated model calls as independent evidence. It cannot
// reach 0% — some trivia is inherently debatable — so the make-good adjustment
// path remains the catch for the rare residual.
//
// Pure orchestration: `generate` and `verify` are injected so this is unit-
// tested without the network. The route supplies the real implementations.

import type { GeneratedQuestion } from "./generate-questions";
import type { AnswerVerdict } from "./verify-answers";
import { blockingRiskFlagsForQuestion } from "./question-risk-flags";

export type CollectVerifiedRejectionReason =
  | "verifier_wrong"
  | "verifier_ambiguous"
  | "missing_verdict"
  | "fact_blurb_wrong"
  | "image_required"
  | "category_mismatch"
  | "deterministic_risk";

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

export interface VerifiedQuestionClassification {
  acceptedIndexes: number[];
  rejected: Array<CollectVerifiedRejectedCandidate & { index: number }>;
}

/** Live progress hooks handed to each `generate` call. */
export interface CollectVerifiedWriteProgress {
  /** Questions written so far in THIS batch (raw count from the writer). */
  onWritten: (writtenInBatch: number) => void;
}

/** Live progress hooks handed to each `verify` call. */
export interface CollectVerifiedCheckProgress {
  /** Questions checked so far in this pass, out of the batch size. */
  onChecked: (checkedSoFar: number, total: number) => void;
}

export interface CollectVerifiedOptions {
  target: number;
  maxRounds: number;
  /** Previously certified questions restored from durable storage. */
  initialClean?: GeneratedQuestion[];
  /** Distinct verify passes that must ALL agree a question is clean. Default 2. */
  verifyPasses?: number;
  /**
   * Produce a fresh batch. `avoidPrompts` are prompts already shown (skip them);
   * `need` is how many MORE clean questions are still required, so a refill round
   * can request just the shortfall instead of a whole new batch.
   */
  generate: (
    avoidPrompts: string[],
    need: number,
    progress: CollectVerifiedWriteProgress,
  ) => Promise<GeneratedQuestion[]>;
  verify: (
    questions: GeneratedQuestion[],
    passIndex: number,
    progress: CollectVerifiedCheckProgress,
  ) => Promise<AnswerVerdict[]>;
  /**
   * Optional: live writing count across the whole run. A refill round
   * continues from what is already certified (`certified + writtenInBatch`),
   * capped at `target`, so the number the host sees never jumps backwards.
   */
  onWritten?: (count: number) => void;
  /**
   * Optional: live checking count. `pass` is 1 for the blind pass (index 0)
   * and 2 for the adversarial pass; the two run concurrently, so each
   * reports its own climb over the same `total`.
   */
  onChecked?: (checked: number, total: number, pass: 1 | 2) => void;
  /** Persist each newly accepted batch before the next refill round starts. */
  onAccepted?: (questions: GeneratedQuestion[]) => void | Promise<void>;
  /** Optional: observe per-round verification quality. No-op if omitted. */
  onRoundComplete?: (
    event: CollectVerifiedRoundEvent,
  ) => void | Promise<void>;
}

export async function collectVerifiedQuestions(
  opts: CollectVerifiedOptions,
): Promise<GeneratedQuestion[]> {
  const passes = opts.verifyPasses ?? 2;
  const clean: GeneratedQuestion[] = (opts.initialClean ?? []).slice(
    0,
    opts.target,
  );
  const seenPrompts: string[] = clean.map((question) => question.prompt);

  for (let round = 0; round < opts.maxRounds && clean.length < opts.target; round++) {
    // Refill rounds only ask for the remaining gap, so topping 19 -> 20 costs
    // one extra question + its verify passes, not a whole fresh batch.
    const need = opts.target - clean.length;
    const certifiedSoFar = clean.length;
    const batch = await opts.generate([...seenPrompts], need, {
      onWritten: (writtenInBatch) =>
        opts.onWritten?.(
          Math.min(opts.target, certifiedSoFar + Math.max(0, writtenInBatch)),
        ),
    });
    if (batch.length === 0) {
      await opts.onRoundComplete?.({
        round: round + 1,
        requested: need,
        generated: 0,
        accepted: 0,
        rejected: [],
      });
      break;
    }
    for (const q of batch) seenPrompts.push(q.prompt);

    // Distinct verify passes, run concurrently. The pass identity lets the
    // caller make pass 0 blind and later passes adversarial instead of asking
    // the same anchored model question twice.
    const passResults = await Promise.all(
      Array.from({ length: passes }, (_, passIndex) =>
        opts.verify(batch, passIndex, {
          onChecked: (checked, total) =>
            opts.onChecked?.(checked, total, passIndex === 0 ? 1 : 2),
        }),
      ),
    );
    const classification = classifyVerifiedQuestions(batch, passResults);
    const accepted: GeneratedQuestion[] = [];
    for (const index of classification.acceptedIndexes) {
      if (clean.length >= opts.target) break;
      const question = batch[index]!;
      clean.push(question);
      accepted.push(question);
    }
    const rejected = classification.rejected.map(({ prompt, reasons }) => ({
      prompt,
      reasons,
    }));
    if (accepted.length > 0) {
      await opts.onAccepted?.(accepted);
    }
    await opts.onRoundComplete?.({
      round: round + 1,
      requested: need,
      generated: batch.length,
      accepted: accepted.length,
      rejected,
    });
  }

  return clean.slice(0, opts.target);
}

export function classifyVerifiedQuestions(
  questions: GeneratedQuestion[],
  passResults: AnswerVerdict[][],
): VerifiedQuestionClassification {
  const verdictsByPass = passResults.map(
    (verdicts) => new Map(verdicts.map((verdict) => [verdict.index, verdict])),
  );
  const acceptedIndexes: number[] = [];
  const rejected: VerifiedQuestionClassification["rejected"] = [];

  questions.forEach((question, index) => {
    const reasons = rejectionReasonsForIndex(verdictsByPass, index);
    if (blockingRiskFlagsForQuestion(question).length > 0) {
      reasons.push("deterministic_risk");
    }
    if (reasons.length === 0) {
      acceptedIndexes.push(index);
    } else {
      rejected.push({ index, prompt: question.prompt, reasons });
    }
  });

  return { acceptedIndexes, rejected };
}

function rejectionReasonsForIndex(
  verdictsByPass: Array<Map<number, AnswerVerdict>>,
  index: number,
): CollectVerifiedRejectionReason[] {
  let verifierWrong = false;
  let verifierAmbiguous = false;
  let missingVerdict = false;
  let factBlurbWrong = false;
  let imageRequired = false;
  let categoryMismatch = false;

  for (const byIndex of verdictsByPass) {
    const verdict = byIndex.get(index);
    if (!verdict) {
      missingVerdict = true;
      continue;
    }
    if (!verdict.markedAnswerIsCorrect) verifierWrong = true;
    if (verdict.ambiguous) verifierAmbiguous = true;
    // Blind verification deliberately does not see the fact blurb, so null
    // means "not assessed in this pass." The adversarial pass must assess it.
    if (verdict.factBlurbIsCorrect === false) factBlurbWrong = true;
    if (!verdict.answerableWithoutImage) imageRequired = true;
    if (!verdict.fitsRequestedTopic) categoryMismatch = true;
  }

  const reasons: CollectVerifiedRejectionReason[] = [];
  if (verifierWrong) reasons.push("verifier_wrong");
  if (verifierAmbiguous) reasons.push("verifier_ambiguous");
  if (missingVerdict) reasons.push("missing_verdict");
  if (factBlurbWrong) reasons.push("fact_blurb_wrong");
  if (imageRequired) reasons.push("image_required");
  if (categoryMismatch) reasons.push("category_mismatch");
  return reasons;
}
