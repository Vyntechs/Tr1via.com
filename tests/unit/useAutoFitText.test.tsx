// useAutoFitText — picks the largest font that fits in a container.
//
// jsdom does not lay out text (no glyph metrics), so the React hook itself
// can't be E2E-tested here. We test:
//   1. `pickFittingSize` — the pure policy used inside the hook.
//   2. The hook's *fallback* behavior when measurement is disabled.
//   3. The hook's *bail* behavior when the frame has zero height.

import { describe, it, expect, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import {
  pickFittingSize,
  useAutoFitText,
} from "@/lib/hooks/useAutoFitText";

describe("pickFittingSize", () => {
  it("returns the largest size that fits", () => {
    // measureAt(size) = 30 * lines, and a short prompt fits on 1 line at any
    // size — so all candidates fit, we pick the biggest.
    const fit = pickFittingSize([16, 20, 24, 28], 200, () => 30);
    expect(fit).toBe(28);
  });

  it("returns the floor when nothing fits", () => {
    // Container height 20px, each candidate renders at 999px → nothing fits
    // → fall back to the smallest candidate so the text is at least visible.
    const fit = pickFittingSize([16, 20, 24, 28], 20, () => 999);
    expect(fit).toBe(16);
  });

  it("picks the boundary correctly: only 16 and 18 fit", () => {
    // Heights for candidates: 16→40, 18→50, 20→60, 24→80, 28→100
    // Container 55px → 16(40) and 18(50) fit, 20(60) overflows.
    const heights: Record<number, number> = { 16: 40, 18: 50, 20: 60, 24: 80, 28: 100 };
    const fit = pickFittingSize([16, 18, 20, 24, 28], 55, (s) => heights[s]);
    expect(fit).toBe(18);
  });

  it("applies tolerance — 1px overflow still counts as fit", () => {
    // Container 50px, candidate 18 renders at 51px. Tolerance 2 → 51 ≤ 52, fits.
    const fit = pickFittingSize([16, 18], 50, (s) => (s === 18 ? 51 : 40), 2);
    expect(fit).toBe(18);
  });

  it("returns floor when frameHeight is 0 (not yet laid out)", () => {
    const fit = pickFittingSize([16, 20, 28], 0, () => 0);
    expect(fit).toBe(16);
  });

  it("works with unsorted size lists", () => {
    // Same as the boundary test, but the sizes are passed out of order.
    const heights: Record<number, number> = { 16: 40, 18: 50, 20: 60, 24: 80, 28: 100 };
    const fit = pickFittingSize([28, 16, 24, 18, 20], 55, (s) => heights[s]);
    expect(fit).toBe(18);
  });

  it("returns 0 for an empty candidate list (defensive)", () => {
    const fit = pickFittingSize([], 200, () => 0);
    expect(fit).toBe(0);
  });
});

describe("useAutoFitText", () => {
  afterEach(() => cleanup());

  it("returns refs and a numeric fontSize", () => {
    const { result } = renderHook(() => useAutoFitText());
    expect(result.current.frameRef).toBeDefined();
    expect(result.current.textRef).toBeDefined();
    expect(typeof result.current.fontSize).toBe("number");
  });

  it("defaults to the largest candidate before measurement runs", () => {
    // disabled: true skips the measure pass. The hook should still emit the
    // ceiling (28) so the unmounted/no-layout state has a sane fallback.
    const { result } = renderHook(() =>
      useAutoFitText({ sizes: [16, 18, 20, 24, 28], disabled: true }),
    );
    expect(result.current.fontSize).toBe(28);
  });

  it("uses custom sizes' ceiling when disabled", () => {
    const { result } = renderHook(() =>
      useAutoFitText({ sizes: [14, 16, 22, 32, 40], disabled: true }),
    );
    expect(result.current.fontSize).toBe(40);
  });
});
