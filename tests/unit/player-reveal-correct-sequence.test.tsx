import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ThemeProvider } from "@/components/system";
import { PlayerRevealCorrectSequence } from "@/components/player/PlayerRevealCorrectSequence";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("PlayerRevealCorrectSequence", () => {
  it("starts on the dark celebration, then reveals the bright payoff after the hold", () => {
    render(
      <ThemeProvider themeKey="july">
        <PlayerRevealCorrectSequence correctCount={8} payoffProps={{ awardedPoints: 220 }} darkMs={1000} />
      </ThemeProvider>,
    );
    // Dark phase first — the bright payoff is not yet shown.
    expect(screen.getByTestId("reveal-correct-dark")).toBeTruthy();
    expect(screen.queryByTestId("player-reveal-correct")).toBeNull();

    act(() => { vi.advanceTimersByTime(1000); });

    // Bright payoff now shown.
    expect(screen.getByTestId("player-reveal-correct")).toBeTruthy();
    expect(screen.getByText("You + 7 others nailed it")).toBeTruthy();
  });
});
