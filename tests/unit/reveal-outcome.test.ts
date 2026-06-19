import { describe, it, expect } from "vitest";
import { playerWasCorrect, gateBeatForPlayer } from "@/lib/game/revealOutcome";
import type { AnswerRow } from "@/lib/supabase/types";
import type { FireworksBeat } from "@/components/system/PyrotechnicsBeatConductor";

const ans = (over: Partial<AnswerRow>): AnswerRow =>
  ({ chosen_index: 1, is_correct: null, ...over } as AnswerRow);

describe("playerWasCorrect", () => {
  it("true when is_correct echo is true", () => {
    expect(playerWasCorrect(ans({ is_correct: true, chosen_index: 0 }), 2)).toBe(true);
  });
  it("true when chosen matches correct_index even before the echo lands", () => {
    expect(playerWasCorrect(ans({ is_correct: null, chosen_index: 2 }), 2)).toBe(true);
  });
  it("false when wrong", () => {
    expect(playerWasCorrect(ans({ is_correct: false, chosen_index: 1 }), 2)).toBe(false);
  });
  it("false with no answer or unknown correct index", () => {
    expect(playerWasCorrect(null, 2)).toBe(false);
    expect(playerWasCorrect(ans({ chosen_index: 2 }), null)).toBe(false);
  });
});

const beat = (kind: "salvo" | "finale"): FireworksBeat => ({
  kind, fireAt: "x", serverNow: "y", receivedAtMs: 1,
});

const salvoFor = (questionId: string): FireworksBeat => ({
  kind: "salvo", fireAt: "x", serverNow: "y", receivedAtMs: 1, questionId,
});

describe("gateBeatForPlayer", () => {
  it("passes a finale beat through for everyone (even a wrong player)", () => {
    expect(gateBeatForPlayer(beat("finale"), false)).toEqual(beat("finale"));
  });
  it("passes an unbound salvo only when the player was correct (legacy fallback)", () => {
    expect(gateBeatForPlayer(beat("salvo"), true)).toEqual(beat("salvo"));
    expect(gateBeatForPlayer(beat("salvo"), false)).toBeNull();
  });
  it("passes a bound salvo only when correct AND the question matches", () => {
    expect(gateBeatForPlayer(salvoFor("q1"), true, "q1")).toEqual(salvoFor("q1"));
  });
  it("HOLDS a bound salvo when the question lags (cross-question race)", () => {
    // amCorrect reflects q1, but the incoming beat is for q2 — must not fire yet.
    expect(gateBeatForPlayer(salvoFor("q2"), true, "q1")).toBeNull();
    // ...nor when the resolved question isn't known yet.
    expect(gateBeatForPlayer(salvoFor("q2"), true, null)).toBeNull();
  });
  it("HOLDS a bound salvo for a wrong player regardless of question match", () => {
    expect(gateBeatForPlayer(salvoFor("q1"), false, "q1")).toBeNull();
  });
  it("passes null through", () => {
    expect(gateBeatForPlayer(null, true)).toBeNull();
  });
});
