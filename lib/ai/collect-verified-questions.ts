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
// The free word check (`blockingRiskFlagsForQuestion`) runs BEFORE any paid
// verify call: a question it would reject anyway never costs a verify call.
// It looks only at the question's own text, so running it first cannot change
// which questions end up accepted.
//
// The paid passes then run ONE AFTER ANOTHER, and only questions that passed
// every earlier pass go on to the next. Because a question must pass every pass
// to be accepted, this accepts exactly the same questions as running the passes
// side by side — it just stops paying to check a question once it has failed.
//
// Clock: slow builds can run into the platform's time limit, so the caller may
// give a start time and a cutoff. Before each round, if more time than the
// cutoff has passed, no new round is started: the loop stops and returns the
// questions already certified (they were also saved round by round through
// `onAccepted`). A round already under way is never interrupted. Nothing else
// about which questions are accepted changes.
//
// Pure orchestration: `generate`, `verify` and the clock are injected so this
// is unit-tested without the network. The route supplies the real ones.

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
  /** How long this round took (write + checks + save), in milliseconds. */
  durationMs: number;
}

export interface VerifiedQuestionClassification {
  acceptedIndexes: number[];
  rejected: Array<CollectVerifiedRejectedCandidate & { index: number }>;
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
  generate: (avoidPrompts: string[], need: number) => Promise<GeneratedQuestion[]>;
  verify: (
    questions: GeneratedQuestion[],
    passIndex: number,
  ) => Promise<AnswerVerdict[]>;
  /** Persist each newly accepted batch before the next refill round starts. */
  onAccepted?: (questions: GeneratedQuestion[]) => void | Promise<void>;
  /** Optional: observe per-round verification quality. No-op if omitted. */
  onRoundComplete?: (
    event: CollectVerifiedRoundEvent,
  ) => void | Promise<void>;
  /** Clock in milliseconds. Defaults to `Date.now`; tests pass a pretend one. */
  now?: () => number;
  /** When the whole build began (same clock as `now`). Needed for the cutoff. */
  startedAtMs?: number;
  /**
   * Cutoff: once more than this many ms have passed since `startedAtMs`, do not
   * start another round. Needs `startedAtMs`; with neither set there is no cutoff.
   */
  stopRefillingAfterMs?: number;
  /**
   * Second cutoff, for rounds that cannot be interrupted once started: do not
   * start another round if the time already spent plus how long the previous
   * round took would go past this many ms since `startedAtMs`. Needs
   * `startedAtMs` and at least one finished round, so round 1 always runs.
   * Works alongside `stopRefillingAfterMs`; either one can end the loop.
   */
  stopRefillingIfRoundWouldEndAfterMs?: number;
  /** Called once if a cutoff ended the loop early. `round` is the one skipped. */
  onRefillStopped?: (event: {
    round: number;
    elapsedMs: number;
  }) => void | Promise<void>;
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
  const now = opts.now ?? Date.now;
  // How long the last finished round took; unknown until round 1 is done.
  let previousRoundMs: number | undefined;

  for (let round = 0; round < opts.maxRounds && clean.length < opts.target; round++) {
    const roundStartedAtMs = now();
    const elapsedMs =
      opts.startedAtMs === undefined ? undefined : roundStartedAtMs - opts.startedAtMs;
    if (
      elapsedMs !== undefined &&
      ((opts.stopRefillingAfterMs !== undefined &&
        elapsedMs > opts.stopRefillingAfterMs) ||
        (opts.stopRefillingIfRoundWouldEndAfterMs !== undefined &&
          previousRoundMs !== undefined &&
          elapsedMs + previousRoundMs > opts.stopRefillingIfRoundWouldEndAfterMs))
    ) {
      await opts.onRefillStopped?.({
        round: round + 1,
        elapsedMs,
      });
      break;
    }
    // Refill rounds only ask for the remaining gap, so topping 19 -> 20 costs
    // one extra question + its verify passes, not a whole fresh batch.
    const need = opts.target - clean.length;
    const batch = await opts.generate([...seenPrompts], need);
    if (batch.length === 0) {
      await opts.onRoundComplete?.({
        round: round + 1,
        requested: need,
        generated: 0,
        accepted: 0,
        rejected: [],
        durationMs: now() - roundStartedAtMs,
      });
      break;
    }
    for (const q of batch) seenPrompts.push(q.prompt);

    const classification = await certifyBatch(batch, passes, opts.verify);
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
    previousRoundMs = now() - roundStartedAtMs;
    await opts.onRoundComplete?.({
      round: round + 1,
      requested: need,
      generated: batch.length,
      accepted: accepted.length,
      rejected,
      durationMs: previousRoundMs,
    });
  }

  return clean.slice(0, opts.target);
}

/**
 * Free word check first, then the paid verify passes on what is left.
 * Returns the same shape as `classifyVerifiedQuestions`, with every index
 * pointing into the original `batch`.
 */
async function certifyBatch(
  batch: GeneratedQuestion[],
  passes: number,
  verify: CollectVerifiedOptions["verify"],
): Promise<VerifiedQuestionClassification> {
  const checkable: number[] = [];
  const blocked: Array<CollectVerifiedRejectedCandidate & { index: number }> = [];
  batch.forEach((question, index) => {
    if (blockingRiskFlagsForQuestion(question).length > 0) {
      blocked.push({
        index,
        prompt: question.prompt,
        reasons: ["deterministic_risk"],
      });
    } else {
      checkable.push(index);
    }
  });

  // Distinct verify passes, run one after another. The pass identity lets the
  // caller make pass 0 blind and later passes adversarial instead of asking
  // the same anchored model question twice. Each pass sees only the questions
  // still standing; its verdict indexes are positions within that subset.
  let alive = checkable;
  const failed: Array<CollectVerifiedRejectedCandidate & { index: number }> = [];
  for (let passIndex = 0; passIndex < passes && alive.length > 0; passIndex++) {
    const verdicts = await verify(
      alive.map((index) => batch[index]!),
      passIndex,
    );
    const byLocalIndex = new Map(
      verdicts.map((verdict) => [verdict.index, verdict]),
    );
    const standing: number[] = [];
    alive.forEach((batchIndex, localIndex) => {
      const reasons = rejectionReasonsForVerdicts([byLocalIndex.get(localIndex)]);
      if (reasons.length === 0) {
        standing.push(batchIndex);
      } else {
        failed.push({
          index: batchIndex,
          prompt: batch[batchIndex]!.prompt,
          reasons,
        });
      }
    });
    alive = standing;
  }
  return {
    acceptedIndexes: alive,
    rejected: [...failed, ...blocked].sort((a, b) => a.index - b.index),
  };
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
    const reasons = rejectionReasonsForVerdicts(
      verdictsByPass.map((byIndex) => byIndex.get(index)),
    );
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

/** One entry per pass the question went through; `undefined` = no verdict. */
function rejectionReasonsForVerdicts(
  verdicts: Array<AnswerVerdict | undefined>,
): CollectVerifiedRejectionReason[] {
  let verifierWrong = false;
  let verifierAmbiguous = false;
  let missingVerdict = false;
  let factBlurbWrong = false;
  let imageRequired = false;
  let categoryMismatch = false;

  for (const verdict of verdicts) {
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
