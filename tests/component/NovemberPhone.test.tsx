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
  it("paints one frame at a time: a frame-sized box, never a strip-wide layer", () => {
    wrap("november", <PlayerBetweenGames />);
    const f = screen.getByTestId("your-turkey-frame");
    expect(f.style.width).toBe("84px");
    expect(f.style.height).toBe("84px");
    expect(f.style.backgroundSize).toBe(`${84 * 30}px 84px`);
    expect(f.style.willChange).toBe("");
    expect(f.style.transform).toBe("");
    expect(screen.getByTestId("your-turkey").querySelectorAll("img").length).toBe(0);
  });

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

import { PlayerFinaleView } from "@/components/player";

describe("november phone step 3b screens", () => {
  it("lobby puts your turkey on your name plate", () => {
    wrap("november", <PlayerLobby playerName="Maya" inRoomCount={12} />);
    expect(screen.getByTestId("november-name-plate").textContent).toBe("Maya");
    expect(screen.getByTestId("november-lobby-hero")).toBeInTheDocument();
  });

  it("finale: a non-winner sees tonight's winner and their own night", () => {
    wrap("november", <PlayerFinaleView won={false} rank={7} score={1860} correct={14} answered={20} fastestMs={1800} longestStreak={5} playerName="Maya" playerCount={24} winner={{ name: "Linda", score: 2940 }} />);
    expect(screen.getByTestId("player-finale-winner-name").textContent).toBe("Linda");
    expect(screen.getByTestId("player-finale-your-night").textContent).toContain("#7");
  });

  it("finale: no winner name -> plain layout, the winner keeps the wishbone", () => {
    const { unmount } = wrap("november", <PlayerFinaleView won={false} rank={7} score={1} correct={1} answered={1} fastestMs={null} longestStreak={0} winner={null} />);
    expect(screen.queryByTestId("player-finale-november")).toBeNull();
    unmount();
    wrap("november", <PlayerFinaleView won rank={1} score={9} correct={1} answered={1} fastestMs={null} longestStreak={0} winner={{ name: "Maya", score: 9 }} />);
    expect(screen.getByTestId("player-finale-wishbone").textContent).toContain("You got the wishbone.");
  });

  it("other months never get the November lobby or finale card", () => {
    wrap("october", <PlayerFinaleView won={false} rank={7} score={1} correct={1} answered={1} fastestMs={null} longestStreak={0} winner={{ name: "Linda", score: 2 }} />);
    expect(screen.queryByTestId("player-finale-november")).toBeNull();
  });
});
