// Theme seed — carries the resolved theme across the /join → /room client
// navigation so the room paints the night's real theme on the first frame
// instead of flashing the month/default fallback while useRoom fetches the
// night row. Written by /join; read by /room on mount. sessionStorage (not a
// URL param) keeps the room URL clean and survives a same-tab refresh.

import { isThemeKey, type ThemeKey } from "@/lib/theme/tokens";
import { parseRoomCode } from "@/lib/game/room-code";

function keyFor(code: string): string {
  return `tr1via:theme:${parseRoomCode(code)}`;
}

/** Best-effort store. Silent no-op under SSR or when storage is unavailable. */
export function writeThemeSeed(code: string, themeKey: ThemeKey): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(keyFor(code), themeKey);
  } catch {
    /* private mode / storage disabled — seeding is best-effort */
  }
}

/** Returns the seeded ThemeKey for this room code, or null if absent/invalid. */
export function readThemeSeed(code: string): ThemeKey | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.sessionStorage.getItem(keyFor(code));
    return isThemeKey(v) ? v : null;
  } catch {
    return null;
  }
}
