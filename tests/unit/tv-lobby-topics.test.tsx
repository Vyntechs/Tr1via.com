import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { TVLobbyTopics } from "@/components/tv/TVLobbyTopics";
import type { LobbyTopic } from "@/lib/tv/lobbyTopics";

const TOPICS: LobbyTopic[] = [
  { name: "Movies", topic: "Disney Pixar Movies", color: "#E64A8C", position: 0 },
  { name: "Music", topic: "80s One-Hit Wonders", color: "#9B7BD8", position: 1 },
];

function wrap(node: React.ReactNode) {
  return <ThemeProvider themeKey="house">{node}</ThemeProvider>;
}

describe("TVLobbyTopics", () => {
  it("renders each topic's specific topic string", () => {
    render(wrap(<TVLobbyTopics topics={TOPICS} />));
    expect(screen.getByTestId("tv-lobby-topics")).toBeInTheDocument();
    expect(screen.getByText("Disney Pixar Movies")).toBeInTheDocument();
    expect(screen.getByText("80s One-Hit Wonders")).toBeInTheDocument();
    expect(screen.getAllByTestId("tv-lobby-topic")).toHaveLength(2);
  });

  it("renders nothing when there are no topics", () => {
    render(wrap(<TVLobbyTopics topics={[]} />));
    expect(screen.queryByTestId("tv-lobby-topics")).not.toBeInTheDocument();
  });
});
