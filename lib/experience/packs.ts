// Experience packs: themes that are a living world, not just a palette.
//
// A pack draws a world behind the venue TV (and a matching layer on phones)
// that reacts to the moments of the night. It only READS what the screens
// already receive — it never writes game state, never drives a timer, and
// never calls the server. Themes without a pack are untouched: they render
// exactly as they always have.
//
// October ("Sleepy Hollow Night") is the first pack.

import type { ThemeKey } from "@/lib/theme/tokens";

export type WorldPackId = "october";

export interface TVWorldSpec {
  pack: WorldPackId;
  /** Share of the TV's height the game screens keep (top part). The rest,
   *  along the bottom, belongs to the world's foreground (the pumpkin patch).
   *  0.755 = 680 of 900, from the October design. */
  contentHeight: number;
}

const TV_WORLDS: Partial<Record<ThemeKey, TVWorldSpec>> = {
  october: { pack: "october", contentHeight: 680 / 900 },
};

/** The world a TV surface wears for this theme, or null for a plain theme. */
export function tvWorldFor(themeKey: ThemeKey | undefined): TVWorldSpec | null {
  if (!themeKey || !Object.prototype.hasOwnProperty.call(TV_WORLDS, themeKey)) return null;
  return TV_WORLDS[themeKey] ?? null;
}

/** True when phones get the pack's personal layer ("your pumpkin"). */
export function hasPhoneLayer(themeKey: ThemeKey | undefined): boolean {
  return themeKey === "october";
}
