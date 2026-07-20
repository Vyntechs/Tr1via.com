import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HostBetweenGames } from "@/components/host/HostBetweenGames";
import { ThemeProvider } from "@/components/system";
import { contrastRatio, readableForeground } from "@/lib/theme/contrast";
import { resolveTheme } from "@/lib/theme/resolve";
import { THEME_KEYS, type ThemeKey } from "@/lib/theme/tokens";

const standings = [
  { playerId: "p1", name: "Jordan", score: 6100 },
  { playerId: "p2", name: "Morgan", score: 5400 },
];

function renderState(
  mode: "intermission" | "present-winners" | "finale" | "complete",
  onPrimary = vi.fn(),
  themeKey: ThemeKey = "house",
) {
  render(
    <ThemeProvider themeKey={themeKey}>
      <HostBetweenGames
        mode={mode}
        standings={standings}
        onPrimary={onPrimary}
      />
    </ThemeProvider>,
  );
  return onPrimary;
}

describe("HostBetweenGames", () => {
  it("makes Game 2 a deliberate one-tap continuation from Game 1 standings", () => {
    const onPrimary = renderState("intermission");

    expect(screen.getByRole("heading", { name: "Game 2 is ready" })).toBeVisible();
    expect(screen.getByText("Game 1 complete")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Game 1 standings" })).toBeVisible();
    expect(screen.getByText("Jordan")).toBeVisible();
    const start = screen.getByRole("button", { name: "Start Game 2" });
    expect(start).toHaveStyle({ minHeight: "48px" });
    fireEvent.click(start);
    expect(onPrimary).toHaveBeenCalledOnce();
  });

  it("separates presenting winners from ending the game", () => {
    const present = renderState("present-winners");
    expect(screen.getByRole("heading", { name: "Final scores are ready" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Present winners" }));
    expect(present).toHaveBeenCalledOnce();

    document.body.innerHTML = "";
    const end = renderState("finale");
    expect(screen.getByRole("heading", { name: "Winners are being presented" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "End game" }));
    expect(end).toHaveBeenCalledOnce();
  });

  it("has no active ending action after the night is closed", () => {
    renderState("complete", vi.fn(), "april");
    expect(screen.getByRole("heading", { name: "Game complete" })).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("never claims an unobserved venue-TV or phone delivery", () => {
    renderState("finale");
    expect(screen.queryByText(/all screens|confirmed|every phone|tv is current/i)).not.toBeInTheDocument();
  });

  it.each(THEME_KEYS)("inherits the %s theme with an AA-readable primary action", (themeKey) => {
    renderState("intermission", vi.fn(), themeKey);
    const theme = resolveTheme(themeKey);
    const primary = screen.getByRole("button", { name: "Start Game 2" });

    expect(primary).toHaveStyle({
      background: theme.accent,
      color: readableForeground(theme.accent),
      minHeight: "48px",
    });
    expect(
      contrastRatio(readableForeground(theme.accent), theme.accent),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
