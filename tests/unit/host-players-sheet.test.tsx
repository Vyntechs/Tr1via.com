import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { HostLiveConsole, type HostLivePlayer } from "@/components/host/HostLiveConsole";

const PLAYERS: HostLivePlayer[] = [
  { id: "p1", name: "Devon", score: 2140, locked: true, appOff: "0s" },
  { id: "p2", name: "Iris", score: 1990, locked: true, appOff: "0s" },
];

function openSheet() {
  render(
    <HostLiveConsole
      themeKey="house"
      players={PLAYERS}
      roomCode="K9PR4M"
      joinUrl="https://tr1via.com/join?code=K9PR4M"
      onAddPlayer={() => {}}
      onRemovePlayer={() => {}}
    />,
  );
  fireEvent.click(screen.getByTestId("host-players-btn"));
  return screen.getByTestId("host-players-sheet");
}

describe("PlayersSheet — mid-game scannable join QR", () => {
  it("enlarges the QR to the restacked clamp size", () => {
    const sheet = openSheet();
    const qrBox = within(sheet).getByLabelText(/QR code:/i).closest("div") as HTMLElement;
    expect(qrBox).not.toBeNull();
    expect(qrBox.style.width).toBe("clamp(200px, 30vh, 300px)");
  });

  it("shows the reassurance line that the game is still running", () => {
    const sheet = openSheet();
    expect(within(sheet).getByText(/Game's still running/i)).toBeInTheDocument();
  });

  it("labels the QR by who scans it and what happens", () => {
    const sheet = openSheet();
    expect(
      within(sheet).getByText("Players — scan to join this game"),
    ).toBeInTheDocument();
  });

  it("keeps the roster and add-latecomer button (no regression)", () => {
    const sheet = openSheet();
    expect(within(sheet).getByTestId("host-add-player-btn")).toBeInTheDocument();
    expect(within(sheet).getByText("Devon")).toBeInTheDocument();
    expect(within(sheet).getByText("Iris")).toBeInTheDocument();
  });
});
