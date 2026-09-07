/** Editorial difficulty labels are estimates, not measured success rates. */
export const DIFFICULTY_BANDS = ["approachable", "moderate", "stretch"] as const;
export type DifficultyBand = (typeof DIFFICULTY_BANDS)[number];
export type DifficultyMix = Record<DifficultyBand, number>;
export type DifficultyTarget = "easy" | "normal" | "hard";

export const BOARD_DIFFICULTY_MIX: Readonly<DifficultyMix> = {
  approachable: 3,
  moderate: 3,
  stretch: 1,
};

/** Every 20-candidate pool leaves choices for an approachable board. */
export function candidateDifficultyMix(target: DifficultyTarget = "normal"): DifficultyMix {
  if (target === "easy") return { approachable: 10, moderate: 8, stretch: 2 };
  if (target === "hard") return { approachable: 6, moderate: 9, stretch: 5 };
  return { approachable: 8, moderate: 9, stretch: 3 };
}

export function difficultyBand(difficulty: number): DifficultyBand {
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 7) {
    throw new Error("question difficulty must be an integer from 1 to 7");
  }
  if (difficulty <= 2) return "approachable";
  return difficulty <= 5 ? "moderate" : "stretch";
}

export function remainingDifficultyMix(
  target: Readonly<DifficultyMix>,
  questions: ReadonlyArray<{ difficulty: number }>,
): DifficultyMix {
  const remaining = { ...target };
  for (const question of questions) {
    const band = difficultyBand(question.difficulty);
    remaining[band] = Math.max(0, remaining[band] - 1);
  }
  return remaining;
}

/** Reserve space for missing bands; never let surplus hard items fill it. */
export function takeDifficultyMix<T extends { difficulty: number }>(
  questions: readonly T[],
  target: Readonly<DifficultyMix>,
): { accepted: T[]; surplus: T[] } {
  const remaining = { ...target };
  const accepted: T[] = [];
  const surplus: T[] = [];
  for (const question of questions) {
    const band = difficultyBand(question.difficulty);
    if (remaining[band] > 0) {
      accepted.push(question);
      remaining[band]--;
    } else {
      surplus.push(question);
    }
  }
  return { accepted, surplus };
}

export class QuestionBalanceError extends Error {
  constructor() {
    super("The builder still needs a balanced set of easier and harder questions. Your saved choices are safe; resume to fill the gaps.");
    this.name = "QuestionBalanceError";
  }
}

export function assertBoardDifficultyMix(questions: ReadonlyArray<{ difficulty: number }>): void {
  const missing = remainingDifficultyMix(BOARD_DIFFICULTY_MIX, questions);
  if (Object.values(missing).some((count) => count > 0)) throw new QuestionBalanceError();
}

/**
 * Stable selection across each band, returned easy to hard for 100..700.
 * Insufficient coverage is explicit; seven hard questions are never silently
 * represented as an approachable automatic board. Manual picks remain explicit.
 */
export function selectBalancedQuestionIds(
  questions: ReadonlyArray<{ id: string; difficulty: number }>,
): string[] {
  const unique = [...new Map(questions.map((question) => [question.id, question])).values()];
  assertBoardDifficultyMix(unique);
  const sorted = unique.sort((a, b) => a.difficulty - b.difficulty);
  const result: string[] = [];
  for (const band of DIFFICULTY_BANDS) {
    const pool = sorted.filter((question) => difficultyBand(question.difficulty) === band);
    const count = BOARD_DIFFICULTY_MIX[band];
    if (pool.length < count) throw new QuestionBalanceError();
    for (let i = 0; i < count; i++) {
      // One stretch question need not be the most obscure candidate available.
      const index = count === 1 ? 0 : Math.round(i * (pool.length - 1) / (count - 1));
      result.push(pool[index]!.id);
    }
  }
  return result;
}
