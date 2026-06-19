export interface ResolveAward {
  playerId: string;
  awarded: number;
  isCorrect: boolean;
}

export interface ResolveSummary {
  correctCount: number;
  answeredCount: number;
}

export function summarizeResolve(awards: ResolveAward[] | undefined): ResolveSummary {
  if (!awards || awards.length === 0) return { correctCount: 0, answeredCount: 0 };
  return {
    correctCount: awards.reduce((n, a) => n + (a.isCorrect ? 1 : 0), 0),
    answeredCount: awards.length,
  };
}

export function nailedItLine(correctCount: number): string {
  const others = Math.max(0, correctCount - 1);
  if (others === 0) return "You nailed it";
  if (others === 1) return "You + 1 other nailed it";
  return `You + ${others} others nailed it`;
}

export function gotItLine(correctCount: number, answeredCount: number): string {
  if (correctCount <= 0) return "Nobody got this one";
  return `${correctCount} of ${answeredCount} got this one`;
}
