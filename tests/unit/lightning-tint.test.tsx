// Tests for the Lightning tint prop — per-player strike color for lock-in
// ceremonies. The visual effect (halo + afterglow blend to the player's color)
// can't be verified in jsdom (no canvas 2D context), but the API contract CAN:
// the prop must be accepted without crashing, and fireLightningBeat must accept
// an optional opts.tint argument without breaking existing callers.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { Lightning, fireLightningBeat } from "@/components/system/Lightning";

beforeEach(() => {
  // Default to no reduced-motion preference.
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false,
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: () => false,
  }));

  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

describe("Lightning tint prop", () => {
  it("accepts an optional tint prop without crashing", () => {
    const { container } = render(<Lightning tint="#E64A8C" />);
    expect(container).toBeTruthy();
  });

  it("renders without tint (existing behavior preserved)", () => {
    const { container } = render(<Lightning />);
    expect(container).toBeTruthy();
  });

  it("exposes fireLightningBeat with optional tint argument", () => {
    expect(() => fireLightningBeat("close", { tint: "#5AA8E0" })).not.toThrow();
  });
});
