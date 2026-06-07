import { describe, it, expect } from "vitest";
import { pickRealTopics, REAL_TOPIC_BANK } from "@/lib/host/realTopicBank";

describe("pickRealTopics", () => {
  it("returns the requested count of distinct topics", () => {
    const topics = pickRealTopics("night-abc", 12);
    expect(topics).toHaveLength(12);
    expect(new Set(topics.map((t) => t.name)).size).toBe(12);
  });
  it("is deterministic for the same seed", () => {
    expect(pickRealTopics("seed-1", 12)).toEqual(pickRealTopics("seed-1", 12));
  });
  it("varies across different seeds", () => {
    const a = pickRealTopics("seed-1", 12).map((t) => t.name).join(",");
    const b = pickRealTopics("seed-2", 12).map((t) => t.name).join(",");
    expect(a).not.toEqual(b);
  });
  it("only returns entries from the bank", () => {
    const bank = new Set(REAL_TOPIC_BANK.map((t) => t.name));
    for (const t of pickRealTopics("x", 12)) expect(bank.has(t.name)).toBe(true);
  });
  it("throws if count exceeds the bank size", () => {
    expect(() => pickRealTopics("x", REAL_TOPIC_BANK.length + 1)).toThrow();
  });
});
