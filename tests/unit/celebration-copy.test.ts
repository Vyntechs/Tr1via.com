import { describe, it, expect } from "vitest";
import {
  summarizeResolve,
  nailedItLine,
  gotItLine,
  type ResolveAward,
} from "@/lib/player/celebrationCopy";

const awards = (flags: boolean[]): ResolveAward[] =>
  flags.map((isCorrect, i) => ({ playerId: `p${i}`, awarded: isCorrect ? 110 : 0, isCorrect }));

describe("summarizeResolve", () => {
  it("counts correct vs answered from the awards array", () => {
    expect(summarizeResolve(awards([true, false, true, true]))).toEqual({ correctCount: 3, answeredCount: 4 });
  });
  it("handles undefined / empty awards", () => {
    expect(summarizeResolve(undefined)).toEqual({ correctCount: 0, answeredCount: 0 });
    expect(summarizeResolve([])).toEqual({ correctCount: 0, answeredCount: 0 });
  });
});

describe("nailedItLine (correct screen — you are one of the correct)", () => {
  it("you alone", () => expect(nailedItLine(1)).toBe("You nailed it"));
  it("you + one other", () => expect(nailedItLine(2)).toBe("You + 1 other nailed it"));
  it("you + many", () => expect(nailedItLine(8)).toBe("You + 7 others nailed it"));
  it("guards a zero/below count to the solo line", () => expect(nailedItLine(0)).toBe("You nailed it"));
});

describe("gotItLine (wrong screen — awareness)", () => {
  it("fraction of answered", () => expect(gotItLine(8, 23)).toBe("8 of 23 got this one"));
  it("singular correct", () => expect(gotItLine(1, 12)).toBe("1 of 12 got this one"));
  it("nobody got it", () => expect(gotItLine(0, 15)).toBe("Nobody got this one"));
});
