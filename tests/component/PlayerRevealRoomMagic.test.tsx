import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import {
  PlayerRevealCorrect,
  PlayerRevealStandingsPanel,
  PlayerRevealWrong,
} from "@/components/player";
import type { StandingRow } from "@/lib/player/betweenGames";

function wrap(node: React.ReactNode) {
  return <ThemeProvider themeKey="june">{node}</ThemeProvider>;
}

function controls() {
  return <div data-testid="room-magic-controls">Reaction controls</div>;
}

function standingsPanel() {
  return <div data-testid="reveal-standings-panel">Where you stand</div>;
}

const lowerRankRows: StandingRow[] = [
  { rank: 1, name: "Casey", score: 500, isYou: false },
  { rank: 2, name: "Brooke", score: 400, isYou: false },
  { rank: 3, name: "Drew", score: 300, isYou: false },
  { rank: 4, name: "Emery", score: 200, isYou: false },
  { rank: 5, name: "Alex", score: 100, isYou: true },
];

describe("player reveal Room Magic slot", () => {
  it("renders Room Magic controls on the correct reveal when supplied", () => {
    render(wrap(<PlayerRevealCorrect roomMagicControls={controls()} />));

    expect(screen.getByTestId("room-magic-controls")).toBeInTheDocument();
  });

  it("renders Room Magic controls on the wrong reveal when supplied", () => {
    render(wrap(<PlayerRevealWrong roomMagicControls={controls()} />));

    expect(screen.getByTestId("room-magic-controls")).toBeInTheDocument();
  });

  it("omits controls when the page does not supply the reveal-only slot", () => {
    render(wrap(<PlayerRevealWrong />));

    expect(screen.queryByTestId("room-magic-controls")).not.toBeInTheDocument();
  });

  it("keeps reactions and standings together on the correct reveal hold", () => {
    render(
      wrap(
        <PlayerRevealCorrect
          roomMagicControls={controls()}
          standingsPanel={standingsPanel()}
        />,
      ),
    );

    expect(screen.getByTestId("room-magic-controls")).toBeInTheDocument();
    expect(screen.getByTestId("reveal-standings-panel")).toBeInTheDocument();
  });

  it("keeps reactions and standings together on the wrong reveal hold", () => {
    render(
      wrap(
        <PlayerRevealWrong
          roomMagicControls={controls()}
          standingsPanel={standingsPanel()}
        />,
      ),
    );

    expect(screen.getByTestId("room-magic-controls")).toBeInTheDocument();
    expect(screen.getByTestId("reveal-standings-panel")).toBeInTheDocument();
  });

  it("keeps the player row inside the compact standings window", () => {
    render(
      wrap(
        <PlayerRevealStandingsPanel
          rows={lowerRankRows}
          meRank={5}
          total={8}
        />,
      ),
    );

    expect(screen.getByTestId("reveal-standings-you")).toHaveTextContent("Alex");
    expect(screen.getByText("#5")).toBeInTheDocument();
    expect(screen.queryByText("Casey")).not.toBeInTheDocument();
  });
});
