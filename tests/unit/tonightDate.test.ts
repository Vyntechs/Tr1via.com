// isNightToday — decides whether a night's date is actually "today", so the
// dashboard only says "TONIGHT" when it means it. Dates are built locally
// (not parsed from fixed-zone ISO literals) so the assertions hold regardless
// of the test runner's timezone.

import { describe, expect, it } from "vitest";
import { isNightToday } from "@/lib/host/tonightDate";

describe("isNightToday", () => {
  it("true when the night's date is the same calendar day as now", () => {
    expect(
      isNightToday(new Date(2026, 5, 3, 9, 0), new Date(2026, 5, 3, 16, 58)),
    ).toBe(true);
  });

  it("false when the night is a previous day (a stale, never-closed night)", () => {
    // The exact prod situation: a May-31 test night still open on June 3.
    expect(
      isNightToday(new Date(2026, 4, 31, 20, 28), new Date(2026, 5, 3, 16, 58)),
    ).toBe(false);
  });

  it("false when the night is scheduled for a future day", () => {
    expect(
      isNightToday(new Date(2026, 5, 10, 18, 0), new Date(2026, 5, 3, 16, 58)),
    ).toBe(false);
  });

  it("accepts an ISO string the way the night row stores it", () => {
    const iso = new Date(2026, 5, 3, 9, 0).toISOString();
    expect(isNightToday(iso, new Date(2026, 5, 3, 16, 58))).toBe(true);
  });

  it("does not treat the same day-of-month in a different month as today", () => {
    expect(
      isNightToday(new Date(2026, 4, 3, 9, 0), new Date(2026, 5, 3, 16, 58)),
    ).toBe(false);
  });
});
