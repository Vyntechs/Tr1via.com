import { describe, it, expect } from "vitest";
import { buildGame1Standings } from "@/lib/player/betweenGames";
import type { GameScoreRow } from "@/lib/supabase/types";

function score(player_id: string, display_name: string, score: number): GameScoreRow {
  return {
    game_id: "g1",
    player_id,
    display_name,
    score,
    correct_count: 0,
    answered_count: 0,
    fastest_correct_ms: null,
  } as GameScoreRow;
}

// Already sorted desc by score, the way the page queries it (.order score desc).
const SCORES: GameScoreRow[] = [
  score("a", "Alice", 12320),
  score("c", "Carol", 9160),
  score("y", "You", 8420),
  score("b", "Bob", 3080),
  score("d", "Dave", 2100),
  score("e", "Evan", 1500),
];

describe("buildGame1Standings", () => {
  it("returns the top N ranked, marking the player's row when in the top", () => {
    const { top, you } = buildGame1Standings(SCORES, "y", 5);
    expect(top.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(top.map((r) => r.name)).toEqual(["Alice", "Carol", "You", "Bob", "Dave"]);
    expect(top.find((r) => r.isYou)?.name).toBe("You");
    expect(you).toBeNull(); // player is inside the top → no pinned row
  });

  it("pins the player's own row when they rank below the cutoff", () => {
    const { top, you } = buildGame1Standings(SCORES, "e", 5);
    expect(top.some((r) => r.isYou)).toBe(false);
    expect(you).toEqual({ rank: 6, name: "Evan", score: 1500, isYou: true });
  });

  it("returns you=null when the player has no score row", () => {
    const { top, you } = buildGame1Standings(SCORES, "ghost", 5);
    expect(top.some((r) => r.isYou)).toBe(false);
    expect(you).toBeNull();
  });

  it("handles fewer players than the limit", () => {
    const { top, you } = buildGame1Standings(SCORES.slice(0, 3), "y", 5);
    expect(top.map((r) => r.name)).toEqual(["Alice", "Carol", "You"]);
    expect(you).toBeNull();
  });
});
