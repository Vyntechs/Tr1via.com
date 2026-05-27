// Tests for the Lightning component's React surface — the things we can
// verify in jsdom. The canvas rendering itself isn't exercised (no canvas
// 2D context in jsdom), but the prefers-reduced-motion fallback and the
// module-level beat subscription are testable.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

  // jsdom doesn't implement canvas getContext. Stub it to return null
  // (the component handles that case) — silences the "Not implemented"
  // warning and keeps the test output clean.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

describe("Lightning · prefers-reduced-motion", () => {
  it("renders the legacy soft-glow when prefers-reduced-motion is set", () => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: q.includes("reduce"),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: () => false,
    }));

    render(<Lightning color="#E8C46A" />);
    // Wait for the matchMedia effect to commit by re-querying for the
    // legacy fallback id.
    expect(screen.getByTestId("lightning-legacy-flicker")).toBeInTheDocument();
  });

  it("renders the procedural canvas when reduced-motion is NOT set", () => {
    render(<Lightning color="#E8C46A" />);
    expect(screen.getByTestId("lightning-root")).toBeInTheDocument();
  });
});

describe("fireLightningBeat", () => {
  it("is a no-op when no Lightning is mounted", () => {
    // Just shouldn't throw.
    expect(() => fireLightningBeat("close")).not.toThrow();
    expect(() => fireLightningBeat("distant")).not.toThrow();
  });

  it("does not throw with no audio context available", () => {
    render(<Lightning color="#E8C46A" muteThunder />);
    // Bridging the canvas API in jsdom is out of scope — calling beat
    // shouldn't blow up even though canvas getContext returns null.
    expect(() => fireLightningBeat("close")).not.toThrow();
  });
});
