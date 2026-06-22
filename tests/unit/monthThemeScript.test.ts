// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MONTH_THEME_KEYS,
  MONTH_THEME_SCRIPT,
  monthThemeKey,
} from "@/lib/theme/monthThemeScript";

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute("data-theme");
});

describe("monthThemeScript", () => {
  it("MONTH_THEME_KEYS lists all 12 months in calendar order", () => {
    expect(MONTH_THEME_KEYS).toEqual([
      "january", "february", "march", "april", "may", "june",
      "july", "august", "september", "october", "november", "december",
    ]);
  });

  it("monthThemeKey maps JS month index (0-11) to the right theme", () => {
    expect(monthThemeKey(5)).toBe("june");
    expect(monthThemeKey(6)).toBe("july");
    expect(monthThemeKey(0)).toBe("january");
    expect(monthThemeKey(11)).toBe("december");
  });

  it("the script sets data-theme to the visitor's live month before paint", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 1)); // July
    // eslint-disable-next-line no-eval
    (0, eval)(MONTH_THEME_SCRIPT);
    expect(document.documentElement.getAttribute("data-theme")).toBe("july");
  });

  it("the script swallows errors and leaves the SSR attribute intact", () => {
    document.documentElement.setAttribute("data-theme", "june");
    // Force getMonth() to throw; the IIFE must not propagate it.
    const spy = vi.spyOn(Date.prototype, "getMonth").mockImplementation(() => {
      throw new Error("boom");
    });
    // eslint-disable-next-line no-eval
    expect(() => (0, eval)(MONTH_THEME_SCRIPT)).not.toThrow();
    expect(document.documentElement.getAttribute("data-theme")).toBe("june");
    spy.mockRestore();
  });
});
