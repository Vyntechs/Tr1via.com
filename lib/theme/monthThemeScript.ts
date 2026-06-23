// The single client-facing month source. Both the pre-paint inline script and
// SeasonalThemeProvider read MONTH_THEME_KEYS, which is DERIVED from the one
// server resolver (resolveTheme) — so the client can never disagree with the
// server about which month wears which palette.
import { resolveTheme } from "@/lib/theme/resolveTheme";
import type { ThemeKey } from "@/lib/theme/tokens";

/** 12 month theme keys in JS-month order: index 0 = January … 11 = December.
 *  Derived from resolveTheme(null, null, <date in month N>) so this list and
 *  the server's month fallback are guaranteed identical. */
export const MONTH_THEME_KEYS: readonly ThemeKey[] = Array.from(
  { length: 12 },
  (_, i) => resolveTheme(null, null, new Date(2026, i, 15)),
);

/** Pure: a JS Date month index (0-11) → the month's ThemeKey. */
export function monthThemeKey(monthIndex: number): ThemeKey | undefined {
  return MONTH_THEME_KEYS[monthIndex];
}

/** A render-blocking IIFE for the top of <body>. It reads the visitor's LIVE
 *  local month and sets data-theme before first paint, so a statically-cached
 *  page flips at a month boundary with no flash and without forcing dynamic
 *  rendering. Self-contained vanilla JS (no imports at runtime); on any error
 *  it no-ops and the SSR-rendered data-theme stands. */
export const MONTH_THEME_SCRIPT = `(function(){try{var k=${JSON.stringify(
  MONTH_THEME_KEYS,
)};var t=k[new Date().getMonth()];if(t){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;
