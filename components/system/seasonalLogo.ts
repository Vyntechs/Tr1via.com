import { isSeasonalMonthThemeKey, themeKeyForMonth } from "@/lib/theme/resolveTheme";
import type { ThemeKey } from "@/lib/theme/tokens";

export function seasonalLogoSkinForTheme(
  themeKey: ThemeKey,
  now: Date = new Date(),
): ThemeKey {
  if (isSeasonalMonthThemeKey(themeKey)) return themeKey;
  return themeKeyForMonth(now.getMonth() + 1) ?? themeKey;
}
