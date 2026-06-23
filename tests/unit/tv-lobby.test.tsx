import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TVLobby } from "@/components/tv/TVLobby";
import type { LobbyTopic } from "@/lib/tv/lobbyTopics";

const TOPICS: LobbyTopic[] = [
  { label: "Pest", name: "Pest", topic: "pest like mosquitoes", color: "#E64A8C", position: 0 },
  { label: "Cocktails", name: "Cocktails", topic: "cocktails", color: "#9B7BD8", position: 1 },
];

describe("TVLobby — scannable join QR", () => {
  it("sizes the lobby QR as the visual hero (clamp ceiling 460px)", () => {
    render(
      <TVLobby
        themeKey="house"
        joinUrl="https://tr1via.com/join?code=K9PR4M"
        roomCode="K9P·R4M"
        topics={TOPICS}
      />,
    );

    // The QR frame card carries the testid; its child is the QRBlock wrapper
    // whose inline width === the size prop we pass through.
    const frame = screen.getByTestId("tv-lobby-qr");
    expect(frame).toBeInTheDocument();
    const qrBox = frame.firstElementChild as HTMLElement;
    expect(qrBox).not.toBeNull();
    expect(qrBox.style.width).toBe("clamp(240px, 40vh, 460px)");
  });

  it("uses a balanced 1fr 1fr content grid so the bigger QR card fits", () => {
    render(
      <TVLobby
        themeKey="house"
        joinUrl="https://tr1via.com/join?code=K9PR4M"
        roomCode="K9P·R4M"
        topics={TOPICS}
      />,
    );

    const grid = screen.getByTestId("tv-lobby-qr").closest("div[style*='grid']") as HTMLElement;
    // Walk up to the grid container (the QR frame is nested two levels deep).
    const gridContainer =
      (screen.getByTestId("tv-lobby").querySelector("div[style*='grid-template-columns']") as HTMLElement) ?? grid;
    expect(gridContainer.style.gridTemplateColumns).toBe("1fr 1fr");
  });
});
