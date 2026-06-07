import { describe, it, expect } from "vitest";
import { selectSpreadQuestionIds } from "@/lib/host/pickQuestions";

const q = (id: string, difficulty: number) => ({ id, difficulty });

describe("selectSpreadQuestionIds", () => {
  it("returns `count` distinct ids spread across difficulty", () => {
    const pool = Array.from({ length: 20 }, (_, i) => q(`q${i}`, (i % 7) + 1));
    const ids = selectSpreadQuestionIds(pool, 7);
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
  });
  it("spans easiest to hardest (first picked is easiest, last is hardest)", () => {
    const pool = Array.from({ length: 20 }, (_, i) => q(`q${i}`, i + 1)); // difficulty 1..20
    const ids = selectSpreadQuestionIds(pool, 7);
    const byId = new Map(pool.map((p) => [p.id, p.difficulty]));
    expect(byId.get(ids[0])).toBe(1);
    expect(byId.get(ids[6])).toBe(20);
  });
  it("returns all ids when count equals pool size", () => {
    const pool = Array.from({ length: 7 }, (_, i) => q(`q${i}`, i + 1));
    expect(selectSpreadQuestionIds(pool, 7).sort()).toEqual(
      pool.map((p) => p.id).sort(),
    );
  });
  it("throws if the pool is too small", () => {
    expect(() => selectSpreadQuestionIds([q("a", 1)], 7)).toThrow();
  });
});
