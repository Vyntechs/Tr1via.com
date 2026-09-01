import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SeptemberFront } from "@/components/system/SeptemberFront";

const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/hooks/usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => reducedMotion.value,
}));

afterEach(() => {
  reducedMotion.value = false;
  cleanup();
});

describe("September First Cool Front honors reduced motion", () => {
  it("keeps the static warm-to-cool identity and contours", () => {
    reducedMotion.value = true;
    render(<SeptemberFront />);
    expect(screen.getByTestId("september-front-air-masses")).toBeInTheDocument();
    expect(screen.getByTestId("september-front-boundary")).toBeInTheDocument();
    expect(screen.getByTestId("september-front-contours")).toBeInTheDocument();
    expect(screen.getByTestId("september-distant-stadium")).toBeInTheDocument();
    expect(screen.getByTestId("september-friday-night-hashes")).toBeInTheDocument();
    expect(screen.getByTestId("september-homecoming-drift")).toHaveAttribute("data-motion", "static");
  });

  it("omits the moving veil instead of freezing it", () => {
    reducedMotion.value = true;
    render(<SeptemberFront />);
    expect(screen.queryByTestId("september-front-wind-veil")).toBeNull();
  });

  it("renders the slow veil for an open full-size state", () => {
    render(<SeptemberFront page="lobby" />);
    expect(screen.getByTestId("september-front-wind-veil")).toBeInTheDocument();
    expect(screen.getByTestId("september-homecoming-drift")).toHaveAttribute("data-motion", "falling");
  });
});
