/**
 * Per-answer scoring for a single TR1VIA question.
 *
 * Rules (from tr1via-plan.md):
 *   - Correct answer → face value (point value of the question, 100..700).
 *   - Correct AND locked in under 5 full seconds → +10% speed bonus, floored.
 *   - Wrong, or no answer at all → 0 points (no penalty).
 *
 * The speed bonus uses Math.floor so we never award fractional points.
 * Caller is trusted to pass `pointValue` from the canonical {100,200,...,700}
 * set; we don't validate because the database column has a CHECK constraint
 * that enforces it upstream.
 */
export function awardPoints(opts: {
  pointValue: number;
  correct: boolean;
  msToLock: number | null;
}): number {
  if (!opts.correct) return 0;
  const qualifiesForBonus = opts.msToLock !== null && opts.msToLock < 5000;
  if (qualifiesForBonus) {
    return Math.floor(opts.pointValue * 1.1);
  }
  return opts.pointValue;
}
