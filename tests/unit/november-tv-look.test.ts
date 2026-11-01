import { describe, expect, it } from "vitest";
import { novTimerColor, NOV, turkeyPlateTop, NOV_QUESTION_SIZES } from "@/lib/experience/november/tvLook";
import { ROW_GEOMETRY, rowLayout } from "@/lib/experience/shared/playerRow";

describe("November TV look", () => {
  it("timer ring is burnt orange, red at five seconds and under", () => {
    expect(novTimerColor(25)).toBe(NOV.burnt);
    expect(novTimerColor(6)).toBe(NOV.burnt);
    expect(novTimerColor(5)).toBe(NOV.red);
    expect(novTimerColor(0)).toBe(NOV.red);
  });

  it("question tops out at 52px and can drop to 32px", () => {
    expect(Math.max(...NOV_QUESTION_SIZES)).toBe(52);
    expect(Math.min(...NOV_QUESTION_SIZES)).toBe(32);
  });

  // Name plates never sit on a front-row turkey: each back-row plate is below
  // every front-row figure's body (feet line) and plates stay on screen.
  for (const count of [24, 41, 60]) {
    it(`plates clear the front row's figures at ${count} players`, () => {
      const slots = rowLayout(count);
      const frontRow = Math.max(...slots.map((s) => s.row));
      const front = slots.filter((s) => s.row === frontRow);
      const feet = Math.min(...front.map((s) => s.top + s.h * 0.765));
      for (const s of slots) {
        const top = turkeyPlateTop(s, ROW_GEOMETRY);
        const bottom = top + s.stakeH * 0.92;
        expect(bottom).toBeLessThanOrEqual(900);
        if (s.row === frontRow || s.row === frontRow - 1) expect(top).toBeGreaterThanOrEqual(feet - 0.5);
      }
      // Front plates sit one lane below the back plates (no overlap in y).
      if (frontRow > 0) {
        const back = slots.find((s) => s.row === frontRow - 1)!;
        const f = front[0];
        expect(turkeyPlateTop(f, ROW_GEOMETRY)).toBeGreaterThanOrEqual(turkeyPlateTop(back, ROW_GEOMETRY) + back.stakeH * 0.92);
      }
    });
  }
});
