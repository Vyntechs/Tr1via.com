import { describe, it, expect } from "vitest";
import {
  lockInCeremonyFor,
  hasMarquee,
  questionDurationFor,
} from "@/lib/theme/lockInCeremony";

describe("lockInCeremonyFor", () => {
  it("returns the May/Storm config for themeKey 'may'", () => {
    const cfg = lockInCeremonyFor("may");
    expect(cfg.duration).toBe(25);
    expect(cfg.marquee).toBe(true);
    expect(cfg.ceremony).toBe("lightning");
  });

  it("gives June the 25s timer but no marquee/ceremony (longer-timer opt-in only)", () => {
    const cfg = lockInCeremonyFor("june");
    expect(cfg.duration).toBe(25);
    expect(cfg.marquee).toBe(false);
    expect(cfg.ceremony).toBeNull();
  });

  it("returns the default config (20s, no marquee, no ceremony) for non-opted-in themes", () => {
    for (const k of ["house", "daylight", "january", "december"] as const) {
      const cfg = lockInCeremonyFor(k);
      expect(cfg.duration).toBe(20);
      expect(cfg.marquee).toBe(false);
      expect(cfg.ceremony).toBeNull();
    }
  });
});

describe("hasMarquee", () => {
  it("returns true only for May/Storm", () => {
    expect(hasMarquee("may")).toBe(true);
    expect(hasMarquee("house")).toBe(false);
    expect(hasMarquee("october")).toBe(false);
  });
});

describe("questionDurationFor", () => {
  it("returns 25 for May and June, 20 for everything else", () => {
    expect(questionDurationFor("may")).toBe(25);
    expect(questionDurationFor("june")).toBe(25);
    expect(questionDurationFor("house")).toBe(20);
    expect(questionDurationFor("january")).toBe(20);
  });

  it("returns 20 when themeKey is undefined or invalid", () => {
    expect(questionDurationFor(undefined)).toBe(20);
    // @ts-expect-error testing runtime fallback
    expect(questionDurationFor("notatheme")).toBe(20);
  });
});
