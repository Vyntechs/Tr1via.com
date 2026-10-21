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
  /** Questions that passed every check so far (saved as cards). */
  certified: number;
  /** Questions this build holds as clean so far, on every path. Same as
   *  `certified` on a first build, but on an "Another 20" reroll nothing is
   *  saved until the final swap, so `certified` stays 0 while this climbs.
   *  The host's refill maths and "Replacing N" read this, never the cards. */
  clean: number;
  /** The deck size being built. */
  target: number;
  /** Checks finished so far, summed over every pass. The passes run at the
   *  same time, so each pass keeps its own count and this is their sum. */
  checked?: number;
  /** Checks this round needs in all: batch size x number of passes. */
  checkTotal?: number;
}

export interface GenerationProgressReporterOptions {
  target: number;
  /** How many check passes run on each batch (they run at the same time).
   *  Default 2. */
  checkPasses?: number;
  /** Minimum gap between durable `written_count` writes. Default 1500ms. */
  minWriteIntervalMs?: number;
  /** Durable write of the latest written count. Errors are swallowed here. */
  persistWritten: (written: number) => Promise<void>;
  now?: () => number;
}

export interface GenerationProgressReporter {
  /** Writer streamed a new count. Throttles the DB write, returns the counts. */
  reportWritten: (count: number) => GenerationProgressCounts;
  /** Checker finished a chunk. `checked` is that pass's own running count.
   *  No DB write (no column for it); returns counts. */
  reportChecked: (
    checked: number,
    total: number,
    pass: 1 | 2,
  ) => GenerationProgressCounts;
  /** Keep the reporter in step with the route's own counters. */
  setCounts: (patch: {
    written?: number;
    certified?: number;
    clean?: number;
  }) => void;
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
  let clean = 0;
  const passes = Math.max(1, Math.floor(opts.checkPasses ?? 2));
  // One slot per pass. Both passes report chunks at the same time, so a single
  // shared slot would let each overwrite the other and the bar would jump
  // back and forth. Each slot only climbs until clearChecked().
  let checkedByPass: number[] | undefined;
  let checkBatch = 0;

  let lastWriteAt = Number.NEGATIVE_INFINITY;
  let lastWrittenValue = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const counts = (): GenerationProgressCounts => ({
    written,
    certified,
    clean,
    target,
    ...(checkedByPass === undefined
      ? {}
      : {
          checked: Math.min(
            checkBatch * passes,
            checkedByPass.reduce((sum, n) => sum + n, 0),
          ),
          checkTotal: checkBatch * passes,
        }),
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
      if (!checkedByPass) checkedByPass = Array.from({ length: passes }, () => 0);
      // The total is known up front for every pass (same batch), so the
      // denominator never grows after the first report.
      checkBatch = Math.max(checkBatch, Math.max(0, Math.floor(total)));
      const slot = Math.min(passes, Math.max(1, pass)) - 1;
      checkedByPass[slot] = Math.max(
        checkedByPass[slot]!,
        Math.min(checkBatch, Math.max(0, Math.floor(c))),
      );
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
      if (patch.clean !== undefined) {
        clean = Math.min(target, Math.max(0, patch.clean));
      }
    },
    clearChecked() {
      checkedByPass = undefined;
      checkBatch = 0;
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

/**
 * The written count after a writer round returns. `target - need` questions
 * were already clean before the round; `batchLength` is what survived the
 * schema check. The stream may already have shown a higher count (it counts
 * questions the schema check later drops), so never go below `shown`: the
 * host must not see "Writing 20/20" turn into "18/20".
 */
export function writtenAfterBatch(args: {
  shown: number;
  need: number;
  batchLength: number;
  target: number;
}): number {
  const fromBatch = Math.min(
    args.target,
    Math.max(0, args.target - args.need) + Math.max(0, args.batchLength),
  );
  return Math.min(args.target, Math.max(args.shown, fromBatch));
}
