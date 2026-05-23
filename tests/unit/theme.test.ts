import { describe, it, expect } from "vitest";
import { resolveTheme } from "@/lib/theme/resolve";
import { TR1VIA_THEMES, THEME_KEYS, isThemeKey } from "@/lib/theme/tokens";
import { categoryColor, TR1VIA_CATEGORIES } from "@/lib/theme/categories";

describe("theme tokens", () => {
  it("exports all 14 themes", () => {
    expect(THEME_KEYS).toHaveLength(14);
    expect(THEME_KEYS).toContain("house");
    expect(THEME_KEYS).toContain("daylight");
    expect(THEME_KEYS).toContain("january");
    expect(THEME_KEYS).toContain("december");
  });

  it("every theme has all required color tokens", () => {
    for (const key of THEME_KEYS) {
      const def = TR1VIA_THEMES[key];
      expect(def.paper, `${key}.paper`).toMatch(/^#[0-9A-F]{6}$/i);
      expect(def.ink, `${key}.ink`).toMatch(/^#[0-9A-F]{6}$/i);
      expect(def.accent, `${key}.accent`).toMatch(/^#[0-9A-F]{6}$/i);
      expect(def.pop, `${key}.pop`).toMatch(/^#[0-9A-F]{6}$/i);
      expect(def.correct, `${key}.correct`).toMatch(/^#[0-9A-F]{6}$/i);
      expect(def.wrong, `${key}.wrong`).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("isThemeKey accepts valid keys and rejects garbage", () => {
    expect(isThemeKey("house")).toBe(true);
    expect(isThemeKey("december")).toBe(true);
    expect(isThemeKey("smarch")).toBe(false);
    expect(isThemeKey(null)).toBe(false);
    expect(isThemeKey(42)).toBe(false);
  });
});

describe("resolveTheme", () => {
  it("returns house defaults when no key passed", () => {
    expect(resolveTheme().name).toBe("House · Pub Night");
  });

  it("returns house when an invalid key is passed", () => {
    // @ts-expect-error — deliberately passing junk
    expect(resolveTheme("not-a-theme").name).toBe("House · Pub Night");
  });

  it("derives dark surface tokens for dark themes", () => {
    const t = resolveTheme("house");
    expect(t.dark).toBe(true);
    expect(t.surface).toMatch(/rgba\(255,255,255/);
    expect(t.line).toMatch(/rgba\(244,230,196/);
  });

  it("derives light surface tokens for light themes", () => {
    const t = resolveTheme("daylight");
    expect(t.dark).toBe(false);
    expect(t.surface).toMatch(/rgba\(27,19,12/);
    expect(t.line).toMatch(/rgba\(27,19,12/);
  });

  it("exposes the categories array", () => {
    expect(resolveTheme().categories).toEqual(TR1VIA_CATEGORIES);
  });
});

describe("categoryColor", () => {
  it("returns the registered color for a known category (case-insensitive)", () => {
    expect(categoryColor("Geography")).toBe("#4ECDC4");
    expect(categoryColor("music")).toBe("#9B7BD8");
    expect(categoryColor("FOOD")).toBe("#F2A02D");
  });

  it("falls back to the default for unknowns", () => {
    expect(categoryColor("Klingon History")).toBe("#FF6A3D");
    expect(categoryColor(undefined)).toBe("#FF6A3D");
    expect(categoryColor(null)).toBe("#FF6A3D");
  });

  it("accepts a custom fallback", () => {
    expect(categoryColor("Klingon History", "#000000")).toBe("#000000");
  });
});
