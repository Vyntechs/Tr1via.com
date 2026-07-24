import { describe, expect, it } from "vitest";

import { rankScores } from "@/lib/game/rankScores";

describe("rankScores", () => {
  it("uses one deterministic order and competition rank for tied scores", () => {
    const ranked = rankScores([
      { display_name: "Momma t", score: 2300 },
      { display_name: "Colton", score: 3200 },
      { display_name: "Lisa H", score: 2300 },
      { display_name: "Wayne Train", score: 2700 },
    ]);

    expect(ranked.map(({ row, rank }) => [row.display_name, rank])).toEqual([
      ["Colton", 1],
      ["Wayne Train", 2],
      ["Lisa H", 3],
      ["Momma t", 3],
    ]);
  });
});
