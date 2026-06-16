import { describe, it, expect } from "vitest";
import { sumAwardedForGame } from "@/lib/player/revealTotal";
import type { AnswerRow } from "@/lib/supabase/types";

function answer(question_id: string, awarded_points: number | null): AnswerRow {
  return { question_id, awarded_points } as unknown as AnswerRow;
}

describe("sumAwardedForGame — player reveal running total is per-game (#2)", () => {
  // Game 1 = q1,q2 (300 pts); Game 2 = q3,q4 (1100 pts).
  const map = new Map<string, string>([
    ["q1", "game1"],
    ["q2", "game1"],
    ["q3", "game2"],
    ["q4", "game2"],
  ]);
  const answers = [
    answer("q1", 100),
    answer("q2", 200),
    answer("q3", 700),
    answer("q4", 400),
  ];

  it("sums ONLY the current game's answers", () => {
    // The old code summed every answer = 1400 (the visible phone-vs-TV bug).
    // The fix must report each game's own total.
    expect(sumAwardedForGame(answers, "game2", map)).toBe(1100);
    expect(sumAwardedForGame(answers, "game1", map)).toBe(300);
  });

  it("sums the whole night when gameId is null (recap/summary path unchanged)", () => {
    expect(sumAwardedForGame(answers, null, map)).toBe(1400);
  });

  it("counts an answer whose question isn't mapped yet, so a fresh game total never drops", () => {
    const withUnmapped = [...answers, answer("q5-new", 500)]; // q5 not in map
    expect(sumAwardedForGame(withUnmapped, "game2", map)).toBe(1600);
  });

  it("falls back to the night-wide sum when the map is still empty (no worse than before)", () => {
    expect(sumAwardedForGame(answers, "game2", new Map())).toBe(1400);
  });

  it("treats null awarded_points as 0", () => {
    expect(sumAwardedForGame([answer("q3", null), answer("q4", 400)], "game2", map)).toBe(400);
  });
});
