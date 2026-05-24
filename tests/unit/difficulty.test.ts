import { describe, it, expect } from "vitest";
import { assignPointValues, previewPointValues } from "@/lib/game/difficulty";

describe("assignPointValues", () => {
  it("assigns 100..700 to 7 questions sorted strictly ascending by difficulty", () => {
    const picked = [
      { id: "q1", difficulty: 1 },
      { id: "q2", difficulty: 2 },
      { id: "q3", difficulty: 3 },
      { id: "q4", difficulty: 4 },
      { id: "q5", difficulty: 5 },
      { id: "q6", difficulty: 6 },
      { id: "q7", difficulty: 7 },
    ];
    expect(assignPointValues(picked)).toEqual([
      { id: "q1", pointValue: 100 },
      { id: "q2", pointValue: 200 },
      { id: "q3", pointValue: 300 },
      { id: "q4", pointValue: 400 },
      { id: "q5", pointValue: 500 },
      { id: "q6", pointValue: 600 },
      { id: "q7", pointValue: 700 },
    ]);
  });

  it("sorts unordered input by difficulty ascending", () => {
    const picked = [
      { id: "q-mid", difficulty: 4 },
      { id: "q-easy", difficulty: 1 },
      { id: "q-hard", difficulty: 7 },
      { id: "q-3", difficulty: 3 },
      { id: "q-2", difficulty: 2 },
      { id: "q-6", difficulty: 6 },
      { id: "q-5", difficulty: 5 },
    ];
    expect(assignPointValues(picked)).toEqual([
      { id: "q-easy", pointValue: 100 },
      { id: "q-2", pointValue: 200 },
      { id: "q-3", pointValue: 300 },
      { id: "q-mid", pointValue: 400 },
      { id: "q-5", pointValue: 500 },
      { id: "q-6", pointValue: 600 },
      { id: "q-hard", pointValue: 700 },
    ]);
  });

  it("keeps input order on difficulty ties (stable sort)", () => {
    const picked = [
      { id: "first", difficulty: 4 },
      { id: "second", difficulty: 4 },
      { id: "third", difficulty: 4 },
      { id: "fourth", difficulty: 4 },
      { id: "fifth", difficulty: 4 },
      { id: "sixth", difficulty: 4 },
      { id: "seventh", difficulty: 4 },
    ];
    expect(assignPointValues(picked)).toEqual([
      { id: "first", pointValue: 100 },
      { id: "second", pointValue: 200 },
      { id: "third", pointValue: 300 },
      { id: "fourth", pointValue: 400 },
      { id: "fifth", pointValue: 500 },
      { id: "sixth", pointValue: 600 },
      { id: "seventh", pointValue: 700 },
    ]);
  });

  it("reverses descending input to ascending point values", () => {
    const picked = [
      { id: "q1", difficulty: 7 },
      { id: "q2", difficulty: 6 },
      { id: "q3", difficulty: 5 },
      { id: "q4", difficulty: 4 },
      { id: "q5", difficulty: 3 },
      { id: "q6", difficulty: 2 },
      { id: "q7", difficulty: 1 },
    ];
    expect(assignPointValues(picked)).toEqual([
      { id: "q7", pointValue: 100 },
      { id: "q6", pointValue: 200 },
      { id: "q5", pointValue: 300 },
      { id: "q4", pointValue: 400 },
      { id: "q3", pointValue: 500 },
      { id: "q2", pointValue: 600 },
      { id: "q1", pointValue: 700 },
    ]);
  });

  it("partial-tie input gets stable ordering within tied groups", () => {
    const picked = [
      { id: "easy-a", difficulty: 2 },
      { id: "easy-b", difficulty: 2 },
      { id: "mid-a", difficulty: 4 },
      { id: "mid-b", difficulty: 4 },
      { id: "mid-c", difficulty: 4 },
      { id: "hard-a", difficulty: 6 },
      { id: "hard-b", difficulty: 6 },
    ];
    expect(assignPointValues(picked)).toEqual([
      { id: "easy-a", pointValue: 100 },
      { id: "easy-b", pointValue: 200 },
      { id: "mid-a", pointValue: 300 },
      { id: "mid-b", pointValue: 400 },
      { id: "mid-c", pointValue: 500 },
      { id: "hard-a", pointValue: 600 },
      { id: "hard-b", pointValue: 700 },
    ]);
  });

  it("throws a descriptive error when length !== 7", () => {
    expect(() => assignPointValues([])).toThrow(/exactly 7/i);
    expect(() => assignPointValues([{ id: "q1", difficulty: 4 }])).toThrow(/exactly 7/i);
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, difficulty: i + 1 }));
    expect(() => assignPointValues(six)).toThrow(/exactly 7/i);
    const eight = Array.from({ length: 8 }, (_, i) => ({ id: `q${i}`, difficulty: i + 1 }));
    expect(() => assignPointValues(eight)).toThrow(/exactly 7/i);
  });

  it("does not mutate the input array", () => {
    const picked = [
      { id: "q-mid", difficulty: 4 },
      { id: "q-easy", difficulty: 1 },
      { id: "q-hard", difficulty: 7 },
      { id: "q-3", difficulty: 3 },
      { id: "q-2", difficulty: 2 },
      { id: "q-6", difficulty: 6 },
      { id: "q-5", difficulty: 5 },
    ];
    const snapshot = picked.map((p) => ({ ...p }));
    assignPointValues(picked);
    expect(picked).toEqual(snapshot);
  });
});

