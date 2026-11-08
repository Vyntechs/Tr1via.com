import { describe, it, expect } from "vitest";
import {
  explainQuestionSaveError,
  findAnswerChoiceProblem,
} from "@/lib/host/answerChoiceProblem";
import { PatchQuestionBodySchema } from "@/lib/api/schemas";

describe("findAnswerChoiceProblem", () => {
  it("passes four different answers", () => {
    expect(findAnswerChoiceProblem(["a", "b", "c", "d"])).toBeNull();
  });

  it("names the two repeated rows (the 2026-11-07 Free Birds edit)", () => {
    const problem = findAnswerChoiceProblem([
      "Escape from a farm",
      "Win a cooking competition",
      "Travel back in time to remove turkey from Thanksgiving",
      "Win a cooking competition",
    ]);
    expect(problem).toEqual({
      rows: [1, 3],
      message: "Answers 2 and 4 are the same. Change one so all four are different.",
    });
  });

  it("matches the server: ignores case and outer spaces", () => {
    expect(findAnswerChoiceProblem(["Paris", " paris ", "Lyon", "Nice"])?.rows).toEqual([0, 1]);
  });

  it("lists three repeats together", () => {
    expect(findAnswerChoiceProblem(["x", "y", "x", "x"])?.message).toBe(
      "Answers 1, 3 and 4 are the same. Change them so all four are different.",
    );
  });

  it("reports blank answers before repeats", () => {
    expect(findAnswerChoiceProblem(["", "  ", "a", "a"])).toEqual({
      rows: [0, 1],
      message: "Answers 1 and 2 are empty. Fill in all four answers.",
    });
    expect(findAnswerChoiceProblem(["a", "b", "", "d"])?.message).toBe(
      "Answer 3 is empty. Fill in all four answers.",
    );
  });

  it("agrees with the save route's schema on every case it flags or passes", () => {
    const cases: string[][] = [
      ["a", "b", "c", "d"],
      ["a", "A", "c", "d"],
      ["a ", "a", "c", "d"],
      ["", "b", "c", "d"],
      ["   ", "b", "c", "d"],
      ["Win", "win ", "WIN", "d"],
      ["café", "Café", "x", "y"],
    ];
    for (const options of cases) {
      const serverOk = PatchQuestionBodySchema.safeParse({ options }).success;
      expect(findAnswerChoiceProblem(options) === null).toBe(serverOk);
    }
  });
});

describe("explainQuestionSaveError", () => {
  it("translates the route's distinct-values refusal", () => {
    expect(explainQuestionSaveError("options must be four distinct values")).toBe(
      "Two of the answers are the same. Change one so all four are different, then save.",
    );
  });

  it("leaves other messages alone", () => {
    expect(explainQuestionSaveError("could not save edit")).toBe("could not save edit");
  });
});
