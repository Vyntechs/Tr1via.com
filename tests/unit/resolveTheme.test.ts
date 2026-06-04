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
      // Host default uses a non-seasonal lock so this asserts the fall-through
      // mechanic, not the seasonal-month behavior (covered in its own block).
      expect(
        resolveTheme(
          { theme_key: "midnight-jazz-vibes" },
          { default_theme_key: "daylight" },
        ),
      ).toBe("daylight");
    });

    it("treats null night.theme_key as 'no override'", () => {
      expect(
        resolveTheme(
          { theme_key: null },
          { default_theme_key: "house" },
        ),
      ).toBe("house");
    });

    it("treats undefined night.theme_key as 'no override'", () => {
      expect(
        resolveTheme(
          { theme_key: undefined },
          { default_theme_key: "daylight" },
        ),
      ).toBe("daylight");
    });
  });

  describe("layer 2: host preference (non-seasonal locks only)", () => {
    // Only deliberate, non-seasonal themes (house, daylight) act as a fixed
    // host preference. Seasonal months in this slot follow the live calendar
    // instead — see the dedicated block below.
    it("uses host.default_theme_key when night is null", () => {
      expect(
        resolveTheme(null, { default_theme_key: "house" }),
      ).toBe("house");
    });

    it("uses host.default_theme_key when night is undefined", () => {
      expect(
        resolveTheme(undefined, { default_theme_key: "daylight" }),
      ).toBe("daylight");
    });

    it("uses host.default_theme_key when night object exists but theme_key missing", () => {
      expect(
        resolveTheme({}, { default_theme_key: "house" }),
      ).toBe("house");
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

    it("Standalone audience TV with no host context: uses current month", () => {
      // /tv/[code] doesn't auth a host. If the night has no override and
      // we never load the host row, we now use the current month's theme
      // instead of the bare 'daylight' fallback — a brand-new venue in
      // May sees the storm theme automatically.
      const may = new Date(2026, 4, 15);
      expect(resolveTheme({ theme_key: null }, undefined, may)).toBe("may");
    });
  });

  // A host-level theme that is one of the 12 calendar months is NOT a fixed
  // preference — the months ARE the auto-rotating season. So a month sitting
  // in host.default_theme_key means "follow the season", and resolveTheme
  // defers to the live calendar instead of honoring the literal stored month.
  // Non-month themes (house, daylight) remain deliberate, honored locks.
  //
  // Why this matters: a stale `default_theme_key='may'` was frozen into prod
  // by a one-time manual edit. Before this contract it shadowed the calendar
  // forever — wrong every month. After it, the season is computed live and
  // self-heals, with nothing stored to rot.
  describe("host-level seasonal months follow the live calendar (never frozen)", () => {
    it("ignores a stale host month and uses the current month instead", () => {
      // The exact prod bug: host default frozen to 'may', but it's June.
      const june = new Date(2026, 5, 3);
      expect(
        resolveTheme(null, { default_theme_key: "may" }, june),
      ).toBe("june");
    });

    it("self-heals every month from the same frozen value", () => {
      // Same stale 'may' on the host — one month later it must roll to July
      // on its own, proving nothing is stored that can go stale.
      const july = new Date(2026, 6, 10);
      expect(
        resolveTheme(null, { default_theme_key: "may" }, july),
      ).toBe("july");
      const december = new Date(2026, 11, 1);
      expect(
        resolveTheme(null, { default_theme_key: "may" }, december),
      ).toBe("december");
    });

    it("a host month matching the current month still resolves to that month", () => {
      // Belt-and-suspenders: when the frozen month happens to equal the live
      // month, the result is the same either way — no surprise.
      const may = new Date(2026, 4, 15);
      expect(
        resolveTheme(null, { default_theme_key: "may" }, may),
      ).toBe("may");
    });

    it("still honors a non-seasonal host lock (house) regardless of month", () => {
      // 'house' is a deliberate, non-seasonal brand lock — a host who wants
      // pub-night year-round keeps it. Not a month, so it is honored.
      const june = new Date(2026, 5, 3);
      expect(
        resolveTheme(null, { default_theme_key: "house" }, june),
      ).toBe("house");
    });

    it("still honors a non-seasonal host lock (daylight) regardless of month", () => {
      const october = new Date(2026, 9, 15);
      expect(
        resolveTheme(null, { default_theme_key: "daylight" }, october),
      ).toBe("daylight");
    });

    it("a deliberately-picked per-night month override still wins", () => {
      // Per-night theme is an explicit pick for THAT night (a Halloween
      // night, a finale). It wins even when it's a month and even over a
      // host default and the current calendar.
      const june = new Date(2026, 5, 3);
      expect(
        resolveTheme(
          { theme_key: "october" },
          { default_theme_key: "may" },
          june,
        ),
      ).toBe("october");
    });
  });
});
