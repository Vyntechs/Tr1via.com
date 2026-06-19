import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/components/system";
import { PlayerRevealCorrect } from "@/components/player/PlayerRevealCorrect";

describe("PlayerRevealCorrect social line", () => {
  it("shows 'You + N others nailed it'", () => {
    render(
      <ThemeProvider themeKey="july">
        <PlayerRevealCorrect correctCount={8} />
      </ThemeProvider>,
    );
    expect(screen.getByText("You + 7 others nailed it")).toBeTruthy();
  });
  it("shows the solo line for a lone correct player", () => {
    render(
      <ThemeProvider themeKey="july">
        <PlayerRevealCorrect correctCount={1} />
      </ThemeProvider>,
    );
    expect(screen.getByText("You nailed it")).toBeTruthy();
  });
  it("omits the line when no count is given", () => {
    render(
      <ThemeProvider themeKey="july">
        <PlayerRevealCorrect />
      </ThemeProvider>,
    );
    expect(screen.queryByText(/nailed it/)).toBeNull();
  });
});
