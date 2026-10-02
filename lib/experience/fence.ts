// The theme fence: game files no theme work may change.
//
// Themes (and experience packs like October's Sleepy Hollow) only READ what
// the screens already receive. Answers, the timer, scoring and realtime sync
// live behind this fence. `scripts/theme-fence.mjs` fails if a branch touches
// any of these paths, and tests/unit/theme-fence.test.ts pins the one game
// behaviour that lives inside a TV file (the timer-zero backup that closes a
// question when every phone has died).

export const THEME_FENCE_PATHS: readonly string[] = [
  "lib/live-answer/",
  "lib/game/",
  "lib/realtime/",
  "lib/api/",
  "app/api/",
  "supabase/",
  "lib/hooks/useRoom.ts",
  "lib/hooks/useTVRoom.ts",
  "lib/hooks/useTimer.ts",
  "lib/hooks/useLockInSync.ts",
  "lib/hooks/useAllLockedAutoReveal.ts",
];

export function isFenced(path: string): boolean {
  return THEME_FENCE_PATHS.some((fenced) =>
    fenced.endsWith("/") ? path.startsWith(fenced) : path === fenced,
  );
}
