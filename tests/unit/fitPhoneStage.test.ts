// The arithmetic behind "a screen that cannot scroll must fit."
//
// Regression origin: 2026-08-05, live show. A player on a small Android was
// shown a question with four answers and could tap none of them — the cards
// had run off the bottom of a screen that deliberately locks scrolling, so
// they were untappable rather than merely below the fold. The host had to
// award the points by hand.
//
// These are the invariants the fitted stage rests on. The end-to-end proof
// that real answer cards land inside a real viewport lives in
// tests/e2e/player-question-fits.spec.ts; this file pins the math so a
// refactor of that math fails here first, in milliseconds, without a browser.

import { describe, expect, it } from "vitest";
import { PHONE_LOGICAL_HEIGHT, fitPhoneStage } from "@/lib/player/fitPhoneStage";

/** Every phone in the room, plus the display-scaling cases that broke it. */
const DEVICES = [
  { name: "small Android", w: 360, h: 560 },
  { name: "small Android, large display size", w: 277, h: 431 },
  { name: "iPhone SE", w: 320, h: 568 },
  { name: "Pixel", w: 393, h: 640 },
  { name: "iPhone 14", w: 390, h: 750 },
  { name: "iPhone 15 Pro Max", w: 430, h: 932 },
  { name: "absurdly short", w: 360, h: 240 },
] as const;

describe("fitPhoneStage", () => {
  it("renders back at exactly the device size, so there is no letterbox and no crop", () => {
    for (const d of DEVICES) {
      const fit = fitPhoneStage(d.w, d.h);
      expect(fit.width * fit.scale, `${d.name} width`).toBeCloseTo(d.w, 4);
      expect(fit.height * fit.scale, `${d.name} height`).toBeCloseTo(d.h, 4);
    }
  });

  it("gives a short phone at least the full logical height to compose in", () => {
    // This is the whole point: the screen always gets to lay out as though it
    // had PHONE_LOGICAL_HEIGHT, however little glass the device actually has.
    for (const d of DEVICES) {
      expect(fitPhoneStage(d.w, d.h).height, d.name).toBeGreaterThanOrEqual(
        PHONE_LOGICAL_HEIGHT - 0.01,
      );
    }
  });

  it("never magnifies a tall phone", () => {
    expect(fitPhoneStage(430, 932).scale).toBe(1);
    expect(fitPhoneStage(390, 750).scale).toBe(1);
    // At exactly the logical height it is still 1, not 0.999-something.
    expect(fitPhoneStage(360, PHONE_LOGICAL_HEIGHT).scale).toBe(1);
  });

  it("shrinks in proportion to how short the phone is", () => {
    expect(fitPhoneStage(360, 320).scale).toBeCloseTo(0.5, 6);
    expect(fitPhoneStage(360, 480).scale).toBeCloseTo(0.75, 6);
  });

  it("keeps a shorter phone strictly smaller — no ties, no reversals", () => {
    const scales = [240, 431, 560, 568, 640].map((h) => fitPhoneStage(360, h).scale);
    for (let i = 1; i < scales.length; i += 1) {
      expect(scales[i]!).toBeGreaterThan(scales[i - 1]!);
    }
  });

  it("survives a first paint before anything has been measured", () => {
    // ResizeObserver has not fired yet: 0x0. Must not divide by zero, produce
    // NaN, or collapse the screen to nothing.
    for (const bad of [[0, 0], [0, 600], [360, 0], [NaN, NaN], [-5, -5], [Infinity, 600]] as const) {
      const fit = fitPhoneStage(bad[0], bad[1]);
      expect(Number.isFinite(fit.scale), `scale for ${bad}`).toBe(true);
      expect(Number.isFinite(fit.width), `width for ${bad}`).toBe(true);
      expect(Number.isFinite(fit.height), `height for ${bad}`).toBe(true);
      expect(fit.scale).toBeGreaterThan(0);
      expect(fit.height).toBeGreaterThan(0);
    }
  });

  it("does not depend on aspect ratio — only on height", () => {
    // A narrow phone and a wide one of the same height scale identically;
    // width is absorbed by the layout box, never by the scale.
    expect(fitPhoneStage(320, 560).scale).toBe(fitPhoneStage(430, 560).scale);
  });
});
