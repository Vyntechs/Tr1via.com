// A month's weather that crashed gets a fresh try when the host switches the
// night to another theme — without rebuilding the guard around it.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const explode = { now: true };
vi.mock("@/components/system/ParticleField", () => ({
  ParticleField: () => {
    if (explode.now) throw new Error("weather exploded");
    return <div data-testid="particles" />;
  },
}));

import { Weather } from "@/components/system/Weather";

describe("Weather safety net", () => {
  it("switches a crashed month off, then tries again on a theme change", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rerender } = render(<Weather themeKey="january" />);
    expect(screen.queryByTestId("particles")).toBeNull();

    explode.now = false;
    rerender(<Weather themeKey="february" />);
    expect(screen.getByTestId("particles")).toBeInTheDocument();
  });
});
