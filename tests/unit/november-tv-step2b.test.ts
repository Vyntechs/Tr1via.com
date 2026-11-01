import { describe, expect, it } from "vitest";
import {
  boxesOverlap,
  clampPlateX,
  NOV_PANEL_INSET,
  NOV_PANEL_STYLE,
  NOV_WINNER_LEAVES,
  NOV_WINNER_NAME_ZONE,
  NOV_WISHBONE_BOX,
  novWinnerNameSize,
} from "@/lib/experience/november/tvLook";

describe("November TV, step 2b", () => {
  it("panel has no backdrop blur (cheap on a weak venue laptop)", () => {
    expect(JSON.stringify(NOV_PANEL_STYLE)).not.toMatch(/blur|backdrop/i);
  });

  it("shared panel leaves the lights and field showing around it", () => {
    expect(NOV_PANEL_INSET.top).toBeGreaterThanOrEqual(36);
    expect(NOV_PANEL_INSET.side).toBeGreaterThanOrEqual(56);
  });

  it("winner name shrinks to one line, never past 220 or under 72", () => {
    expect(novWinnerNameSize("Coach K")).toBe(205);
    expect(novWinnerNameSize("Al")).toBe(220);
    const long = novWinnerNameSize("Les Quizerables");
    expect(long).toBeLessThan(110);
    expect(long * 0.56 * 16).toBeLessThanOrEqual(NOV_WINNER_NAME_ZONE.w);
    expect(novWinnerNameSize("x".repeat(80))).toBe(72);
  });

  it("name plates stay fully inside the frame", () => {
    expect(clampPlateX(-22, 88)).toBe(6);
    expect(clampPlateX(1560, 97)).toBe(1600 - 6 - 97);
    expect(clampPlateX(700, 60)).toBe(700);
    // A plate wider than the frame is centered rather than flipped.
    expect(clampPlateX(0, 1700)).toBe(-50);
  });

  it("no leaf or wishbone covers the winner's name", () => {
    for (const [x, y, size] of NOV_WINNER_LEAVES) {
      expect(boxesOverlap({ x, y, w: size, h: size }, NOV_WINNER_NAME_ZONE)).toBe(false);
    }
    expect(boxesOverlap(NOV_WISHBONE_BOX, NOV_WINNER_NAME_ZONE)).toBe(false);
  });

  it("boxesOverlap: touching edges do not count", () => {
    expect(boxesOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
    expect(boxesOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 })).toBe(true);
  });
});
