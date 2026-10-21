// Live, truthful progress for one category build.
//
// The writer streams question-by-question counts and the fact-checker reports
// each finished chunk. This module turns those bursts into (a) a throttled
// durable write of `written_count` (at most one DB write per
// `minWriteIntervalMs`, always ending on the latest value) and (b) the count
// fields every `progress` broadcast carries, so the host client has one
// source. Nothing here is a fake animation: every number is a real count.
//
// Pure: the DB write and the broadcast are injected, so this is unit-tested
// without Supabase (tests/unit/generation-progress.test.ts).

export interface GenerationProgressCounts {
  /** Questions written so far (capped at target). */
  written: number;
  /** Questions that passed every check so far. */
  certified: number;
  /** The deck size being built. */
  target: number;
  /** Questions fact-checked so far in the current pass. */
  checked?: number;
  /** Batch size being checked. */
  checkTotal?: number;
  /** 1 = blind pass, 2 = adversarial pass. */
  checkPass?: 1 | 2;
}

export interface GenerationProgressReporterOptions {
  target: number;
  /** Minimum gap between durable `written_count` writes. Default 1500ms. */
  minWriteIntervalMs?: number;
  /** Durable write of the latest written count. Errors are swallowed here. */
  persistWritten: (written: number) => Promise<void>;
  now?: () => number;
}

export interface GenerationProgressReporter {
  /** Writer streamed a new count. Throttles the DB write, returns the counts. */
  reportWritten: (count: number) => GenerationProgressCounts;
  /** Checker finished a chunk. No DB write (no column for it); returns counts. */
  reportChecked: (
    checked: number,
    total: number,
    pass: 1 | 2,
  ) => GenerationProgressCounts;
  /** Keep the reporter in step with the route's own counters. */
  setCounts: (patch: { written?: number; certified?: number }) => void;
  /** Forget the checking fields (a new writing round started). */
  clearChecked: () => void;
  /** Current count fields for a progress broadcast. */
  counts: () => GenerationProgressCounts;
  /**
   * Cancel any pending trailing write and wait for an in-flight one. Call
   * before an authoritative phase write so a late timer can't overwrite it.
   */
  settle: () => Promise<void>;
}

export function createGenerationProgressReporter(
  opts: GenerationProgressReporterOptions,
): GenerationProgressReporter {
  const target = Math.max(1, opts.target);
  const minGap = opts.minWriteIntervalMs ?? 1_500;
  const now = opts.now ?? (() => Date.now());

  let written = 0;
  let certified = 0;
  let checked: number | undefined;
  let checkTotal: number | undefined;
  let checkPass: 1 | 2 | undefined;

  let lastWriteAt = Number.NEGATIVE_INFINITY;
  let lastWrittenValue = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const counts = (): GenerationProgressCounts => ({
    written,
    certified,
    target,
    ...(checked === undefined ? {} : { checked }),
    ...(checkTotal === undefined ? {} : { checkTotal }),
    ...(checkPass === undefined ? {} : { checkPass }),
  });

  const flushWrite = () => {
    timer = undefined;
    if (written === lastWrittenValue) return;
    lastWriteAt = now();
    lastWrittenValue = written;
    const value = written;
    inFlight = inFlight
      .then(() => opts.persistWritten(value))
      .catch(() => undefined);
  };

  const scheduleWrite = () => {
    if (timer) return; // a trailing write is already queued; it reads `written` when it fires
    const elapsed = now() - lastWriteAt;
    if (elapsed >= minGap) {
      flushWrite();
      return;
    }
    timer = setTimeout(flushWrite, minGap - elapsed);
  };

  return {
    reportWritten(count) {
      const next = Math.min(target, Math.max(0, Math.floor(count)));
      if (next > written) {
        written = next;
        scheduleWrite();
      }
      return counts();
    },
    reportChecked(c, total, pass) {
      checked = Math.max(0, c);
      checkTotal = Math.max(0, total);
      checkPass = pass;
      return counts();
    },
    setCounts(patch) {
      if (patch.written !== undefined) {
        written = Math.min(target, Math.max(0, patch.written));
        // The route wrote this value itself; a trailing write would be a repeat.
        lastWrittenValue = written;
      }
      if (patch.certified !== undefined) {
        certified = Math.min(target, Math.max(0, patch.certified));
      }
    },
    clearChecked() {
      checked = undefined;
      checkTotal = undefined;
      checkPass = undefined;
    },
    counts,
    async settle() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await inFlight;
    },
  };
}
