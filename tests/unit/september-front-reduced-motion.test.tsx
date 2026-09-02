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
    const football = screen.getAllByTestId("september-homecoming-football")[0];
    const pom = screen.getAllByTestId("september-homecoming-pom")[0];
    expect(Number.parseFloat(football.style.height)).toBeGreaterThanOrEqual(40);
    expect(Number.parseFloat(pom.style.height)).toBeGreaterThanOrEqual(44);
    expect(football.style.animation).toBe("");
    expect(pom.style.animation).toBe("");
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

  it("lets an open compact game surface fall when motion is allowed", () => {
    render(<SeptemberFront compact page="lobby" />);
    expect(screen.queryByTestId("september-front-wind-veil")).toBeNull();
    expect(screen.getByTestId("september-homecoming-drift")).toHaveAttribute("data-motion", "falling");
  });
});
