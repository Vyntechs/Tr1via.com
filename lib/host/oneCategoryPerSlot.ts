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
//   1. the more finished state: ready > review > generating > draft
//   2. the newer row (the host's latest attempt)
//   3. the id, so the choice never depends on row order
// Every screen uses only these three fields, so the setup screen, the live
// console and the TV always agree on which row owns a slot.

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

/** True when `a` should win the slot over `b`. */
export function beatsForSlot(a: SlotCategoryLike, b: SlotCategoryLike): boolean {
  const stateDiff = (STATE_RANK[a.state] ?? -1) - (STATE_RANK[b.state] ?? -1);
  if (stateDiff !== 0) return stateDiff > 0;
  const aTime = a.created_at ? Date.parse(a.created_at) : 0;
  const bTime = b.created_at ? Date.parse(b.created_at) : 0;
  if (aTime !== bTime) return aTime > bTime;
  return a.id > b.id;
}

/** The single row that owns a slot, or null for an empty list. */
export function pickSlotWinner<T extends SlotCategoryLike>(rows: readonly T[]): T | null {
  let winner: T | null = null;
  for (const row of rows) {
    if (!winner || beatsForSlot(row, winner)) winner = row;
  }
  return winner;
}

/**
 * Keep one row per (game, position). The result keeps the input order of the
 * rows that survive, so a list already sorted by position stays sorted. A list
 * with no doubled slots comes back unchanged (same rows, same order).
 */
export function oneCategoryPerSlot<T extends SlotCategoryLike>(rows: readonly T[]): T[] {
  const winnerBySlot = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.game_id}:${row.position}`;
    const current = winnerBySlot.get(key);
    if (!current || beatsForSlot(row, current)) {
      winnerBySlot.set(key, row);
    }
  }
  if (winnerBySlot.size === rows.length) return [...rows];
  const keep = new Set(Array.from(winnerBySlot.values(), (row) => row.id));
  return rows.filter((row) => keep.has(row.id));
}
