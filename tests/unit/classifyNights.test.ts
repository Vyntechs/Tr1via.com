import { describe, it, expect } from "vitest";
import { classifyNights } from "@/lib/host/classifyNights";

const n = (id: string, opened_at: string | null) => ({ id, opened_at });

describe("classifyNights", () => {
  it("returns nulls/empties for no nights", () => {
    expect(classifyNights([])).toEqual({ tonight: null, previousGames: [], inSetup: [] });
  });

  it("most-recent night (index 0) is tonight and is in neither list", () => {
    const nights = [n("a", null)];
    const r = classifyNights(nights);
    expect(r.tonight?.id).toBe("a");
    expect(r.previousGames).toEqual([]);
    expect(r.inSetup).toEqual([]);
  });

  it("of the rest: opened_at!=null => previousGames, opened_at==null => inSetup, order preserved", () => {
    // input is newest-first (created_at desc), matching app/host/page.tsx
    const nights = [n("draft-new", null), n("ran-1", "2026-05-27T00:00:00Z"), n("draft-old", null), n("ran-0", "2026-05-25T00:00:00Z")];
    const r = classifyNights(nights);
    expect(r.tonight?.id).toBe("draft-new");
    expect(r.previousGames.map((x) => x.id)).toEqual(["ran-1", "ran-0"]);
    expect(r.inSetup.map((x) => x.id)).toEqual(["draft-old"]);
  });
});
