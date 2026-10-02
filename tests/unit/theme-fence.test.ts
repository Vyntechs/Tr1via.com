// The theme fence. The script (scripts/theme-fence.mjs) blocks a theme branch
// that touches game files; this test pins the one piece of game behaviour that
// lives inside a TV file: when the clock hits zero, the TV (or host laptop)
// tells the server to close the question, so the game can't stall if every
// phone has died. Theme work wraps that file and must never change it.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_FENCE_PATHS, isFenced } from "@/lib/experience/fence";

const TIMER_ZERO_BACKUP = `  const { displaySeconds } = useTimer({
    revealedAtMs: revealedMs,
    serverNowMs,
    themeKey,
    onZero: () => {
      void fetch(\`/api/questions/\${question.id}/resolve\`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }).catch(() => {
        // Network/transient failure: phones or host's manual End-early
        // button remain as fallbacks. Logging would be noise.
      });
    },
  });`;

describe("theme fence", () => {
  it("keeps the TV's timer-zero backup exactly as it is", () => {
    const source = readFileSync(path.join(process.cwd(), "components/tv/TVStateMachine.tsx"), "utf8");
    expect(source).toContain(TIMER_ZERO_BACKUP);
  });

  it("fences the game engine: answers, timer, scoring, realtime, API, database", () => {
    expect(isFenced("lib/live-answer/contracts.ts")).toBe(true);
    expect(isFenced("app/api/answers/route.ts")).toBe(true);
    expect(isFenced("lib/hooks/useTimer.ts")).toBe(true);
    expect(isFenced("supabase/migrations/0001.sql")).toBe(true);
    expect(isFenced("lib/hooks/usePrefersReducedMotion.ts")).toBe(false);
    expect(isFenced("components/experience/october/OctoberTVWorld.tsx")).toBe(false);
    expect(THEME_FENCE_PATHS).toContain("lib/game/");
  });

  it("the fence script and the fence list agree", () => {
    const script = readFileSync(path.join(process.cwd(), "scripts/theme-fence.mjs"), "utf8");
    for (const fenced of THEME_FENCE_PATHS) expect(script).toContain(`"${fenced}"`);
  });
});
