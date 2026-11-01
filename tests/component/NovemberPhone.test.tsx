// November · "your turkey" and the field on the player's phone: only on
// November nights, in the right mood per screen, never on any other theme.

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
  PlayerWinnerCard,
} from "@/components/player";
import type { ThemeKey } from "@/lib/theme/tokens";
import type { ReactNode } from "react";

const wrap = (themeKey: ThemeKey, node: ReactNode) =>
  render(<ThemeProvider themeKey={themeKey}>{node}</ThemeProvider>);
const mood = () => screen.getByTestId("your-turkey").getAttribute("data-turkey-mood");

describe("your turkey (November phones)", () => {
  it("walks into the field in the lobby", () => {
    wrap("november", <PlayerLobby playerName="Maya" inRoomCount={3} />);
    expect(screen.getByTestId("your-turkey").getAttribute("data-turkey-anim")).toBe("walk");
    expect(screen.getByTestId("player-lobby").getAttribute("data-harvest-sky")).toBe("golden");
  });

  it("idles during the question and does not dive into the hay at zero", () => {
    const { rerender } = wrap("november", <PlayerQuestion seconds={12} />);
    expect(mood()).toBe("waiting");
    rerender(<ThemeProvider themeKey="november"><PlayerQuestion seconds={0} /></ThemeProvider>);
    expect(mood()).toBe("waiting");
  });

  it("fans its tail on lock-in", () => {
    wrap("november", <PlayerLocked chosenSlot={2} seconds={9} />);
    expect(mood()).toBe("lit");
  });

  it("gobbles on a right answer and the green screen stays", () => {
    wrap("november", <PlayerRevealCorrect />);
    expect(mood()).toBe("blaze");
    expect(screen.getByTestId("player-reveal-correct").getAttribute("data-harvest-sky")).toBeNull();
  });

  it("droops on a wrong answer, hides in the hay on no answer", () => {
    const { unmount } = wrap("november", <PlayerRevealWrong chosenSlot={1} />);
    expect(mood()).toBe("smoke");
    unmount();
    wrap("november", <PlayerRevealWrong chosenSlot={null} />);
    expect(mood()).toBe("toppled");
    expect(screen.getByText(/Time's/)).toBeInTheDocument();
  });

  it("sets the pie out between games and hands the winner the wishbone", () => {
    const { unmount } = wrap("november", <PlayerBetweenGames playerName="You" top={[]} you={null} />);
    expect(screen.getByTestId("november-halftime-pie")).toBeInTheDocument();
    expect(screen.getByTestId("player-between-games").getAttribute("data-harvest-sky")).toBe("night");
    unmount();
    wrap("november", <PlayerWinnerCard />);
    expect(screen.getByTestId("november-winner-wishbone")).toBeInTheDocument();
  });

  it("never appears on other months, and the field stays off", () => {
    for (const k of ["october", "september", "house"] as ThemeKey[]) {
      const { unmount } = wrap(k, <PlayerRevealWrong chosenSlot={1} />);
      expect(screen.queryByTestId("your-turkey")).toBeNull();
      expect(screen.getByTestId("player-reveal-wrong").getAttribute("data-harvest-sky")).toBeNull();
      unmount();
    }
  });
});
