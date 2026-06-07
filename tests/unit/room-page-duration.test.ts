import { describe, it, expect } from "vitest";
import { questionDurationFor } from "@/lib/theme/lockInCeremony";

describe("room page duration source", () => {
  it("yields 30s for may", () => {
    expect(questionDurationFor("may")).toBe(30);
  });
  it("yields 30s for every theme (the default)", () => {
    expect(questionDurationFor("house")).toBe(30);
  });
});
