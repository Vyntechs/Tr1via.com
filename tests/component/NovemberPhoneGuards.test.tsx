// November phone screens never blank a phone: a throw inside the November
// lobby falls back to the everyday lobby (review 1, should-fix 1).
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/system";

vi.mock("@/components/experience/november/NovemberLobby", () => ({
  NovemberLobby: () => {
    throw new Error("boom in the November lobby");
  },
}));

import { PlayerLobby } from "@/components/player/PlayerLobby";

describe("November phone crash guards", () => {
  it("a broken November lobby shows the everyday lobby instead", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ThemeProvider themeKey="november">
        <PlayerLobby playerName="Maya" hostName="Linda" />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("player-lobby")).toBeInTheDocument();
    expect(screen.getByText(/will start the first game/)).toBeInTheDocument();
    warn.mockRestore();
    err.mockRestore();
  });
});
