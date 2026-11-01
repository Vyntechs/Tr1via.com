import { describe, expect, it } from "vitest";
import { TURKEY_ROW_ART } from "@/components/experience/november/turkeyRowArt";
import { turkeyPose } from "@/lib/experience/november/harvest";
import type { RowMood } from "@/lib/experience/shared/playerRow";

describe("November turkey row: missing pictures and the still tier", () => {
  it("a strip that never loaded falls back to the standing turkey", () => {
    expect(TURKEY_ROW_ART.fallbackSprite).toBe("idle");
    expect(TURKEY_ROW_ART.sprites.idle).toBeDefined();
  });

  it("the still tier fetches every pose a still frame can show", () => {
    const still = new Set(TURKEY_ROW_ART.stillSprites);
    const moods: RowMood[] = ["waiting", "lit", "blaze", "smoke", "toppled"];
    for (const mood of moods)
      for (const leader of [false, true]) {
        const pose = turkeyPose({ mood, prevMood: "waiting", msSince: 1e9, now: 0, seed: 0.3, leader, still: true });
        expect(still.has(pose.anim)).toBe(true);
      }
    expect(still.has(TURKEY_ROW_ART.fallbackSprite!)).toBe(true);
    expect(still.has("walk")).toBe(false);
    expect(still.has("fan")).toBe(false);
  });
});
