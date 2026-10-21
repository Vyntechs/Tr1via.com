import { describe, expect, it } from "vitest";
import { MODEL_RATES, costUsd } from "@/lib/ai/usage-cost";

const oneMillionEach = { input_tokens: 1_000_000, output_tokens: 1_000_000 };

describe("costUsd", () => {
  it.each([
    "claude-opus-4-8",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
  ])("prices %s above zero so the hidden cost log never records $0", (model) => {
    const rate = MODEL_RATES[model]!;
    expect(costUsd(model, oneMillionEach)).toBeCloseTo(rate.in + rate.out, 6);
  });

  it("tolerates a dated suffix on a known model", () => {
    expect(costUsd("claude-sonnet-5-5-20261001", oneMillionEach)).toBeCloseTo(12, 6);
  });

  it("returns 0 for an unknown model instead of throwing", () => {
    expect(costUsd("claude-nope-9-9", oneMillionEach)).toBe(0);
  });
});
