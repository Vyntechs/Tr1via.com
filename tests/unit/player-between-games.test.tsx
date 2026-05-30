import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { PlayerBetweenGames } from "@/components/player/PlayerBetweenGames";
import type { StandingRow } from "@/lib/player/betweenGames";

const TOP: StandingRow[] = [
  { rank: 1, name: "Alice", score: 12320, isYou: false },
  { rank: 2, name: "Carol", score: 9160, isYou: false },
  { rank: 3, name: "You", score: 8420, isYou: true },
];

function wrap(node: React.ReactNode) {
  return <ThemeProvider themeKey="house">{node}</ThemeProvider>;
}

describe("PlayerBetweenGames", () => {
  it("reassures the player they're in game 2", () => {
    render(wrap(<PlayerBetweenGames playerName="You" top={TOP} you={null} />));
    expect(screen.getByTestId("player-between-games")).toBeInTheDocument();
    expect(screen.getByText(/in game 2/i)).toBeInTheDocument();
  });

  it("renders the standings with exactly one highlighted 'you' row", () => {
    render(wrap(<PlayerBetweenGames playerName="You" top={TOP} you={null} />));
    expect(screen.getAllByTestId("standings-row")).toHaveLength(2); // non-you rows
    const you = screen.getAllByTestId("standings-you");
    expect(you).toHaveLength(1);
    expect(you[0]).toHaveTextContent("You");
  });

  it("pins the player's own row when they rank below the top list", () => {
    const below: StandingRow = { rank: 9, name: "You", score: 400, isYou: true };
    render(wrap(<PlayerBetweenGames playerName="You" top={TOP.slice(0, 2)} you={below} />));
    const you = screen.getAllByTestId("standings-you");
    expect(you).toHaveLength(1);
    expect(you[0]).toHaveTextContent("9");
  });

  it("spawns a floating cheer when a cheer button is tapped", () => {
    render(wrap(<PlayerBetweenGames playerName="You" top={TOP} you={null} />));
    expect(screen.queryAllByTestId("cheer-float")).toHaveLength(0);
    fireEvent.click(screen.getAllByTestId("cheer-btn")[0]);
    expect(screen.getAllByTestId("cheer-float").length).toBeGreaterThan(0);
  });
});
