// Regression: 2026-08-05, live on prod. The 700 in "cars" ran its full timer
// and auto-resolved at 22:58:58. The host console was still showing "Show
// answer now" (its snapshot hadn't caught up), Brandon tapped it, and the
// server answered 409 "question is already resolved" — which the console
// rendered as a red error banner over the reveal screen in front of the room.
//
// Nothing had gone wrong: the answer was on screen, which is what the tap
// was for. This pins that the benign 409 is recognized, and — more
// importantly — that the two 409s which mean the host's intent did NOT
// happen still surface as errors.

import { describe, expect, it } from "vitest";
import { isAlreadyResolved } from "@/lib/host/endEarlyOutcome";

describe("isAlreadyResolved", () => {
  it("recognizes the server's exact wording", () => {
    // Must match app/api/games/[id]/end-early/route.ts verbatim.
    expect(isAlreadyResolved("question is already resolved")).toBe(true);
  });

  it("stays benign if the message is reworded or re-cased", () => {
    expect(isAlreadyResolved("This question is already resolved.")).toBe(true);
    expect(isAlreadyResolved("QUESTION IS ALREADY RESOLVED")).toBe(true);
  });

  it("does NOT swallow a question that was never revealed", () => {
    // The host pressed "Show answer now" on something with no live question.
    // That intent did not happen — she must be told.
    expect(isAlreadyResolved("question is not live")).toBe(false);
  });

  it("does NOT swallow the all-locked guard", () => {
    expect(isAlreadyResolved("not all eligible players are locked")).toBe(false);
  });

  it("does NOT swallow a wrong-game or missing question", () => {
    expect(isAlreadyResolved("question is not in this game")).toBe(false);
    expect(isAlreadyResolved("question not found")).toBe(false);
  });

  it("treats a missing or empty error as a real failure", () => {
    expect(isAlreadyResolved(undefined)).toBe(false);
    expect(isAlreadyResolved(null)).toBe(false);
    expect(isAlreadyResolved("")).toBe(false);
  });
});
