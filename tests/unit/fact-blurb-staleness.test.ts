// When the host saves a question edit, does the fun fact need rewriting?
//
// Getting this wrong in either direction is costly:
//   - too eager  -> a model call on every point-value nudge, and a host's own
//                   wording silently replaced
//   - too shy    -> the 2026-07-29 live bug: "The square root of 900 is:"
//                   read out with a 5-12-13 Pythagorean fact (issue #173)

import { describe, it, expect } from "vitest";
import {
  questionMeaningChanged,
  shouldRewriteFactBlurb,
} from "@/lib/host/factBlurbStaleness";

const BEFORE = {
  prompt: "What is the square root of 169?",
  options: ["11", "12", "13", "14"],
  correctIndex: 2,
  factBlurb: "13 x 13 = 169.",
};

const next = (over: Partial<typeof BEFORE> = {}) => ({ ...BEFORE, ...over });

describe("questionMeaningChanged", () => {
  it("is true when the prompt is rewritten", () => {
    expect(
      questionMeaningChanged(next({ prompt: "The square root of 900 is:" }), BEFORE),
    ).toBe(true);
  });

  it("is true when an option is reworded", () => {
    expect(
      questionMeaningChanged(next({ options: ["11", "12", "30", "14"] }), BEFORE),
    ).toBe(true);
  });

  it("is true when the correct answer moves", () => {
    expect(questionMeaningChanged(next({ correctIndex: 0 }), BEFORE)).toBe(true);
  });

  it("is false for pure whitespace churn", () => {
    expect(
      questionMeaningChanged(
        next({ prompt: "  What is the square root of 169?  " }),
        BEFORE,
      ),
    ).toBe(false);
  });

  it("is false when nothing about the question changed", () => {
    expect(questionMeaningChanged(next(), BEFORE)).toBe(false);
  });
});

describe("shouldRewriteFactBlurb", () => {
  it("rewrites when the question changed and the host left the fact alone", () => {
    // The exact 7/29 case.
    expect(
      shouldRewriteFactBlurb({
        next: next({ prompt: "The square root of 900 is:" }),
        before: BEFORE,
      }),
    ).toBe(true);
  });

  it("does NOT overwrite a fact the host typed herself — she has to say it out loud", () => {
    expect(
      shouldRewriteFactBlurb({
        next: next({
          prompt: "The square root of 900 is:",
          factBlurb: "Heather's own wording, thanks.",
        }),
        before: BEFORE,
      }),
    ).toBe(false);
  });

  it("does not burn a model call when only the point value or photo changed", () => {
    // Neither is part of the subject; an unchanged question means no rewrite.
    expect(shouldRewriteFactBlurb({ next: next(), before: BEFORE })).toBe(false);
  });

  it("rewrites for a question that had no fact at all", () => {
    expect(
      shouldRewriteFactBlurb({
        next: next({ prompt: "The square root of 900 is:", factBlurb: "" }),
        before: { ...BEFORE, factBlurb: null },
      }),
    ).toBe(true);
  });

  it("treats clearing the box as the host's choice, not an invitation to rewrite", () => {
    expect(
      shouldRewriteFactBlurb({
        next: next({ prompt: "The square root of 900 is:", factBlurb: "" }),
        before: BEFORE,
      }),
    ).toBe(false);
  });
});
