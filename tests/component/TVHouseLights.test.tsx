import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TVHouseLights } from "@/components/tv/TVHouseLights";

let reducedMotion = false;

vi.mock("@/lib/hooks/usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => reducedMotion,
}));

describe("TVHouseLights", () => {
  it("renders nothing when Room Magic is disabled", () => {
    const { container } = render(
      <TVHouseLights
        roomMagicEnabled={false}
        lockedCount={2}
        totalPlayers={3}
        accent="#7DD3FC"
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders aggregate lock-in progress when enabled", () => {
    render(
      <TVHouseLights
        roomMagicEnabled
        lockedCount={2}
        totalPlayers={3}
        accent="#7DD3FC"
      />,
    );

    expect(screen.getByTestId("tv-house-lights")).toHaveTextContent(
      "2 of 3 locked in",
    );
    expect(screen.getByTestId("tv-house-lights-fill")).toHaveStyle({
      width: "67%",
    });
  });

  it("hides impossible player counts instead of guessing", () => {
    const { container } = render(
      <TVHouseLights
        roomMagicEnabled
        lockedCount={4}
        totalPlayers={3}
        accent="#7DD3FC"
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("keeps reduced motion meaningful without animation", () => {
    reducedMotion = true;
    render(
      <TVHouseLights
        roomMagicEnabled
        lockedCount={1}
        totalPlayers={2}
        accent="#7DD3FC"
      />,
    );

    expect(screen.getByTestId("tv-house-lights")).toHaveAttribute(
      "data-reduced-motion",
      "true",
    );
    expect(screen.getByTestId("tv-house-lights")).toHaveStyle({
      animation: "none",
    });
    reducedMotion = false;
  });
});
