/**
 * Map 7 host-picked questions to the 7 point values on a TR1VIA board.
 *
 * Each candidate question carries a Claude-assigned `difficulty` (1..7).
 * After the host picks 7 of the 20 generated candidates, we have to
 * assign each picked question one of the canonical point values
 * 100, 200, 300, 400, 500, 600, 700 — easiest at 100, hardest at 700.
 *
 * We do this by sorting picked ascending by difficulty (STABLE so ties
 * preserve input order — relevant when Claude rates 4 questions the same)
 * then assigning [100, 200, 300, 400, 500, 600, 700] by position.
 *
 * Stable sort: JavaScript's Array.prototype.sort has been required by spec
 * to be stable since ES2019. We rely on that here.
 */
const POINT_VALUES = [100, 200, 300, 400, 500, 600, 700] as const;

export function assignPointValues(
  picked: Array<{ id: string; difficulty: number }>
): Array<{ id: string; pointValue: number }> {
  if (picked.length !== POINT_VALUES.length) {
    throw new Error(
      `assignPointValues: expected exactly 7 picked questions, got ${picked.length}`
    );
  }
  // Copy so we never mutate the caller's array. Spread also coerces tuple
  // types into a plain array suitable for .sort.
  const sorted = [...picked].sort((a, b) => a.difficulty - b.difficulty);
  return sorted.map((q, index) => ({
    id: q.id,
    pointValue: POINT_VALUES[index] as number,
  }));
}
