import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/components/system";
import { PlayerRevealWrong } from "@/components/player/PlayerRevealWrong";

describe("PlayerRevealWrong awareness line", () => {
  it("shows the count line when given counts", () => {
    render(
      <ThemeProvider themeKey="july">
        <PlayerRevealWrong correctCount={8} answeredCount={23} />
      </ThemeProvider>,
    );
    expect(screen.getByText("8 of 23 got this one")).toBeTruthy();
  });
  it("omits the line when counts are absent (back-compat default render)", () => {
    render(
      <ThemeProvider themeKey="july">
        <PlayerRevealWrong />
      </ThemeProvider>,
    );
    expect(screen.queryByText(/got this one/)).toBeNull();
  });
});
