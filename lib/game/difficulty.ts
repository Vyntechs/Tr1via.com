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

/**
 * Preview the tier each pick WILL receive on lock, given any partial
 * selection 0..7. Same sort-and-sequence rule as `assignPointValues`, so
 * once the host has 7 picks the preview matches the server result exactly.
 *
 * At N<7 picks the ladder fills bottom-up by inherent difficulty: the
 * easiest pick lands at 100, the next at 200, etc. The remaining slots
 * stay open. This means a single hard first pick shows up at 100 ("easiest
 * of one"); as more picks come in, the assignments redistribute.
 *
 * Returned as a Map so the caller can look up `q.id -> pointValue` cheaply
 * during render.
 */
export function previewPointValues(
  picked: Array<{ id: string; difficulty: number }>
): Map<string, number> {
  if (picked.length === 0) return new Map();
  const sorted = [...picked].sort((a, b) => a.difficulty - b.difficulty);
  return new Map(
    sorted.map((q, i) => [
      q.id,
      POINT_VALUES[Math.min(i, POINT_VALUES.length - 1)] as number,
    ])
  );
}
