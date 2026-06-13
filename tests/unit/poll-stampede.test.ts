// poll-stampede — scale-free proof that the degraded-mode poll cadence
// de-syncs a whole room. Each client picks its next poll delay independently
// via jittered backoff; this asserts that N clients reconnecting at the SAME
// instant spread their first poll across the jitter window instead of firing
// together (the reason-scale-free-not-observed-count lesson: the guarantee must
// hold at ANY N, shown by distribution, not one observed count).

import { describe, it, expect } from "vitest";
import { jitteredDelayMs, RECOVERY_JITTER } from "@/lib/realtime/recoveryBackoff";
import { ROOM_POLL_BASE_MS } from "@/lib/hooks/useRoomRoutePoll";

// Deterministic spread of "random" values across [0,1) so the test doesn't
// depend on Math.random (which is unavailable/var-free in some contexts here).
function spreadRandoms(n: number): number[] {
  // Low-discrepancy-ish: golden-ratio additive recurrence → well-distributed.
  const out: number[] = [];
  let x = 0.137;
  const g = 0.618033988749895;
  for (let i = 0; i < n; i++) {
    x = (x + g) % 1;
    out.push(x);
  }
  return out;
}

describe("degraded-mode poll cadence de-syncs the room", () => {
  const window = ROOM_POLL_BASE_MS * 2 * RECOVERY_JITTER; // total jitter span (ms)
  const lo = ROOM_POLL_BASE_MS * (1 - RECOVERY_JITTER);
  const hi = ROOM_POLL_BASE_MS * (1 + RECOVERY_JITTER);

  it.each([5, 10, 25, 50, 75])(
    "spreads %i clients' first poll across the jitter window (no alignment)",
    (n) => {
      const delays = spreadRandoms(n).map((r) => jitteredDelayMs([ROOM_POLL_BASE_MS], 0, r));

      // Every delay sits inside the expected jitter window.
      for (const d of delays) {
        expect(d).toBeGreaterThanOrEqual(lo - 1);
        expect(d).toBeLessThanOrEqual(hi + 1);
      }

      // Bucket into 250ms bins; no bin may hold more than 40% of clients —
      // i.e. they do NOT all land together (a stampede would put ~100% in one).
      const BIN = 250;
      const bins = new Map<number, number>();
      for (const d of delays) {
        const b = Math.floor(d / BIN);
        bins.set(b, (bins.get(b) ?? 0) + 1);
      }
      const maxBin = Math.max(...bins.values());
      expect(maxBin).toBeLessThanOrEqual(Math.ceil(n * 0.4));

      // The cohort actually spans most of the jitter window (real de-sync,
      // not a narrow cluster) — only assert for N large enough to fill it.
      if (n >= 25) {
        const span = Math.max(...delays) - Math.min(...delays);
        expect(span).toBeGreaterThan(window * 0.6);
      }
    },
  );
});
