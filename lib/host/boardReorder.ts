// Pure board-reorder math for the "YOUR BOARD" sidebar drag-and-drop.
//
// The board shows the host's picked questions in point-value slots, smallest
// at the top (100) to largest at the bottom (700). Dragging a card to a new
// position does NOT change which point values are in play — it changes WHICH
// card sits in each slot. So the set of occupied point values is fixed to the
// slot positions (top = smallest) and only the card→slot mapping changes.
//
// Extracted from the component so the reorder result is unit-testable without
// simulating real pointer/keyboard drag events (jsdom has no layout, so
// @dnd-kit's sensors can't run there).

export interface BoardAssignment {
  id: string;
  pointValue: number;
}

/**
 * Given the current top→bottom order of the filled board card ids
 * (`orderedIds`) and the ascending list of point values those cards occupy
 * (`occupiedValues`, same length, sorted smallest→largest), compute the new
 * `{ id, pointValue }` assignment for every filled card after dragging
 * `activeId` onto `overId`.
 *
 * Returns `null` for a no-op (same card, or an id not in the list) so the
 * caller can skip the network write.
 *
 * Invariant: the multiset of returned point values always equals
 * `occupiedValues` — reordering never invents or drops a slot. At a full
 * 7-card board `occupiedValues` is [100..700], so the card at position `i`
 * lands on `(i + 1) * 100`; at a partial board the occupied subset is
 * preserved and merely redistributed across the cards in their new order.
 */
export function computeReorderAssignments(
  orderedIds: string[],
  occupiedValues: number[],
  activeId: string,
  overId: string,
): BoardAssignment[] | null {
  if (orderedIds.length !== occupiedValues.length) {
    throw new Error(
      `computeReorderAssignments: ${orderedIds.length} ids vs ${occupiedValues.length} values`,
    );
  }
  const from = orderedIds.indexOf(activeId);
  const to = orderedIds.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return null;

  const next = orderedIds.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);

  return next.map((id, i) => ({ id, pointValue: occupiedValues[i]! }));
}
