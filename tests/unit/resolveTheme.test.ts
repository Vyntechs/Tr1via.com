// resolveTheme — exhaustive coverage of the layered fallback. Every
// callsite in the app trusts this function to return a valid ThemeKey
// regardless of what's null, undefined, or invalid. A regression here
// would corrupt theming across host + player + TV surfaces.

import { describe, expect, it } from "vitest";
import { resolveTheme, SYSTEM_DEFAULT_THEME } from "@/lib/theme/resolveTheme";

describe("resolveTheme", () => {
  describe("layer 1: night override", () => {
    it("uses night.theme_key when set and valid", () => {
      expect(
        resolveTheme(
          { theme_key: "october" },
          { default_theme_key: "daylight" },
        ),
      ).toBe("october");
    });

    it("night override wins over host preference", () => {
      expect(
        resolveTheme(
          { theme_key: "december" },
          { default_theme_key: "june" },
        ),
      ).toBe("december");
    });

    it("skips invalid night.theme_key and falls to host", () => {
      expect(
        resolveTheme(
          { theme_key: "midnight-jazz-vibes" },
          { default_theme_key: "march" },
        ),
      ).toBe("march");
    });

    it("treats null night.theme_key as 'no override'", () => {
      expect(
        resolveTheme(
          { theme_key: null },
          { default_theme_key: "may" },
        ),
      ).toBe("may");
    });

    it("treats undefined night.theme_key as 'no override'", () => {
      expect(
        resolveTheme(
          { theme_key: undefined },
          { default_theme_key: "august" },
        ),
      ).toBe("august");
    });
  });

  describe("layer 2: host preference", () => {
    it("uses host.default_theme_key when night is null", () => {
      expect(
        resolveTheme(null, { default_theme_key: "november" }),
      ).toBe("november");
    });

    it("uses host.default_theme_key when night is undefined", () => {
      expect(
        resolveTheme(undefined, { default_theme_key: "january" }),
      ).toBe("january");
    });

    it("uses host.default_theme_key when night object exists but theme_key missing", () => {
      expect(
        resolveTheme({}, { default_theme_key: "july" }),
      ).toBe("july");
    });

    it("skips invalid host.default_theme_key and falls to the month layer", () => {
      // Pin to mid-May to assert the next-layer behavior deterministically.
      const may = new Date(2026, 4, 15);
      expect(
        resolveTheme(null, { default_theme_key: "midnight-jazz-vibes" }, may),
      ).toBe("may");
    });
  });

  describe("layer 3: current-month fallback (before system default)", () => {
    // Note: when no explicit theme is set anywhere, we fall through to
    // the current calendar month's theme rather than 'daylight'. So a
    // brand-new host setting up a night in May automatically lands on
    // the May storm theme without anyone having to pick it.
    it("returns the current month's theme when both inputs are null", () => {
      // Pin to mid-May so the month fallback resolves to "may".
      const may = new Date(2026, 4, 15);
      expect(resolveTheme(null, null, may)).toBe("may");
    });

    it("returns the current month's theme when both inputs are undefined", () => {
      const october = new Date(2026, 9, 15);
      expect(resolveTheme(undefined, undefined, october)).toBe("october");
    });

    it("returns the current month's theme when host has empty object", () => {
      const january = new Date(2026, 0, 15);
      expect(resolveTheme(null, {}, january)).toBe("january");
    });

    it("month fallback is reached only after night + host both miss", () => {
      // Night override still wins even if it's December.
      const may = new Date(2026, 4, 15);
      expect(
        resolveTheme({ theme_key: "house" }, null, may),
      ).toBe("house");
      // Host preference still wins even if month would be different.
      expect(
        resolveTheme(null, { default_theme_key: "daylight" }, may),
      ).toBe("daylight");
    });

    it("covers all 12 months", () => {
      const expected: Array<[number, string]> = [
        [0, "january"], [1, "february"], [2, "march"], [3, "april"],
        [4, "may"], [5, "june"], [6, "july"], [7, "august"],
        [8, "september"], [9, "october"], [10, "november"], [11, "december"],
      ];
      for (const [m, key] of expected) {
        expect(resolveTheme(null, null, new Date(2026, m, 15))).toBe(key);
      }
    });

    it("SYSTEM_DEFAULT_THEME matches the layout default ('daylight')", () => {
      // Sanity check: if this fails, app/layout.tsx and resolveTheme
      // disagree about the first-paint theme — back to the inconsistency
      // bug that motivated PR #28.
      expect(SYSTEM_DEFAULT_THEME).toBe("daylight");
    });
  });

  describe("real-world scenarios from the bug report", () => {
    it("Brandon's existing night (pre-backfill): renders 'house'", () => {
      // Migration 0006 applied (column exists) but 0007 backfill not yet
      // run. Existing night still has theme_key='house' as a leftover from
      // the old DB default. Per-night override wins → renders house.
      expect(
        resolveTheme(
          { theme_key: "house" },
          { default_theme_key: "daylight" },
        ),
      ).toBe("house");
    });

    it("Brandon's night (post-backfill): inherits 'daylight' from host", () => {
      // After 0007 backfill flips 'house' rows to null, the override
      // releases and the host preference wins. Consistency restored.
      expect(
        resolveTheme(
          { theme_key: null },
          { default_theme_key: "daylight" },
        ),
      ).toBe("daylight");
    });

    it("Heather's Halloween night (intentional override): renders 'october'", () => {
      // The reason we kept per-night override capability in the first
      // place. Host's default is 'daylight' year-round, but October
      // night gets a themed override.
      expect(
        resolveTheme(
          { theme_key: "october" },
          { default_theme_key: "daylight" },
        ),
      ).toBe("october");
    });

    it("Standalone audience TV with no host context: uses current month", () => {
      // /tv/[code] doesn't auth a host. If the night has no override and
      // we never load the host row, we now use the current month's theme
      // instead of the bare 'daylight' fallback — a brand-new venue in
      // May sees the storm theme automatically.
      const may = new Date(2026, 4, 15);
      expect(resolveTheme({ theme_key: null }, undefined, may)).toBe("may");
    });
  });
});
