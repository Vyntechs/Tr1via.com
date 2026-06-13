// recoveryBackoff — pure schedule for the "unreachable" self-healing retry.
//
// While a surface can't reach the server, it re-checks on a backing-off,
// jittered cadence (2s → 4s → 8s cap) that STOPS the moment a read succeeds.
// Jitter de-syncs a whole room of phones so they don't all retry in the same
// instant when shared venue WiFi returns (the reason-scale-free lesson).

import { describe, it, expect } from "vitest";
import {
  recoveryDelayMs,
  RECOVERY_BASE_DELAYS_MS,
  RECOVERY_JITTER,
} from "@/lib/realtime/recoveryBackoff";

describe("recoveryDelayMs", () => {
  it("backs off 2s → 4s → 8s at the midpoint (rand = 0.5, no net jitter)", () => {
    expect(recoveryDelayMs(0, 0.5)).toBe(2000);
    expect(recoveryDelayMs(1, 0.5)).toBe(4000);
    expect(recoveryDelayMs(2, 0.5)).toBe(8000);
  });

  it("caps at the last base delay for any further attempts", () => {
    expect(recoveryDelayMs(3, 0.5)).toBe(8000);
    expect(recoveryDelayMs(99, 0.5)).toBe(8000);
  });

  it("applies ±jitter so a room of clients de-syncs (rand = 0 → floor, rand → 1 → ceil)", () => {
    // floor = base * (1 - JITTER), ceil ≈ base * (1 + JITTER)
    expect(recoveryDelayMs(0, 0)).toBe(2000 * (1 - RECOVERY_JITTER));
    expect(recoveryDelayMs(0, 1)).toBeCloseTo(2000 * (1 + RECOVERY_JITTER), 5);
  });

  it("never returns a non-positive delay regardless of attempt or rand", () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      for (const rand of [0, 0.25, 0.5, 0.75, 0.999]) {
        expect(recoveryDelayMs(attempt, rand)).toBeGreaterThan(0);
      }
    }
  });

  it("exposes the documented schedule and jitter constants", () => {
    expect(RECOVERY_BASE_DELAYS_MS).toEqual([2000, 4000, 8000]);
    expect(RECOVERY_JITTER).toBe(0.25);
  });
});
