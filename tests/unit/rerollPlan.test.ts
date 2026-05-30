import { describe, expect, it } from "vitest";
import { rerollPlan, type RerollRow } from "@/lib/host/rerollPlan";

const row = (id: string, prompt: string, is_picked = false): RerollRow => ({
  id,
  prompt,
  is_picked,
});

describe("rerollPlan", () => {
  it("keeps client-kept ids, deletes the rest, avoids every seen prompt", () => {
    const existing = [
      row("a", "Q-A"),
      row("b", "Q-B"),
      row("c", "Q-C"),
      row("d", "Q-D"),
    ];
    const plan = rerollPlan(existing, ["a", "c"]);
    expect(plan.keepIds).toEqual(["a", "c"]);
    expect(plan.deleteIds).toEqual(["b", "d"]);
    expect(plan.avoidPrompts).toEqual(["Q-A", "Q-B", "Q-C", "Q-D"]);
  });

  it("unions is_picked rows defensively even if not in keptIds", () => {
    const existing = [row("a", "Q-A", true), row("b", "Q-B")];
    const plan = rerollPlan(existing, []);
    expect(plan.keepIds).toEqual(["a"]);
    expect(plan.deleteIds).toEqual(["b"]);
  });

  it("empty keptIds with no picked rows deletes everything (fresh pool)", () => {
    const existing = [row("a", "Q-A"), row("b", "Q-B")];
    const plan = rerollPlan(existing, []);
    expect(plan.keepIds).toEqual([]);
    expect(plan.deleteIds).toEqual(["a", "b"]);
    expect(plan.avoidPrompts).toEqual(["Q-A", "Q-B"]);
  });

  it("ignores kept ids that are not present in existing rows", () => {
    const existing = [row("a", "Q-A")];
    const plan = rerollPlan(existing, ["a", "ghost"]);
    expect(plan.keepIds).toEqual(["a"]);
    expect(plan.deleteIds).toEqual([]);
  });

  it("handles empty existing", () => {
    const plan = rerollPlan([], ["a"]);
    expect(plan).toEqual({ keepIds: [], deleteIds: [], avoidPrompts: [] });
  });
});
