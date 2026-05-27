import { describe, it, expect } from "vitest";
import { questionDurationFor } from "@/lib/theme/lockInCeremony";

describe("room page duration source", () => {
  it("yields 25s for may", () => {
    expect(questionDurationFor("may")).toBe(25);
  });
  it("yields 20s otherwise", () => {
    expect(questionDurationFor("house")).toBe(20);
  });
});
