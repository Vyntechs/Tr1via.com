import { describe, it, expect } from "vitest";
import {
  lockInCeremonyFor,
  hasMarquee,
  hasCeremony,
  questionDurationFor,
} from "@/lib/theme/lockInCeremony";

describe("lockInCeremonyFor", () => {
  it("returns the May/Storm config for themeKey 'may'", () => {
    const cfg = lockInCeremonyFor("may");
    expect(cfg.duration).toBe(30);
    expect(cfg.marquee).toBe(true);
    expect(cfg.ceremony).toBe("lightning");
  });

  it("returns the July/4th config for themeKey 'july' (marquee + fireworks)", () => {
    const cfg = lockInCeremonyFor("july");
    expect(cfg.duration).toBe(30);
    expect(cfg.marquee).toBe(true);
    expect(cfg.ceremony).toBe("fireworks");
  });

  it("gives every non-registered theme the 30s default (no marquee/ceremony)", () => {
    for (const k of ["house", "daylight", "january", "june", "december"] as const) {
      const cfg = lockInCeremonyFor(k);
      expect(cfg.duration).toBe(30);
      expect(cfg.marquee).toBe(false);
      expect(cfg.ceremony).toBeNull();
    }
  });
});

describe("hasMarquee", () => {
  it("returns true for the themes that opt in (May, July)", () => {
    expect(hasMarquee("may")).toBe(true);
    expect(hasMarquee("july")).toBe(true);
    expect(hasMarquee("house")).toBe(false);
    expect(hasMarquee("october")).toBe(false);
  });
});

describe("hasCeremony", () => {
  it("is true for themes with a lock-in ceremony (May lightning, July fireworks)", () => {
    expect(hasCeremony("may")).toBe(true);
    expect(hasCeremony("july")).toBe(true);
  });
  it("is false for themes with no ceremony", () => {
    expect(hasCeremony("house")).toBe(false);
    expect(hasCeremony("june")).toBe(false);
    expect(hasCeremony(undefined)).toBe(false);
  });
});

describe("phone lock-in bolt gate (ceremony kind, NOT generic hasCeremony)", () => {
  // Regression: the phone-side PlayerLockInBolt is a LIGHTNING visual. It must
  // gate on ceremony === "lightning", not hasCeremony(), or enabling July's
  // "fireworks" ceremony would fire a lightning strike on July phones (off-theme).
  it("only May (lightning) triggers the phone lightning bolt", () => {
    expect(lockInCeremonyFor("may").ceremony === "lightning").toBe(true);
    expect(lockInCeremonyFor("july").ceremony === "lightning").toBe(false);
    expect(lockInCeremonyFor("house").ceremony === "lightning").toBe(false);
  });
});

describe("questionDurationFor", () => {
  it("returns 30 for every theme (the default)", () => {
    expect(questionDurationFor("may")).toBe(30);
    expect(questionDurationFor("june")).toBe(30);
    expect(questionDurationFor("house")).toBe(30);
    expect(questionDurationFor("january")).toBe(30);
  });

  it("returns 30 when themeKey is undefined or invalid", () => {
    expect(questionDurationFor(undefined)).toBe(30);
    // @ts-expect-error testing runtime fallback
    expect(questionDurationFor("notatheme")).toBe(30);
  });
});
