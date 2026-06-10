import { describe, it, expect } from "vitest";
import { computeReorderAssignments } from "@/lib/host/boardReorder";

describe("computeReorderAssignments", () => {
  it("at a full 7-card board, each card lands on its positional point value", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    const values = [100, 200, 300, 400, 500, 600, 700];
    // Drag the top card (a, currently 100) down onto g (700).
    const out = computeReorderAssignments(ids, values, "a", "g");
    expect(out).toEqual([
      { id: "b", pointValue: 100 },
      { id: "c", pointValue: 200 },
      { id: "d", pointValue: 300 },
      { id: "e", pointValue: 400 },
      { id: "f", pointValue: 500 },
      { id: "g", pointValue: 600 },
      { id: "a", pointValue: 700 },
    ]);
  });

  it("moving a card up reassigns the slots between (drag g onto a)", () => {
    const ids = ["a", "b", "c"];
    const values = [100, 200, 300];
    const out = computeReorderAssignments(ids, values, "c", "a");
    expect(out).toEqual([
      { id: "c", pointValue: 100 },
      { id: "a", pointValue: 200 },
      { id: "b", pointValue: 300 },
    ]);
  });

  it("a simple adjacent swap only changes the two cards involved", () => {
    const ids = ["a", "b", "c"];
    const values = [100, 200, 300];
    const out = computeReorderAssignments(ids, values, "a", "b");
    expect(out).toEqual([
      { id: "b", pointValue: 100 },
      { id: "a", pointValue: 200 },
      { id: "c", pointValue: 300 },
    ]);
  });

  it("preserves a non-contiguous occupied set (partial board with a host-pinned high tier)", () => {
    // Three picks occupying 100, 200, 700 (e.g. one was edited up to 700).
    const ids = ["a", "b", "c"];
    const values = [100, 200, 700];
    const out = computeReorderAssignments(ids, values, "c", "a");
    // The occupied values 100/200/700 stay in play, just redistributed.
    expect(out).toEqual([
      { id: "c", pointValue: 100 },
      { id: "a", pointValue: 200 },
      { id: "b", pointValue: 700 },
    ]);
    // Invariant: the multiset of values is unchanged.
    expect(out!.map((x) => x.pointValue).sort((m, n) => m - n)).toEqual(values);
  });

  it("returns null for a no-op drop (same card)", () => {
    const ids = ["a", "b"];
    const values = [100, 200];
    expect(computeReorderAssignments(ids, values, "a", "a")).toBeNull();
  });

  it("returns null when an id is not in the list", () => {
    const ids = ["a", "b"];
    const values = [100, 200];
    expect(computeReorderAssignments(ids, values, "a", "zzz")).toBeNull();
    expect(computeReorderAssignments(ids, values, "zzz", "b")).toBeNull();
  });

  it("never mutates the caller's arrays", () => {
    const ids = ["a", "b", "c"];
    const values = [100, 200, 300];
    computeReorderAssignments(ids, values, "a", "c");
    expect(ids).toEqual(["a", "b", "c"]);
    expect(values).toEqual([100, 200, 300]);
  });

  it("throws when ids and values lengths disagree (programmer error)", () => {
    expect(() => computeReorderAssignments(["a"], [100, 200], "a", "a")).toThrow();
  });
});
