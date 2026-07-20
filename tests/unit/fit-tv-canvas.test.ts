import { describe, expect, it } from "vitest";

import {
  TV_LOGICAL_HEIGHT,
  TV_LOGICAL_WIDTH,
  fitTVCanvas,
} from "@/lib/tv/fitTVCanvas";

describe("fitTVCanvas", () => {
  it("keeps one 1600 by 900 logical stage", () => {
    expect(TV_LOGICAL_WIDTH).toBe(1600);
    expect(TV_LOGICAL_HEIGHT).toBe(900);
  });

  it.each([
    { viewport: [390, 844], scale: 0.24375, width: 390, height: 219.375 },
    { viewport: [844, 390], scale: 390 / 900, width: 1600 * (390 / 900), height: 390 },
    { viewport: [1280, 720], scale: 0.8, width: 1280, height: 720 },
    { viewport: [1920, 1080], scale: 1.2, width: 1920, height: 1080 },
  ])("contain-fits $viewport", ({ viewport, scale, width, height }) => {
    const fitted = fitTVCanvas(viewport[0], viewport[1]);
    expect(fitted.scale).toBeCloseTo(scale, 8);
    expect(fitted.width).toBeCloseTo(width, 8);
    expect(fitted.height).toBeCloseTo(height, 8);
  });
});
