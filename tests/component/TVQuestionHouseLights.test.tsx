import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TVQuestion } from "@/components/tv/TVQuestion";

const tiles = [
  { id: "a1", name: "Alex", t: "1.1s" },
  { id: "a2", name: "Brooke", t: "2.4s" },
];

describe("TVQuestion House Lights", () => {
  it("does not render House Lights when Room Magic is disabled", () => {
    render(
      <TVQuestion
        themeKey="house"
        roomMagicEnabled={false}
        tiles={tiles}
        totalPlayers={3}
      />,
    );

    expect(screen.queryByTestId("tv-house-lights")).not.toBeInTheDocument();
  });

  it("renders House Lights from aggregate lock-in state when Room Magic is enabled", () => {
    render(
      <TVQuestion
        themeKey="house"
        roomMagicEnabled
        tiles={tiles}
        totalPlayers={3}
        houseLightsLockedCount={2}
      />,
    );

    expect(screen.getByTestId("tv-house-lights")).toHaveTextContent(
      "2 of 3 locked in",
    );
  });

  it("does not render House Lights from demo fallback counts", () => {
    render(
      <TVQuestion
        themeKey="house"
        roomMagicEnabled
        tiles={tiles}
      />,
    );

    expect(screen.queryByTestId("tv-house-lights")).not.toBeInTheDocument();
  });
});
