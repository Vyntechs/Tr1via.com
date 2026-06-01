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

  it("gives every non-registered theme the 25s default (no marquee/ceremony)", () => {
    for (const k of ["house", "daylight", "january", "june", "december"] as const) {
      const cfg = lockInCeremonyFor(k);
      expect(cfg.duration).toBe(25);
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
  it("returns 25 for every theme (the default)", () => {
    expect(questionDurationFor("may")).toBe(25);
    expect(questionDurationFor("june")).toBe(25);
    expect(questionDurationFor("house")).toBe(25);
    expect(questionDurationFor("january")).toBe(25);
  });

  it("returns 25 when themeKey is undefined or invalid", () => {
    expect(questionDurationFor(undefined)).toBe(25);
    // @ts-expect-error testing runtime fallback
    expect(questionDurationFor("notatheme")).toBe(25);
  });
});
