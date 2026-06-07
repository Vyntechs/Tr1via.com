import { describe, it, expect } from "vitest";
import { GenerateCategoryBodySchema } from "@/lib/api/schemas";

describe("GenerateCategoryBodySchema autoPick", () => {
  it("accepts autoPick: true", () => {
    const r = GenerateCategoryBodySchema.safeParse({ autoPick: true });
    expect(r.success).toBe(true);
  });
  it("defaults to undefined when omitted (existing behavior unchanged)", () => {
    const r = GenerateCategoryBodySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.autoPick).toBeUndefined();
  });
  it("rejects a non-boolean autoPick", () => {
    expect(GenerateCategoryBodySchema.safeParse({ autoPick: "yes" }).success).toBe(
      false,
    );
  });
});
