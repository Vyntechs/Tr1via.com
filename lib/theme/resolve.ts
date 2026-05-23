import { TR1VIA_THEMES, type ThemeKey } from "./tokens";
import { TR1VIA_CATEGORIES } from "./categories";

/**
 * Resolve a theme key to the full token set including derived surface/line/ink
 * variants. Used at runtime by useTheme(); also used at build time by
 * __build__.ts to emit CSS vars.
 */
export function resolveTheme(themeKey: ThemeKey = "house") {
  const t = TR1VIA_THEMES[themeKey] ?? TR1VIA_THEMES.house;
  const dark = t.mode === "dark";
  return {
    ...t,
    surface:  dark ? "rgba(255,255,255,.04)"  : "rgba(27,19,12,.04)",
    surfaceH: dark ? "rgba(255,255,255,.08)"  : "rgba(27,19,12,.08)",
    inkMid:   dark ? "rgba(244,230,196,.62)" : "rgba(27,19,12,.62)",
    inkMute:  dark ? "rgba(244,230,196,.36)" : "rgba(27,19,12,.36)",
    line:     dark ? "rgba(244,230,196,.14)" : "rgba(27,19,12,.13)",
    lineSoft: dark ? "rgba(244,230,196,.07)" : "rgba(27,19,12,.06)",
    dark,
    categories: TR1VIA_CATEGORIES,
  };
}

export type ResolvedTheme = ReturnType<typeof resolveTheme>;
