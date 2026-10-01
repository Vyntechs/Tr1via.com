#!/usr/bin/env node
// Theme fence check: fails if this branch changes any game-engine file.
//
//   node scripts/theme-fence.mjs [base]      (default base: origin/main)
//
// Themes only read what the screens already receive; answers, the timer,
// scoring and realtime sync must never change in a theme update. The list
// lives in lib/experience/fence.ts (mirrored here so this runs without a
// TypeScript build).

import { execSync } from "node:child_process";

const FENCE = [
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

const base = process.argv[2] ?? "origin/main";
const changed = execSync(`git diff --name-only ${base}...HEAD`, { encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
const hits = changed.filter((path) =>
  FENCE.some((fenced) => (fenced.endsWith("/") ? path.startsWith(fenced) : path === fenced)),
);

if (hits.length > 0) {
  console.error(`Theme fence: these game files changed and must not:\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
console.log(`Theme fence: clean (${changed.length} files changed vs ${base}, none behind the fence).`);
