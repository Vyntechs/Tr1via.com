import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { TVLobbyTopics } from "@/components/tv/TVLobbyTopics";
import type { LobbyTopic } from "@/lib/tv/lobbyTopics";

const TOPICS: LobbyTopic[] = [
  // name = the host's clean label; topic = the long AI generation instruction.
  { label: "Pest", name: "Pest", topic: "Pest like mosquitoes and flies, also children in movies", color: "#E64A8C", position: 0 },
  { label: "Cocktails", name: "Cocktails", topic: "cocktails and mixed drinks", color: "#9B7BD8", position: 1 },
];

function wrap(node: React.ReactNode) {
  return <ThemeProvider themeKey="house">{node}</ThemeProvider>;
}

describe("TVLobbyTopics", () => {
  it("renders each topic's clean label, never the AI generation instruction", () => {
    render(wrap(<TVLobbyTopics topics={TOPICS} />));
    expect(screen.getByTestId("tv-lobby-topics")).toBeInTheDocument();
    expect(screen.getByText("Pest")).toBeInTheDocument();
    expect(screen.getByText("Cocktails")).toBeInTheDocument();
    // the long generation instruction must never reach a player-facing surface
    expect(screen.queryByText(/mosquitoes/i)).not.toBeInTheDocument();
    expect(screen.getAllByTestId("tv-lobby-topic")).toHaveLength(2);
  });

  it("renders nothing when there are no topics", () => {
    render(wrap(<TVLobbyTopics topics={[]} />));
    expect(screen.queryByTestId("tv-lobby-topics")).not.toBeInTheDocument();
  });

  it("renders inside a readability layer for the mirrored host lobby", () => {
    render(wrap(<TVLobbyTopics topics={TOPICS} />));
    const panel = screen.getByTestId("tv-lobby-topics");
    expect(panel).toHaveAttribute("data-readability", "scrim");
    expect(panel.style.background).toContain("linear-gradient");
  });
});
