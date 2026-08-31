import { describe, expect, it } from "vitest";

import { PickCategoryBodySchema } from "@/lib/api/schemas";

const IDS = Array.from(
  { length: 7 },
  (_, index) => `00000000-0000-4000-8000-00000000000${index}`,
);

describe("PickCategoryBodySchema", () => {
  it("accepts exactly seven distinct canonical id-to-slot assignments", () => {
    const assignments = IDS.map((id, index) => ({
      id,
      pointValue: (index + 1) * 100,
    }));
    expect(PickCategoryBodySchema.safeParse({ assignments }).success).toBe(true);
  });

  it.each([
    ["duplicate id", IDS.map((id, index) => ({ id: index === 6 ? IDS[0] : id, pointValue: (index + 1) * 100 }))],
    ["duplicate slot", IDS.map((id, index) => ({ id, pointValue: index === 6 ? 600 : (index + 1) * 100 }))],
    ["noncanonical slot", IDS.map((id, index) => ({ id, pointValue: index === 6 ? 800 : (index + 1) * 100 }))],
  ])("rejects %s", (_label, assignments) => {
    expect(PickCategoryBodySchema.safeParse({ assignments }).success).toBe(false);
  });

  it("rejects the legacy id-only payload", () => {
    expect(PickCategoryBodySchema.safeParse({ questionIds: IDS }).success).toBe(false);
  });
});
