import { describe, it, expect } from "vitest";
import { pyroBudget } from "@/components/system/Pyrotechnics";

describe("pyroBudget — self-degrade by canvas size", () => {
  it("TV-sized canvas keeps the full budget (unchanged)", () => {
    expect(pyroBudget(1280, 8)).toEqual({ maxParticles: 1600, dprCap: 2 });
  });
  it("phone-sized canvas caps particles + DPR", () => {
    const b = pyroBudget(390, 8);
    expect(b.maxParticles).toBeLessThanOrEqual(600);
    expect(b.dprCap).toBeLessThanOrEqual(1.5);
  });
  it("low-core phone degrades further", () => {
    expect(pyroBudget(390, 2).maxParticles).toBeLessThanOrEqual(pyroBudget(390, 8).maxParticles);
  });
  it("treats unknown core count as mid", () => {
    expect(pyroBudget(390, undefined).maxParticles).toBeGreaterThan(0);
  });
});
