import { describe, it, expect } from "vitest";
import { shouldHoldReveal } from "@/lib/tv/revealPause";

describe("shouldHoldReveal", () => {
  it("returns false when the timer hasn't expired yet", () => {
    expect(
      shouldHoldReveal({
        timerExpired: false,
        pendingCount: 5,
        expiredAtMs: null,
        nowMs: 1000,
        ceremonyEnabled: true,
      })
    ).toBe(false);
  });

  it("returns false when ceremony is not enabled (non-May)", () => {
    expect(
      shouldHoldReveal({
        timerExpired: true,
        pendingCount: 5,
        expiredAtMs: 1000,
        nowMs: 1500,
        ceremonyEnabled: false,
      })
    ).toBe(false);
  });

  it("returns false when no events pending", () => {
    expect(
      shouldHoldReveal({
        timerExpired: true,
        pendingCount: 0,
        expiredAtMs: 1000,
        nowMs: 1500,
        ceremonyEnabled: true,
      })
    ).toBe(false);
  });

  it("returns true when events pending and within 3s of expiry", () => {
    expect(
      shouldHoldReveal({
        timerExpired: true,
        pendingCount: 3,
        expiredAtMs: 1000,
        nowMs: 2999,
        ceremonyEnabled: true,
      })
    ).toBe(true);
  });

  it("returns false when 3s+ has elapsed since expiry (hard cap)", () => {
    expect(
      shouldHoldReveal({
        timerExpired: true,
        pendingCount: 3,
        expiredAtMs: 1000,
        nowMs: 4001,
        ceremonyEnabled: true,
      })
    ).toBe(false);
  });

  it("returns true when expiredAtMs is null (just expired, no timestamp yet)", () => {
    expect(
      shouldHoldReveal({
        timerExpired: true,
        pendingCount: 1,
        expiredAtMs: null,
        nowMs: 1000,
        ceremonyEnabled: true,
      })
    ).toBe(true);
  });
});
