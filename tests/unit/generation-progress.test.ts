import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGenerationProgressReporter } from "@/lib/ai/generation-progress";

describe("createGenerationProgressReporter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes written_count at most once per interval but always ends on the latest value", async () => {
    const persisted: number[] = [];
    const reporter = createGenerationProgressReporter({
      target: 20,
      minWriteIntervalMs: 1_500,
      persistWritten: async (n) => {
        persisted.push(n);
      },
    });

    reporter.reportWritten(1); // immediate (nothing written yet)
    reporter.reportWritten(2);
    reporter.reportWritten(3);
    await vi.advanceTimersByTimeAsync(0); // the write itself lands on a microtask
    expect(persisted).toEqual([1]);

    await vi.advanceTimersByTimeAsync(1_500);
    expect(persisted).toEqual([1, 3]);

    reporter.reportWritten(4);
    reporter.reportWritten(7);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(persisted).toEqual([1, 3]);
    await vi.advanceTimersByTimeAsync(1);
    expect(persisted).toEqual([1, 3, 7]);
  });

  it("settle cancels a queued write so an authoritative write cannot be overtaken", async () => {
    const persisted: number[] = [];
    const reporter = createGenerationProgressReporter({
      target: 20,
      persistWritten: async (n) => {
        persisted.push(n);
      },
    });
    reporter.reportWritten(5);
    reporter.reportWritten(9);
    await reporter.settle();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(persisted).toEqual([5]);
    expect(reporter.counts().written).toBe(9);
  });

  it("carries written, certified, target and the checking fields in the payload counts", () => {
    const reporter = createGenerationProgressReporter({
      target: 20,
      persistWritten: async () => undefined,
    });
    reporter.setCounts({ certified: 3, written: 3 });
    expect(reporter.counts()).toEqual({ written: 3, certified: 3, target: 20 });

    // A refill round continues from what is certified; never above target.
    expect(reporter.reportWritten(25)).toEqual({
      written: 20,
      certified: 3,
      target: 20,
    });
    // A lower count never moves the number backwards.
    expect(reporter.reportWritten(2).written).toBe(20);

    expect(reporter.reportChecked(6, 20, 1)).toEqual({
      written: 20,
      certified: 3,
      target: 20,
      checked: 6,
      checkTotal: 20,
      checkPass: 1,
    });
    expect(reporter.reportChecked(12, 20, 2).checkPass).toBe(2);
    reporter.clearChecked();
    expect(reporter.counts()).toEqual({ written: 20, certified: 3, target: 20 });
  });

  it("swallows a failed durable write so the live count never kills the build", async () => {
    const reporter = createGenerationProgressReporter({
      target: 20,
      persistWritten: async () => {
        throw new Error("lost the row");
      },
    });
    reporter.reportWritten(1);
    await expect(reporter.settle()).resolves.toBeUndefined();
  });
});
