import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlayerLockInBolt } from "@/components/player/PlayerLockInBolt";

describe("PlayerLockInBolt", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when `active` is false", () => {
    const { container } = render(<PlayerLockInBolt active={false} tint="#E64A8C" />);
    expect(container.querySelector("[data-testid='phone-bolt']")).toBeNull();
  });

  it("renders the bolt SVG when `active` is true", () => {
    render(<PlayerLockInBolt active={true} tint="#E64A8C" />);
    expect(screen.getByTestId("phone-bolt")).toBeInTheDocument();
  });

  it("uses tint color for the bolt stroke filter", () => {
    const { container } = render(<PlayerLockInBolt active={true} tint="#5AA8E0" />);
    const svg = container.querySelector("[data-testid='phone-bolt']");
    expect(svg?.getAttribute("style") ?? "").toContain("#5AA8E0");
  });

  it("calls onComplete after the animation duration", async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(
      <PlayerLockInBolt active={true} tint="#E64A8C" onComplete={onComplete} />
    );
    vi.advanceTimersByTime(750);
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("respects prefers-reduced-motion (no flash overlay)", () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (q: string) => ({
        matches: q.includes("reduce"),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
    try {
      const { container } = render(<PlayerLockInBolt active={true} tint="#E64A8C" />);
      expect(container.querySelector("[data-testid='phone-bolt-flash']")).toBeNull();
    } finally {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: originalMatchMedia,
      });
    }
  });
});
