// October · "your pumpkin" on the player's phone: it appears only on October
// nights, in the right mood for each screen, and never on any other theme.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/components/system";
import {
  PlayerBetweenGames,
  PlayerLobby,
  PlayerLocked,
  PlayerQuestion,
  PlayerRevealCorrect,
  PlayerRevealWrong,
} from "@/components/player";
import type { ThemeKey } from "@/lib/theme/tokens";
import type { ReactNode } from "react";

const wrap = (themeKey: ThemeKey, node: ReactNode) =>
  render(<ThemeProvider themeKey={themeKey}>{node}</ThemeProvider>);
const mood = () => screen.getByTestId("your-pumpkin").getAttribute("data-pumpkin-mood");

describe("your pumpkin (October phones)", () => {
  it("waits unlit above the answers, shivers in the last five seconds, tips over at zero", () => {
    const { rerender } = wrap("october", <PlayerQuestion seconds={12} />);
    expect(mood()).toBe("waiting");
    rerender(<ThemeProvider themeKey="october"><PlayerQuestion seconds={4} /></ThemeProvider>);
    expect(mood()).toBe("waiting");
    expect(screen.getByTestId("your-pumpkin").innerHTML).toContain("tr1via-oct-shiver");
    rerender(<ThemeProvider themeKey="october"><PlayerQuestion seconds={0} /></ThemeProvider>);
    expect(mood()).toBe("toppled");
  });

  it("lights the moment you lock in", () => {
    wrap("october", <PlayerLocked chosenSlot={2} seconds={9} />);
    expect(mood()).toBe("lit");
  });

  it("blazes on a right answer (the green screen stays)", () => {
    wrap("october", <PlayerRevealCorrect />);
    expect(mood()).toBe("blaze");
    expect(screen.getByTestId("player-reveal-correct")).toBeInTheDocument();
  });

  it("smokes on a wrong answer and offers to relight it", () => {
    wrap("october", <PlayerRevealWrong chosenSlot={1} />);
    expect(mood()).toBe("smoke");
    expect(screen.getByText(/Relight it next question/)).toBeInTheDocument();
  });

  it("is knocked over when time ran out", () => {
    wrap("october", <PlayerRevealWrong chosenSlot={null} />);
    expect(mood()).toBe("toppled");
  });

  it("glows in the patch while you wait in the lobby", () => {
    wrap("october", <PlayerLobby />);
    expect(mood()).toBe("lit");
    expect(screen.getByText("Your pumpkin is in the patch.")).toBeInTheDocument();
  });

  it("says Game 2 rides soon between games", () => {
    wrap("october", <PlayerBetweenGames />);
    expect(screen.getByText("Game 2 rides soon.")).toBeInTheDocument();
  });

  it("never appears on any other theme", () => {
    for (const theme of ["house", "may", "july", "september", "november", "december"] as ThemeKey[]) {
      const { unmount } = wrap(
        theme,
        <>
          <PlayerQuestion seconds={4} />
          <PlayerLocked chosenSlot={2} />
          <PlayerRevealCorrect />
          <PlayerRevealWrong chosenSlot={1} />
          <PlayerLobby />
          <PlayerBetweenGames />
        </>,
      );
      expect(screen.queryByTestId("your-pumpkin")).toBeNull();
      expect(screen.queryByText("Game 2 rides soon.")).toBeNull();
      unmount();
    }
  });
});
