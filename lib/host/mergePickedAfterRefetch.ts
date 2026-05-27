// Merge the host's in-progress picks with a fresh server snapshot of
// questions. The pick state lives in the client until lock — DB rows
// only carry `is_picked=true` after POST /api/categories/[id]/pick lands.
// During an in-place "↻ Another 20" regenerate, every `question_added`
// broadcast triggers a refetch; blindly resetting picked-ids from DB
// rows would wipe the host's selections (bug A, session 19).
//
// The merge keeps every client-side pick whose row still exists in the
// refreshed list, unions any rows the server has confirmed are picked,
// and drops any client-side picks that no longer resolve to a row in
// the new snapshot (defensive — covers a future regenerate that also
// deletes the previous batch).

export interface MergePickedRow {
  id: string;
  is_picked: boolean;
}

export function mergePickedAfterRefetch(
  previous: Set<string>,
  rows: ReadonlyArray<MergePickedRow>,
): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    if (previous.has(row.id) || row.is_picked) out.add(row.id);
  }
  return out;
}
