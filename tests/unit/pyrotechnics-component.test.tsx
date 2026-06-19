// Tests for the Pyrotechnics component's React surface — the things we can
// verify in jsdom. The canvas rendering itself isn't exercised (jsdom has no
// 2D context), but the intensity guard, the prefers-reduced-motion fallback,
// and clean mount/unmount are testable. Mirrors lightning-component.test.tsx.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pyrotechnics } from "@/components/system/Pyrotechnics";

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

  // jsdom doesn't implement canvas getContext. Stub it to return null (the
  // component handles that — it still mounts the canvas, the RAF loop no-ops).
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => null,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

describe("Pyrotechnics · prefers-reduced-motion", () => {
  it("renders the calm static fallback when prefers-reduced-motion is set", () => {
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

    render(<Pyrotechnics intensity={1} />);
    expect(screen.getByTestId("pyrotechnics-reduced")).toBeInTheDocument();
    expect(screen.queryByTestId("pyrotechnics-root")).not.toBeInTheDocument();
  });

  it("renders the procedural canvas when reduced-motion is NOT set", () => {
    render(<Pyrotechnics intensity={1} />);
    expect(screen.getByTestId("pyrotechnics-root")).toBeInTheDocument();
    expect(screen.getByTestId("pyrotechnics-root").querySelector("canvas")).not.toBeNull();
  });
});

describe("Pyrotechnics · intensity guard", () => {
  it("renders nothing at intensity 0 (hard off)", () => {
    const { container } = render(<Pyrotechnics intensity={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not throw when canvas getContext is unavailable (jsdom)", () => {
    expect(() => render(<Pyrotechnics intensity={2.2} />)).not.toThrow();
    expect(screen.getByTestId("pyrotechnics-root")).toBeInTheDocument();
  });

  it("mounts and unmounts cleanly without throwing", () => {
    const { unmount } = render(<Pyrotechnics intensity={1.5} />);
    expect(() => unmount()).not.toThrow();
  });
});
