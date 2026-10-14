// One category per board slot.
//
// A game has six slots (position 1..6) and each slot must hold exactly one
// category. Before the create route keyed on the slot alone, a host who came
// back to the topic form for a slot she had already filled (browser Back from
// the pick screen, a stale setup screen, a second device) and typed the topic
// again with different capitals got a SECOND row in the same slot. Example from
// production, game 2 on 2026-10-07: "Legendary Ghost stories" (review, nothing
// picked) next to "legendary ghost stories" renamed to "Ghost Stories" (ready).
//
// The create route now refuses to add a second row, and a database rule is
// proposed. Rows that are already doubled still exist, so every screen that
// builds a board from the categories table runs them through here first so a
// slot shows once.
//
// Which row wins a slot, in order:
//   1. more picked questions (a filled older row is never hidden behind a
//      newer empty one: the Back-button double leaves exactly that shape)
//   2. the more finished state: ready > review > generating > draft
//   3. the newer row (the host's latest attempt)
//   4. the id, so the choice never depends on row order
// Picked counts come from questions with is_picked = true. Every screen and
// the proposed cleanup SQL (supabase/proposed/20261014_one_category_per_slot.sql)
// use this same order, so the setup screen, the live console, the TV, the
// readiness check and the cleanup always agree on which row owns a slot.
// Counts are only needed when a slot is actually doubled; a clean board never
// looks at them.

export interface SlotCategoryLike {
  id: string;
  game_id: string;
  position: number;
  state: string;
  created_at?: string | null;
}

const STATE_RANK: Record<string, number> = {
  ready: 3,
  review: 2,
  generating: 1,
  draft: 0,
};

/** Same topic text, ignoring capitals and extra spaces. */
export function sameTopicText(a: string, b: string): boolean {
  return normalizeTopic(a) === normalizeTopic(b);
}

export function normalizeTopic(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Picked-question count per category id. A missing id counts as 0. */
export type PickedCounts = ReadonlyMap<string, number>;

const NO_PICKS: PickedCounts = new Map();

/**
 * Count picked questions per category. Pass picked rows; a row that says
 * is_picked: false is skipped, a row without the field counts as picked.
 */
export function countPickedByCategory(
  questions: Iterable<{ category_id: string; is_picked?: boolean | null }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const q of questions) {
    if (q.is_picked === false) continue;
    counts.set(q.category_id, (counts.get(q.category_id) ?? 0) + 1);
  }
  return counts;
}

/** True when `a` should win the slot over `b`. */
export function beatsForSlot(
  a: SlotCategoryLike,
  b: SlotCategoryLike,
  picked: PickedCounts = NO_PICKS,
): boolean {
  const pickDiff = (picked.get(a.id) ?? 0) - (picked.get(b.id) ?? 0);
  if (pickDiff !== 0) return pickDiff > 0;
  const stateDiff = (STATE_RANK[a.state] ?? -1) - (STATE_RANK[b.state] ?? -1);
  if (stateDiff !== 0) return stateDiff > 0;
  const aTime = a.created_at ? Date.parse(a.created_at) : 0;
  const bTime = b.created_at ? Date.parse(b.created_at) : 0;
  if (aTime !== bTime) return aTime > bTime;
  return a.id > b.id;
}

/** The single row that owns a slot, or null for an empty list. */
export function pickSlotWinner<T extends SlotCategoryLike>(
  rows: readonly T[],
  picked: PickedCounts = NO_PICKS,
): T | null {
  let winner: T | null = null;
  for (const row of rows) {
    if (!winner || beatsForSlot(row, winner, picked)) winner = row;
  }
  return winner;
}

function slotKey(row: SlotCategoryLike): string {
  return `${row.game_id}:${row.position}`;
}

/**
 * Ids of every row that shares its (game, position) with another row. Empty
 * for a clean board, so callers can skip loading picked counts entirely.
 */
export function doubledSlotCategoryIds(rows: readonly SlotCategoryLike[]): string[] {
  const bySlot = new Map<string, string[]>();
  for (const row of rows) {
    const key = slotKey(row);
    const ids = bySlot.get(key);
    if (ids) ids.push(row.id);
    else bySlot.set(key, [row.id]);
  }
  const doubled: string[] = [];
  for (const ids of bySlot.values()) {
    if (ids.length > 1) doubled.push(...ids);
  }
  return doubled;
}

/**
 * Keep one row per (game, position). The result keeps the input order of the
 * rows that survive, so a list already sorted by position stays sorted. A list
 * with no doubled slots comes back unchanged (same rows, same order).
 */
export function oneCategoryPerSlot<T extends SlotCategoryLike>(
  rows: readonly T[],
  picked: PickedCounts = NO_PICKS,
): T[] {
  const winnerBySlot = new Map<string, T>();
  for (const row of rows) {
    const key = slotKey(row);
    const current = winnerBySlot.get(key);
    if (!current || beatsForSlot(row, current, picked)) {
      winnerBySlot.set(key, row);
    }
  }
  if (winnerBySlot.size === rows.length) return [...rows];
  const keep = new Set(Array.from(winnerBySlot.values(), (row) => row.id));
  return rows.filter((row) => keep.has(row.id));
}
