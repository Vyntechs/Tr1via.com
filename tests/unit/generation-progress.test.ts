import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGenerationProgressReporter,
  writtenAfterBatch,
} from "@/lib/ai/generation-progress";

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
    reporter.setCounts({ certified: 3, written: 3, clean: 3 });
    expect(reporter.counts()).toEqual({ written: 3, certified: 3, clean: 3, target: 20 });

    // A refill round continues from what is certified; never above target.
    expect(reporter.reportWritten(25)).toEqual({
      written: 20,
      certified: 3,
      clean: 3,
      target: 20,
    });
    // A lower count never moves the number backwards.
    expect(reporter.reportWritten(2).written).toBe(20);

    expect(reporter.reportChecked(6, 20, 1)).toEqual({
      written: 20,
      certified: 3,
      clean: 3,
      target: 20,
      checked: 6,
      checkTotal: 40,
    });
    expect(reporter.reportChecked(12, 20, 2).checked).toBe(18);
    reporter.clearChecked();
    expect(reporter.counts()).toEqual({ written: 20, certified: 3, clean: 3, target: 20 });
    // On a reroll nothing is saved until the swap: clean climbs alone.
    reporter.setCounts({ certified: 0, clean: 17 });
    expect(reporter.counts()).toMatchObject({ certified: 0, clean: 17 });
    reporter.setCounts({ clean: 99 });
    expect(reporter.counts().clean).toBe(20);
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

  it("carries the last round's failure count only once it is set, and forgets it on null", () => {
    const reporter = createGenerationProgressReporter({
      target: 20,
      persistWritten: async () => undefined,
    });
    expect(reporter.counts()).not.toHaveProperty("failedLastRound");
    reporter.setCounts({ clean: 17, failedLastRound: 3 });
    expect(reporter.counts()).toMatchObject({ clean: 17, failedLastRound: 3 });
    // A later patch without the field keeps it (writing the replacements).
    reporter.setCounts({ written: 18 });
    reporter.clearChecked();
    expect(reporter.counts().failedLastRound).toBe(3);
    // The next round's check finished: no number until its own is set.
    reporter.setCounts({ failedLastRound: null });
    expect(reporter.counts()).not.toHaveProperty("failedLastRound");
    reporter.setCounts({ clean: 19, failedLastRound: 2 });
    expect(reporter.counts().failedLastRound).toBe(2);
  });

  it("sums the two check passes that run at the same time, never backward", () => {
    const reporter = createGenerationProgressReporter({
      target: 20,
      persistWritten: async () => undefined,
    });
    // Both passes seed at 0, then their chunk reports arrive interleaved.
    reporter.reportChecked(0, 20, 1);
    reporter.reportChecked(0, 20, 2);
    const seen: Array<[number | undefined, number | undefined]> = [];
    for (const [c, pass] of [
      [6, 2], [6, 1], [12, 2], [12, 1], [18, 1], [18, 2], [20, 2], [20, 1],
    ] as const) {
      const counts = reporter.reportChecked(c, 20, pass);
      seen.push([counts.checked, counts.checkTotal]);
    }
    expect(seen.map(([, total]) => total)).toEqual(Array(8).fill(40));
    const checked = seen.map(([n]) => n ?? -1);
    expect(checked).toEqual([6, 12, 18, 24, 30, 36, 38, 40]);
    // A stale lower report for one pass can't pull the sum down.
    expect(reporter.reportChecked(6, 20, 1).checked).toBe(40);
    // A pass finishing first doesn't claim the whole stage is done.
    reporter.clearChecked();
    expect(reporter.reportChecked(20, 20, 2)).toMatchObject({ checked: 20, checkTotal: 40 });
  });
});

describe("writtenAfterBatch", () => {
  it("never lowers the shown count when the schema check drops questions", () => {
    // Stream showed 20; two failed the schema check.
    expect(writtenAfterBatch({ shown: 20, need: 20, batchLength: 18, target: 20 })).toBe(20);
    // Refill round: 15 clean, 6 asked, 6 returned -> capped at target.
    expect(writtenAfterBatch({ shown: 20, need: 5, batchLength: 6, target: 20 })).toBe(20);
    // Resume where the shown count is lower: the batch raises it honestly.
    expect(writtenAfterBatch({ shown: 12, need: 8, batchLength: 5, target: 20 })).toBe(17);
  });
});
