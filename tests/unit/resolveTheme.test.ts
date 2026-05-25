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

    it("skips invalid host.default_theme_key and falls to system default", () => {
      expect(
        resolveTheme(null, { default_theme_key: "midnight-jazz-vibes" }),
      ).toBe(SYSTEM_DEFAULT_THEME);
    });
  });

  describe("layer 3: system default", () => {
    it("falls back when both inputs are null", () => {
      expect(resolveTheme(null, null)).toBe(SYSTEM_DEFAULT_THEME);
    });

    it("falls back when both inputs are undefined", () => {
      expect(resolveTheme(undefined, undefined)).toBe(SYSTEM_DEFAULT_THEME);
    });

    it("falls back when host has empty object (migration 0006 not yet applied)", () => {
      // Pre-migration: hosts row lacks default_theme_key column → reads
      // as undefined. The audience TV with no night override would hit
      // this in the in-between window.
      expect(resolveTheme(null, {})).toBe(SYSTEM_DEFAULT_THEME);
    });

    it("SYSTEM_DEFAULT_THEME matches the layout default ('daylight')", () => {
      // Sanity check: if this fails, app/layout.tsx and resolveTheme
      // disagree about the first-paint theme — back to the inconsistency
      // bug that motivated this PR.
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

    it("the first host's Halloween night (intentional override): renders 'october'", () => {
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

    it("Standalone audience TV with no host context: system default", () => {
      // /tv/[code] doesn't auth a host. If the night has no override and
      // we never load the host row, we hit the floor.
      expect(resolveTheme({ theme_key: null }, undefined)).toBe(
        SYSTEM_DEFAULT_THEME,
      );
    });
  });
});
