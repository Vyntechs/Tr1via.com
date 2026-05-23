import { describe, it, expect } from "vitest";
import { secondsRemaining, timerFraction } from "@/lib/game/timer";

describe("secondsRemaining", () => {
  it("returns full duration when revealed right now", () => {
    const now = 1_700_000_000_000;
    expect(secondsRemaining({ revealedAtMs: now, durationS: 20, nowMs: now })).toBe(20);
  });

  it("returns duration minus elapsed when partway through", () => {
    const revealedAt = 1_700_000_000_000;
    const now = revealedAt + 5_000; // 5 seconds later
    expect(secondsRemaining({ revealedAtMs: revealedAt, durationS: 20, nowMs: now })).toBe(15);
  });

  it("clamps to 0 when revealed longer ago than duration", () => {
    const revealedAt = 1_700_000_000_000;
    const now = revealedAt + 25_000; // 25 seconds later, duration 20
    expect(secondsRemaining({ revealedAtMs: revealedAt, durationS: 20, nowMs: now })).toBe(0);
  });

  it("clamps to durationS when revealed in the future (negative elapsed)", () => {
    const revealedAt = 1_700_000_000_000;
    const now = revealedAt - 10_000; // 10 seconds before reveal
    expect(secondsRemaining({ revealedAtMs: revealedAt, durationS: 20, nowMs: now })).toBe(20);
  });

  it("clamps to 0 at exactly the boundary (elapsed === duration)", () => {
    const revealedAt = 1_700_000_000_000;
    const now = revealedAt + 20_000;
    expect(secondsRemaining({ revealedAtMs: revealedAt, durationS: 20, nowMs: now })).toBe(0);
  });

  it("returns fractional seconds for sub-second resolution", () => {
    const revealedAt = 1_700_000_000_000;
    const now = revealedAt + 500; // 0.5s later
    expect(secondsRemaining({ revealedAtMs: revealedAt, durationS: 20, nowMs: now })).toBe(19.5);
  });

  it("uses Date.now() when nowMs is omitted", () => {
    const now = Date.now();
    const result = secondsRemaining({ revealedAtMs: now, durationS: 20 });
    // Within a hair of 20s (allowing test execution overhead).
    expect(result).toBeGreaterThan(19.9);
    expect(result).toBeLessThanOrEqual(20);
  });

  it("works with non-20 durations", () => {
    const revealedAt = 1_000;
    expect(secondsRemaining({ revealedAtMs: revealedAt, durationS: 10, nowMs: 5_000 })).toBe(6);
    expect(secondsRemaining({ revealedAtMs: revealedAt, durationS: 30, nowMs: 16_000 })).toBe(15);
  });
});

describe("timerFraction", () => {
  it("returns 1 when freshly revealed", () => {
    const now = 1_700_000_000_000;
    expect(timerFraction({ revealedAtMs: now, durationS: 20, nowMs: now })).toBe(1);
  });

  it("returns 0 when fully elapsed", () => {
    const revealedAt = 1_700_000_000_000;
    expect(
      timerFraction({ revealedAtMs: revealedAt, durationS: 20, nowMs: revealedAt + 30_000 })
    ).toBe(0);
  });

  it("returns 0.5 at the halfway point", () => {
    const revealedAt = 1_700_000_000_000;
    expect(
      timerFraction({ revealedAtMs: revealedAt, durationS: 20, nowMs: revealedAt + 10_000 })
    ).toBe(0.5);
  });

  it("matches secondsRemaining/durationS exactly", () => {
    const revealedAt = 1_700_000_000_000;
    const nowMs = revealedAt + 7_321;
    const durationS = 20;
    const sec = secondsRemaining({ revealedAtMs: revealedAt, durationS, nowMs });
    const frac = timerFraction({ revealedAtMs: revealedAt, durationS, nowMs });
    expect(frac).toBeCloseTo(sec / durationS, 10);
  });

  it("clamps to [0, 1]", () => {
    const revealedAt = 1_700_000_000_000;
    expect(
      timerFraction({ revealedAtMs: revealedAt, durationS: 20, nowMs: revealedAt - 5_000 })
    ).toBe(1);
    expect(
      timerFraction({ revealedAtMs: revealedAt, durationS: 20, nowMs: revealedAt + 100_000 })
    ).toBe(0);
  });
});
