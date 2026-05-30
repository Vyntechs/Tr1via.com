// Plan for an in-place "↻ Another 20" reroll on the pick screen.
//
// On a reroll the host keeps the questions she has picked and wants the ones
// she did NOT pick swapped out for a fresh batch — without seeing repeats of
// anything already on screen. Pick state lives in the client until lock, so
// the client tells the server which ids to keep (`keptIds`); `is_picked` is
// unioned defensively for the (post-lock) case where the DB knows the picks.
//
// Given the category's current rows + the kept ids, this computes:
//   - keepIds:      rows to spare (kept by the client, or already is_picked)
//   - deleteIds:    the unpicked candidates to remove once the fresh batch lands
//   - avoidPrompts: every prompt already shown, fed to the generator so the
//                   new batch does not repeat them
//
// Pure — no I/O — so the swap logic is unit-tested in isolation.

export interface RerollRow {
  id: string;
  prompt: string;
  is_picked: boolean;
}

export interface RerollPlan {
  keepIds: string[];
  deleteIds: string[];
  avoidPrompts: string[];
}

export function rerollPlan(
  existing: ReadonlyArray<RerollRow>,
  keptIds: ReadonlyArray<string>,
): RerollPlan {
  const kept = new Set(keptIds);
  const keepIds: string[] = [];
  const deleteIds: string[] = [];
  const avoidPrompts: string[] = [];
  for (const row of existing) {
    avoidPrompts.push(row.prompt);
    if (kept.has(row.id) || row.is_picked) keepIds.push(row.id);
    else deleteIds.push(row.id);
  }
  return { keepIds, deleteIds, avoidPrompts };
}
