import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/components/system";
import { PlayerStandingsNeighborhood } from "@/components/player/PlayerStandingsNeighborhood";
import type { StandingRow } from "@/lib/player/betweenGames";

const rows: StandingRow[] = [
  { rank: 6, name: "Theo", score: 2540, isYou: false },
  { rank: 7, name: "You", score: 2340, isYou: true },
  { rank: 8, name: "Sam", score: 2210, isYou: false },
];

function renderIt(meRank: number | null) {
  return render(
    <ThemeProvider themeKey="july">
      <PlayerStandingsNeighborhood rows={rows} meRank={meRank} total={24} />
    </ThemeProvider>,
  );
}

describe("PlayerStandingsNeighborhood", () => {
  it("shows the player's rank headline and every neighborhood row", () => {
    renderIt(7);
    // Headline shows the player's own rank (accent-colored). Targeted by testid
    // because "#7" also appears on the player's own neighborhood row.
    expect(screen.getByTestId("standings-headline").textContent).toContain("#7");
    expect(screen.getByText("Theo")).toBeTruthy();
    expect(screen.getByText("Sam")).toBeTruthy();
    expect(screen.getByTestId("standings-neighborhood")).toBeTruthy();
  });

  it("flags the player's own row", () => {
    renderIt(7);
    expect(screen.getByTestId("standings-you")).toBeTruthy();
  });

  it("renders a calm placeholder (no '#0') when rank is unknown", () => {
    render(
      <ThemeProvider themeKey="july">
        <PlayerStandingsNeighborhood rows={[]} meRank={null} total={24} />
      </ThemeProvider>,
    );
    expect(screen.queryByText(/#0/)).toBeNull();
  });
});
