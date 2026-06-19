import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { PlayerJoinGame2 } from "@/components/player/PlayerJoinGame2";
import type { LobbyTopic } from "@/lib/tv/lobbyTopics";

const TOPICS: LobbyTopic[] = [
  // name = the host's clean label; topic = the long AI generation instruction.
  { label: "Pest", name: "Pest", topic: "Pest like mosquitoes and flies, also children in movies", color: "#E64A8C", position: 0 },
  { label: "Cocktails", name: "Cocktails", topic: "cocktails and mixed drinks", color: null, position: 1 },
];

function wrap(node: React.ReactNode) {
  return <ThemeProvider themeKey="house">{node}</ThemeProvider>;
}

describe("PlayerJoinGame2 — upcoming Game-2 topics preview", () => {
  it("renders the upcoming Game-2 topics alongside the join CTA", () => {
    render(wrap(<PlayerJoinGame2 playerName="Maya" onJoin={() => {}} topics={TOPICS} />));
    expect(screen.getByTestId("player-join-game2-topics")).toBeInTheDocument();
    expect(screen.getAllByTestId("player-join-game2-topic")).toHaveLength(TOPICS.length);
    expect(screen.getByText("Pest")).toBeInTheDocument();
    expect(screen.queryByText(/mosquitoes/i)).not.toBeInTheDocument();
    // the join CTA must remain reachable with the panel present
    expect(screen.getByTestId("player-join-game2-submit")).toBeInTheDocument();
  });

  it("renders no topics panel when there are no ready topics, CTA still present", () => {
    render(wrap(<PlayerJoinGame2 playerName="Maya" onJoin={() => {}} topics={[]} />));
    expect(screen.queryByTestId("player-join-game2-topics")).toBeNull();
    expect(screen.getByTestId("player-join-game2-submit")).toBeInTheDocument();
  });

  it("renders no topics panel when the prop is omitted (unchanged default)", () => {
    render(wrap(<PlayerJoinGame2 playerName="Maya" onJoin={() => {}} />));
    expect(screen.queryByTestId("player-join-game2-topics")).toBeNull();
  });
});
