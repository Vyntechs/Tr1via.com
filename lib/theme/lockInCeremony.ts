// Per-theme registry for the lock-in ceremony treatment. Parallel to the
// Weather component's switch-on-themeKey pattern in components/system/Weather.tsx.
//
// The question timer is 30s for every theme (the default). Themes may register
// to opt INTO extra live-question treatments — an auto-scrolling marquee
// scoreboard and per-player lightning on lock-in (May/Storm). Themes that don't
// register fall back to the default: 30s timer, lock-in pile, no transit ceremony.
//
// This is the single source of truth. Every conditional in the codebase that
// asks "is this theme on the new May/Storm experience?" reads from here.

import type { ThemeKey } from "@/lib/theme/tokens";

export type CeremonyKind = "lightning" | null;

export interface LockInCeremonyConfig {
  /** Question timer length in seconds. 30 for every theme (the default). */
  duration: number;
  /** True → bottom strip is the auto-scrolling marquee. False → existing lock-in pile. */
  marquee: boolean;
  /** Per-player ceremony to fire on lock-in. null = no transit treatment. */
  ceremony: CeremonyKind;
}

const DEFAULT_CONFIG: LockInCeremonyConfig = {
  duration: 30,
  marquee: false,
  ceremony: null,
};

/** Themes register here to opt into extra treatments (marquee / lightning).
 *  The 30s timer is the default — no entry needed just for the timer length. */
const REGISTRY: Partial<Record<ThemeKey, LockInCeremonyConfig>> = {
  may: {
    duration: 30,
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
