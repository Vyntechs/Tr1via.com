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
// SYSTEM_DEFAULT matches `app/layout.tsx`'s root <ThemeProvider> so any
// surface rendered before a host loads (login, code-entry, first paint)
// stays consistent with the user's experience after auth.
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
 *
 *  Matches `app/layout.tsx`'s root <ThemeProvider> so the first paint
 *  before any auth/data lands is stable. */
export const SYSTEM_DEFAULT_THEME: ThemeKey = "daylight";

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
 *   1. `night.theme_key` if present and valid (per-night override).
 *   2. `host.default_theme_key` if present and valid (host preference).
 *   3. `SYSTEM_DEFAULT_THEME` ("daylight").
 *
 * Invalid theme strings at any layer are skipped (not coerced) — guards
 * against legacy values that have since been removed from the THEME_KEYS
 * registry. Falls through to the next layer rather than throwing.
 */
export function resolveTheme(
  night: NightThemeInput | null | undefined,
  host: HostThemeInput | null | undefined,
): ThemeKey {
  const nightKey = night?.theme_key;
  if (isThemeKey(nightKey)) return nightKey;
  const hostKey = host?.default_theme_key;
  if (isThemeKey(hostKey)) return hostKey;
  return SYSTEM_DEFAULT_THEME;
}
