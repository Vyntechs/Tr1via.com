// themeVars — map a ThemeKey to the inline CSS-var object a marketing section
// needs to fully paint itself in that month's palette.
//
// READ-ONLY consumer of the theme system: it imports the token table and the
// pure `resolveTheme` derivation and never mutates global theme state, so
// nothing the host / player / TV renders is affected. This is what lets the
// marketing "Year Scroll" wear all 12 themes (a different one per section) by
// setting vars inline in the server-rendered HTML — no change to the shared
// `app/themes.generated.css`, and readable with zero client JS.
import type { CSSProperties } from "react";
import { TR1VIA_THEMES, type ThemeKey } from "@/lib/theme/tokens";
import { resolveTheme } from "@/lib/theme/resolve";

export function themeVars(key: ThemeKey): CSSProperties {
  const def = TR1VIA_THEMES[key];
  const r = resolveTheme(key);
  return {
    ["--paper" as string]: def.paper,
    ["--ink" as string]: def.ink,
    ["--accent" as string]: def.accent,
    ["--pop" as string]: def.pop,
    ["--correct" as string]: def.correct,
    ["--wrong" as string]: def.wrong,
    ["--surface" as string]: r.surface,
    ["--surface-h" as string]: r.surfaceH,
    ["--ink-mid" as string]: r.inkMid,
    ["--ink-mute" as string]: r.inkMute,
    ["--line" as string]: r.line,
    ["--line-soft" as string]: r.lineSoft,
    colorScheme: def.mode,
  };
}
