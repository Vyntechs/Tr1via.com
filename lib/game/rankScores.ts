export interface ScoreLike {
  display_name: string | null;
  score: number | null;
}

export interface RankedScore<T> {
  row: T;
  rank: number;
}

/**
 * Canonical ordering and rank assignment for every game surface.
 *
 * Equal scores share a competition rank (1, 2, 2, 4). Names only make the
 * display order deterministic; they never break a scoring tie.
 */
export function rankScores<T extends ScoreLike>(rows: readonly T[]): RankedScore<T>[] {
  const sorted = [...rows].sort((a, b) => {
    const scoreDelta = (b.score ?? 0) - (a.score ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    return (a.display_name ?? "").localeCompare(b.display_name ?? "", undefined, {
      sensitivity: "base",
    });
  });

  let previousScore: number | null = null;
  let previousRank = 0;
  return sorted.map((row, index) => {
    const score = row.score ?? 0;
    const rank = index > 0 && score === previousScore ? previousRank : index + 1;
    previousScore = score;
    previousRank = rank;
    return { row, rank };
  });
}
