import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { PlayerLobby } from "@/components/player/PlayerLobby";
import type { LobbyTopic } from "@/lib/tv/lobbyTopics";

const TOPICS: LobbyTopic[] = [
  // name = the host's clean label; topic = the long AI generation instruction.
  { label: "Pest", name: "Pest", topic: "Pest like mosquitoes and flies, also children in movies", color: "#E64A8C", position: 0 },
  { label: "Cocktails", name: "Cocktails", topic: "cocktails and mixed drinks", color: null, position: 1 },
];

function wrap(node: React.ReactNode) {
  return <ThemeProvider themeKey="house">{node}</ThemeProvider>;
}

describe("PlayerLobby — Tonight's Topics", () => {
  it("renders each topic's clean label, never the AI generation instruction", () => {
    render(wrap(<PlayerLobby playerName="Maya" inRoomCount={12} topics={TOPICS} />));
    expect(screen.getByTestId("player-lobby-topics")).toBeInTheDocument();
    expect(screen.getAllByTestId("player-lobby-topic")).toHaveLength(TOPICS.length);
    expect(screen.getByText("Pest")).toBeInTheDocument();
    expect(screen.getByText("Cocktails")).toBeInTheDocument();
    // the long generation instruction must never reach the player's phone
    expect(screen.queryByText(/mosquitoes/i)).not.toBeInTheDocument();
  });

  it("renders no topics panel when none are provided", () => {
    render(wrap(<PlayerLobby playerName="Maya" inRoomCount={12} />));
    expect(screen.queryByTestId("player-lobby-topics")).toBeNull();
  });
});
