// resolveTheme — single source of truth for "what theme should this surface
// render in?"
//
// Before this helper, every per-night route hardcoded `night.theme_key ??
// "house"` (and "house" defaults rippled through the night-creation API +
// the DB column default). The result Brandon saw: clicking "Set up
// Wednesday" from a dashboard rendered in 'daylight' would flip the next
// page to 'house' because his existing night was stamped 'house' at
// create-time.
//
// The fix isn't a different hardcoded fallback — it's a missing layer.
// Theme now resolves as:
//
//   night.theme_key  ??  host.default_theme_key  ??  SYSTEM_DEFAULT
//   └─ optional         └─ the host's            └─ true fallback,
//      override for       preference                only for brand-new
//      special events    (set once, used           hosts before they
//      (Halloween,       on every page they        pick anything)
//      finale, etc)      visit)
//
// SYSTEM_DEFAULT is the true last-resort fallback. The public root layout now
// seasonalizes (resolveTheme(null, null) → current month), so login, code-entry
// and first paint follow the live season; daylight only shows if month
// resolution itself somehow fails.
//
// Tolerant by design: every input is optional. Pass undefined for night
// on a non-night route (uses host preference). Pass undefined for host
// on the standalone audience TV (uses system default). The function never
// throws; the worst case is "fall through to system default."
//
// See: supabase/migrations/0006_host_default_theme.sql

import { isThemeKey, type ThemeKey } from "@/lib/theme/tokens";

/** The hardcoded last-resort fallback. Used ONLY when:
 *  - the host hasn't picked a default (brand-new account)
 *  - AND the night has no override
 *  - AND we're not on a route that even knows about a host
 *  - AND we somehow can't read the current month
 *
 *  Last-resort only; the public root layout renders the current month, not
 *  this constant. Kept as the stable floor for surfaces with no calendar. */
export const SYSTEM_DEFAULT_THEME: ThemeKey = "daylight";

/** Map a 1-12 calendar month to a ThemeKey. Used as a fallback BEFORE
 *  SYSTEM_DEFAULT when the night + host have no explicit pick — so a
 *  brand-new host in May lands on the May storm theme automatically
 *  instead of getting "daylight" forever. */
export function themeKeyForMonth(month: number): ThemeKey | null {
  switch (month) {
    case 1:  return "january";
    case 2:  return "february";
    case 3:  return "march";
    case 4:  return "april";
    case 5:  return "may";
    case 6:  return "june";
    case 7:  return "july";
    case 8:  return "august";
    case 9:  return "september";
    case 10: return "october";
    case 11: return "november";
    case 12: return "december";
    default: return null;
  }
}

/** The 12 calendar-month themes — the auto-rotating season. Derived from
 *  `themeKeyForMonth` so the two never drift apart.
 *
 *  A month is never a fixed *host* preference: the months rotate by design,
 *  so a month sitting in `host.default_theme_key` means "follow the season",
 *  not "lock May forever". When we see one there we defer to the live
 *  calendar (layer 3) instead of honoring the literal stored month — that's
 *  what makes a stale stored season self-heal every month with nothing
 *  saved to rot. Per-night overrides are exempt: picking a month for one
 *  specific night (a Halloween night, a finale) IS a deliberate choice. */
export const SEASONAL_MONTH_KEYS: ReadonlySet<ThemeKey> = new Set(
  Array.from({ length: 12 }, (_, i) => themeKeyForMonth(i + 1)).filter(
    (k): k is ThemeKey => k !== null,
  ),
);

export function isSeasonalMonthThemeKey(value: unknown): value is ThemeKey {
  return isThemeKey(value) && SEASONAL_MONTH_KEYS.has(value);
}

/** Subset of NightRow this helper reads — keeps the input loose so any
 *  shape (snapshot, raw DB row, hand-built test fixture) works. */
export interface NightThemeInput {
  theme_key?: string | null;
}

/** Subset of HostRow this helper reads. `default_theme_key` is optional
 *  to tolerate the in-between window where migration 0006 hasn't been
 *  applied yet — code reading an old hosts row gets undefined here, which
 *  cascades to SYSTEM_DEFAULT rather than blowing up. */
export interface HostThemeInput {
  default_theme_key?: string | null;
}

/**
 * Resolve which ThemeKey to render for a surface.
 *
 * Order:
 *   1. `night.theme_key` if present and valid (per-night override — may be a
 *      month; choosing a month for one night is a deliberate pick).
 *   2. `host.default_theme_key` ONLY if it's a deliberate, non-seasonal lock
 *      (house, daylight, …). A month here is treated as "follow the season"
 *      and skipped — the months rotate by design, so a stored month is never
 *      a fixed preference (see SEASONAL_MONTH_KEYS).
 *   3. Current month's theme (June → "june", October → "october", etc).
 *   4. `SYSTEM_DEFAULT_THEME` ("daylight") — last resort.
 *
 * Layer 3 is the real default: with no per-night override and no non-seasonal
 * host lock, every surface follows the live calendar and rolls forward each
 * month on its own. Nothing seasonal is ever stored, so nothing can go stale.
 *
 * Invalid theme strings at any layer are skipped (not coerced) — guards
 * against legacy values that have since been removed from the THEME_KEYS
 * registry. Falls through to the next layer rather than throwing.
 *
 * Pass `now` to make the month-fallback deterministic in tests.
 */
export function resolveTheme(
  night: NightThemeInput | null | undefined,
  host: HostThemeInput | null | undefined,
  now: Date = new Date(),
): ThemeKey {
  const nightKey = night?.theme_key;
  if (isThemeKey(nightKey)) return nightKey;
  // Host preference is honored only when it's a deliberate, non-seasonal lock
  // (house, daylight, …). A month here means "follow the season" → fall
  // through to the live calendar so it can never freeze on a stale month.
  const hostKey = host?.default_theme_key;
  if (isThemeKey(hostKey) && !isSeasonalMonthThemeKey(hostKey)) return hostKey;
  const monthKey = themeKeyForMonth(now.getMonth() + 1);
  if (monthKey) return monthKey;
  return SYSTEM_DEFAULT_THEME;
}
