import { describe, it, expect } from "vitest";
import { buildNeighborhood, buildNightStandings } from "@/lib/player/standings";
import type { GameScoreRow } from "@/lib/supabase/types";

function scores(n: number): GameScoreRow[] {
  return Array.from({ length: n }, (_, i) => ({
    game_id: "g1",
    player_id: `p${i + 1}`,
    display_name: `P${i + 1}`,
    score: (n - i) * 100,
  })) as unknown as GameScoreRow[];
}

describe("buildNeighborhood", () => {
  it("returns up to 4 above + you + 4 below, you flagged, centered when mid-pack", () => {
    const nb = buildNeighborhood(scores(24), "p7", 4);
    expect(nb.meRank).toBe(7);
    expect(nb.total).toBe(24);
    expect(nb.rows.map((r) => r.rank)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(nb.rows.find((r) => r.isYou)?.rank).toBe(7);
    expect(nb.rows.filter((r) => r.isYou)).toHaveLength(1);
  });

  it("clamps at the top edge (fewer above)", () => {
    const nb = buildNeighborhood(scores(24), "p2", 4);
    expect(nb.meRank).toBe(2);
    expect(nb.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("clamps at the bottom edge (fewer below)", () => {
    const nb = buildNeighborhood(scores(10), "p9", 4);
    expect(nb.rows.map((r) => r.rank)).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it("returns empty rows + null meRank when the player is absent (no '#0')", () => {
    const nb = buildNeighborhood(scores(5), "ghost", 4);
    expect(nb.meRank).toBeNull();
    expect(nb.rows).toEqual([]);
    expect(nb.total).toBe(5);
  });
});

describe("buildNightStandings", () => {
  it("aggregates every finished game so final standings are night-wide", () => {
    const rows = [
      {
        game_id: "game1",
        player_id: "p1",
        display_name: "Alex",
        score: 500,
        correct_count: 5,
        answered_count: 6,
      },
      {
        game_id: "game2",
        player_id: "p1",
        display_name: "Alex",
        score: 0,
        correct_count: 0,
        answered_count: 2,
      },
      {
        game_id: "game1",
        player_id: "p2",
        display_name: "Brooke",
        score: 0,
        correct_count: 0,
        answered_count: 0,
      },
      {
        game_id: "game2",
        player_id: "p2",
        display_name: "Brooke",
        score: 400,
        correct_count: 4,
        answered_count: 6,
      },
      {
        game_id: "game1",
        player_id: "p3",
        display_name: "Casey",
        score: 100,
        correct_count: 1,
        answered_count: 6,
      },
      {
        game_id: "game2",
        player_id: "p3",
        display_name: "Casey",
        score: 600,
        correct_count: 6,
        answered_count: 6,
      },
    ] as unknown as GameScoreRow[];

    const standings = buildNightStandings(rows);

    expect(standings.map((row) => [row.player_id, row.score])).toEqual([
      ["p3", 700],
      ["p1", 500],
      ["p2", 400],
    ]);
    expect(standings.find((row) => row.player_id === "p1")).toMatchObject({
      correct_count: 5,
      answered_count: 8,
    });
    expect(buildNeighborhood(standings, "p1", 4)).toMatchObject({
      meRank: 2,
      total: 3,
    });
  });
});
