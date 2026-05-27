// Per-theme registry for the lock-in ceremony treatment. Parallel to the
// Weather component's switch-on-themeKey pattern in components/system/Weather.tsx.
//
// Themes that register a config opt INTO the new live-question experience
// (longer timer, auto-scrolling marquee scoreboard, per-player lightning
// strike on lock-in). Themes that don't register fall back to the default —
// today's 20s timer, lock-in pile, no transit ceremony.
//
// This is the single source of truth. Every conditional in the codebase that
// asks "is this theme on the new May/Storm experience?" reads from here.

import type { ThemeKey } from "@/lib/theme/tokens";

export type CeremonyKind = "lightning" | null;

export interface LockInCeremonyConfig {
  /** Question timer length in seconds. May = 25, default = 20. */
  duration: number;
  /** True → bottom strip is the auto-scrolling marquee. False → existing lock-in pile. */
  marquee: boolean;
  /** Per-player ceremony to fire on lock-in. null = no transit treatment. */
  ceremony: CeremonyKind;
}

const DEFAULT_CONFIG: LockInCeremonyConfig = {
  duration: 20,
  marquee: false,
  ceremony: null,
};

/** Themes opt IN to the new behavior by registering here. */
const REGISTRY: Partial<Record<ThemeKey, LockInCeremonyConfig>> = {
  may: {
    duration: 25,
    marquee: true,
    ceremony: "lightning",
  },
};

export function lockInCeremonyFor(themeKey: ThemeKey | undefined): LockInCeremonyConfig {
  if (!themeKey) return DEFAULT_CONFIG;
  return REGISTRY[themeKey] ?? DEFAULT_CONFIG;
}

export function hasMarquee(themeKey: ThemeKey | undefined): boolean {
  return lockInCeremonyFor(themeKey).marquee;
}

export function questionDurationFor(themeKey: ThemeKey | undefined): number {
  return lockInCeremonyFor(themeKey).duration;
}

export function hasCeremony(themeKey: ThemeKey | undefined): boolean {
  return lockInCeremonyFor(themeKey).ceremony !== null;
}
