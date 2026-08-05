// Regression: found by an independent review of the shipped August theme,
// 2026-08-05, before any host with Reduce Motion had seen it.
//
// The global CSS catch-all collapses every animation to 0.001ms under
// `prefers-reduced-motion: reduce`. That does NOT park a particle somewhere
// sensible: with no `animation-fill-mode` the keyframed opacity stops
// applying the moment the animation ends, so each ember snaps back to full
// brightness pinned to the bottom edge — measured at opacity 1.0 sitting at
// top:720 on a 720px stage — while every leaf finishes its fall off-screen
// and disappears. A row of stuck orange dots and no leaves at all.
//
// Every other weather layer already skips render instead (ParticleField,
// Lightning, Pyrotechnics, JuneSky). August must too. The page itself —
// paper, ruling, punch holes, marginalia — stays: it is the part that
// carries the month, and it does not move.

import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AugustPage } from "@/components/system/AugustPage";

const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/hooks/usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => reducedMotion.value,
}));

afterEach(() => {
  reducedMotion.value = false;
  cleanup();
});

describe("August honors prefers-reduced-motion", () => {
  it("drops the embers rather than freezing them lit along the bottom edge", () => {
    reducedMotion.value = true;
    render(<AugustPage page="question" />);
    expect(screen.queryByTestId("august-embers")).toBeNull();
  });

  it("drops the falling leaves rather than parking them off-screen", () => {
    reducedMotion.value = true;
    render(<AugustPage page="question" />);
    expect(screen.queryByTestId("august-leaves")).toBeNull();
  });

  it("keeps the page itself — the month must still read as August", () => {
    reducedMotion.value = true;
    render(<AugustPage page="question" />);
    expect(screen.getByTestId("august-page")).toBeTruthy();
    expect(screen.getByTestId("august-substrate")).toBeTruthy();
    expect(screen.getByTestId("august-marginalia")).toBeTruthy();
  });

  it("still animates for everyone else", () => {
    reducedMotion.value = false;
    render(<AugustPage page="question" />);
    expect(screen.getByTestId("august-embers")).toBeTruthy();
  });
});