describe("previewPointValues", () => {
  it("returns an empty map for empty input", () => {
    expect(previewPointValues([])).toEqual(new Map());
  });

  it("matches assignPointValues exactly when exactly 7 picks", () => {
    const picked = [
      { id: "q-mid", difficulty: 4 },
      { id: "q-easy", difficulty: 1 },
      { id: "q-hard", difficulty: 7 },
      { id: "q-3", difficulty: 3 },
      { id: "q-2", difficulty: 2 },
      { id: "q-6", difficulty: 6 },
      { id: "q-5", difficulty: 5 },
    ];
    const assigned = new Map(
      assignPointValues(picked).map((a) => [a.id, a.pointValue]),
    );
    expect(previewPointValues(picked)).toEqual(assigned);
  });

  it("fills 100..N00 for partial picks, sorted by difficulty ascending", () => {
    const picked = [
      { id: "mid", difficulty: 4 },
      { id: "easy", difficulty: 1 },
      { id: "hard", difficulty: 7 },
    ];
    expect(previewPointValues(picked)).toEqual(
      new Map([
        ["easy", 100],
        ["mid", 200],
        ["hard", 300],
      ]),
    );
  });

  it("distributes 7 same-difficulty picks across all 7 tiers (the Brandon bug)", () => {
    // Reproduces the exact case Brandon screenshotted on 2026-05-24: every
    // pick has the same Claude-rated difficulty (here 2). Before the fix
    // the sidebar showed 6 empty slots because they all keyed `200`.
    const picked = Array.from({ length: 7 }, (_, i) => ({
      id: `q${i}`,
      difficulty: 2,
    }));
    const preview = previewPointValues(picked);
    expect([...preview.values()].sort((a, b) => a - b)).toEqual([
      100, 200, 300, 400, 500, 600, 700,
    ]);
    // Stable order: q0 → easiest (100), q6 → hardest (700)
    expect(preview.get("q0")).toBe(100);
    expect(preview.get("q6")).toBe(700);
  });

  it("preserves stable order within tied groups at partial sizes", () => {
    const picked = [
      { id: "a", difficulty: 3 },
      { id: "b", difficulty: 3 },
      { id: "c", difficulty: 5 },
      { id: "d", difficulty: 3 },
    ];
    expect(previewPointValues(picked)).toEqual(
      new Map([
        ["a", 100],
        ["b", 200],
        ["d", 300],
        ["c", 400],
      ]),
    );
  });

  it("does not mutate the input array", () => {
    const picked = [
      { id: "mid", difficulty: 4 },
      { id: "easy", difficulty: 1 },
      { id: "hard", difficulty: 7 },
    ];
    const snapshot = picked.map((p) => ({ ...p }));
    previewPointValues(picked);
    expect(picked).toEqual(snapshot);
  });
});
