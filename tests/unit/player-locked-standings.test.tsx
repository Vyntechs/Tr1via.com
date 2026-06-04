// After a player locks in, the phone should show the live standings so they
// can see where they stand while the timer runs — instead of just "waiting".
// The board is additive: when no standings are passed (gallery/demo), the
// locked screen renders exactly as before.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { PlayerLocked } from "@/components/player/PlayerLocked";
import type { StandingRow } from "@/lib/player/betweenGames";

afterEach(cleanup);

function wrap(node: React.ReactNode) {
  return render(<ThemeProvider themeKey="june">{node}</ThemeProvider>);
}

const TOP: StandingRow[] = [
  { rank: 1, name: "RB", score: 3150, isYou: false },
  { rank: 2, name: "Blood, Sweat and Beers", score: 2800, isYou: false },
  { rank: 3, name: "Dr. Honez", score: 2620, isYou: true },
];

describe("PlayerLocked — live standings after answering", () => {
  it("shows the standings board with ranks, names and scores", () => {
    wrap(<PlayerLocked standings={{ top: TOP, you: null }} />);
    expect(screen.getByText("RB")).toBeDefined();
    expect(screen.getByText("Blood, Sweat and Beers")).toBeDefined();
    expect(screen.getByText("3,150")).toBeDefined();
    expect(screen.getByText("2,620")).toBeDefined();
  });

  it("highlights the player's own row", () => {
    wrap(<PlayerLocked standings={{ top: TOP, you: null }} />);
    const you = screen.getByTestId("standings-you");
    expect(within(you).getByText("Dr. Honez")).toBeDefined();
  });

  it("pins the player's row when they rank below the visible top", () => {
    const below: StandingRow = { rank: 11, name: "Torrie", score: 900, isYou: true };
    wrap(
      <PlayerLocked
        standings={{ top: TOP.map((r) => ({ ...r, isYou: false })), you: below }}
      />,
    );
    const you = screen.getByTestId("standings-you");
    expect(within(you).getByText("Torrie")).toBeDefined();
    expect(within(you).getByText("11")).toBeDefined();
  });

  it("stays exactly as before when no standings are provided (backward compatible)", () => {
    wrap(<PlayerLocked />);
    expect(screen.getByTestId("player-locked")).toBeDefined();
    expect(screen.queryByTestId("standings-row")).toBeNull();
    expect(screen.queryByTestId("standings-you")).toBeNull();
  });
});
