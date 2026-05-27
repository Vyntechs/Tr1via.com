// Unit test for mergePickedAfterRefetch — the helper that keeps the
// host's in-progress picks safe across a server refetch during regenerate.
//
// Bug A (session 19): the host had selected a few candidates, tapped
// "↻ Another 20", and watched her picks evaporate. Root cause was the
// blanket `setPickedIds(new Set(rows.filter(is_picked).map(id)))` that
// fired on every refetch — picks live in client state until lock, so a
// DB-derived reset wiped them. This helper is the fix.

import { describe, it, expect } from "vitest";
import { mergePickedAfterRefetch } from "@/lib/host/mergePickedAfterRefetch";

describe("mergePickedAfterRefetch", () => {
  it("keeps client picks when their rows are still present", () => {
    const previous = new Set(["a", "b", "c"]);
    const rows = [
      { id: "a", is_picked: false },
      { id: "b", is_picked: false },
      { id: "c", is_picked: false },
      { id: "d", is_picked: false }, // new candidate from regenerate
    ];
    const result = mergePickedAfterRefetch(previous, rows);
    expect(result).toEqual(new Set(["a", "b", "c"]));
  });

  it("survives an in-place regenerate (20 old + 20 new) without losing picks", () => {
    // Three out of the original 20 are picked. Regenerate adds 20 new
    // rows (none picked). All 40 are returned by the refetch. The picks
    // must survive — that's the entire fix.
    const previous = new Set(["old-3", "old-7", "old-12"]);
    const rows: Array<{ id: string; is_picked: boolean }> = [];
    for (let i = 0; i < 20; i++) rows.push({ id: `old-${i}`, is_picked: false });
    for (let i = 0; i < 20; i++) rows.push({ id: `new-${i}`, is_picked: false });
    const result = mergePickedAfterRefetch(previous, rows);
    expect(result).toEqual(new Set(["old-3", "old-7", "old-12"]));
  });

  it("unions DB-confirmed picks with client picks (post-lock reload case)", () => {
    // After a hard reload while in 'review', the host's previously locked
    // picks come back with is_picked=true on the DB row. Plus the host
    // may have new in-progress picks she's added in the new session.
    const previous = new Set(["client-1"]);
    const rows = [
      { id: "client-1", is_picked: false },
      { id: "db-1", is_picked: true },
      { id: "db-2", is_picked: true },
      { id: "other", is_picked: false },
    ];
    const result = mergePickedAfterRefetch(previous, rows);
    expect(result).toEqual(new Set(["client-1", "db-1", "db-2"]));
  });

  it("drops client picks for rows that no longer exist", () => {
    // Defensive: if a future regenerate also wipes the previous 20 rows,
    // any client pick that points at a deleted row must be dropped (we
    // can't pick a question that's gone).
    const previous = new Set(["gone", "still-here"]);
    const rows = [{ id: "still-here", is_picked: false }];
    const result = mergePickedAfterRefetch(previous, rows);
    expect(result).toEqual(new Set(["still-here"]));
  });

  it("returns an empty set when no rows match", () => {
    const previous = new Set(["a", "b"]);
    const rows: Array<{ id: string; is_picked: boolean }> = [];
    const result = mergePickedAfterRefetch(previous, rows);
    expect(result.size).toBe(0);
  });

  it("returns an empty set when nothing is picked yet (first paint, no DB picks)", () => {
    const previous = new Set<string>();
    const rows = [
      { id: "a", is_picked: false },
      { id: "b", is_picked: false },
    ];
    const result = mergePickedAfterRefetch(previous, rows);
    expect(result.size).toBe(0);
  });

  it("is idempotent — running twice on the same input is stable", () => {
    const previous = new Set(["a", "c"]);
    const rows = [
      { id: "a", is_picked: false },
      { id: "b", is_picked: true },
      { id: "c", is_picked: false },
    ];
    const once = mergePickedAfterRefetch(previous, rows);
    const twice = mergePickedAfterRefetch(once, rows);
    expect(twice).toEqual(once);
  });
});
