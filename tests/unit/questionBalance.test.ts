import { describe, it, expect } from "vitest";
import { assignPointValues } from "@/lib/game/difficulty";
import {
  assertBoardDifficultyMix,
  candidateDifficultyMix,
  difficultyBand,
  QuestionBalanceError,
  remainingDifficultyMix,
  selectBalancedQuestionIds,
  takeDifficultyMix,
} from "@/lib/game/questionBalance";

const pool = (difficulties: number[]) => difficulties.map((difficulty, i) => ({ id: `q${i}`, difficulty }));

describe("balanced automatic boards", () => {
  it("gives 100–300 approachable questions even when a large pool is mostly hard", () => {
    const questions = pool([7, 7, 7, 6, 7, 7, 6, 7, 7, 6, 7, 1, 2, 2, 3, 4, 5, 5, 4, 3]);
    const original = structuredClone(questions);
    const ids = selectBalancedQuestionIds(questions);
    const selected = ids.map((id) => questions.find((question) => question.id === id)!);
    const assignments = assignPointValues(selected);
    expect(selected.map((question) => difficultyBand(question.difficulty))).toEqual([
      "approachable", "approachable", "approachable", "moderate", "moderate", "moderate", "stretch",
    ]);
    for (const assignment of assignments.filter((item) => item.pointValue <= 300)) {
      expect(selected.find((question) => question.id === assignment.id)!.difficulty).toBeLessThanOrEqual(2);
    }
    expect(questions).toEqual(original);
    expect(new Set(ids).size).toBe(7);
  });

  it.each([
    [7, 7, 7, 7, 7, 7, 7],
    [1, 2, 3, 3, 4, 5, 6],
    [1, 1, 2, 3, 4, 6, 7],
    [1, 1, 2, 3, 4, 5, 5],
  ])("refuses to disguise an incomplete mix as a complete board: %j", (...values) => {
    expect(() => selectBalancedQuestionIds(pool(values))).toThrow(QuestionBalanceError);
  });

  it("does not count a duplicate id as a second approachable question", () => {
    const questions = pool([1, 2, 2, 3, 4, 5, 6]);
    questions[2]!.id = questions[1]!.id;
    expect(() => selectBalancedQuestionIds(questions)).toThrow(QuestionBalanceError);
  });

  it("is stable for ties and returns every item in an exact balanced seven", () => {
    const questions = pool([2, 2, 2, 4, 4, 4, 6]);
    expect(selectBalancedQuestionIds(questions)).toEqual(questions.map((question) => question.id));
    expect(selectBalancedQuestionIds(questions)).toEqual(selectBalancedQuestionIds(questions));
  });

  it("keeps valid easy/normal/hard pools large enough for the same board contract", () => {
    for (const target of ["easy", "normal", "hard"] as const) {
      const mix = candidateDifficultyMix(target);
      expect(mix.approachable + mix.moderate + mix.stretch).toBe(20);
      const questions = pool([
        ...Array<number>(mix.approachable).fill(2),
        ...Array<number>(mix.moderate).fill(4),
        ...Array<number>(mix.stretch).fill(6),
      ]);
      expect(() => assertBoardDifficultyMix(questions)).not.toThrow();
    }
  });

  it("trims an old all-hard checkpoint and reserves space for missing bands", () => {
    const old = pool(Array<number>(20).fill(7));
    const mix = candidateDifficultyMix();
    const result = takeDifficultyMix(old, mix);
    expect(result.accepted).toHaveLength(3);
    expect(result.surplus).toHaveLength(17);
    expect(remainingDifficultyMix(mix, result.accepted)).toEqual({ approachable: 8, moderate: 9, stretch: 0 });
  });
});
