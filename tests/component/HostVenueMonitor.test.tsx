import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HostVenueMonitor } from "@/components/host/HostVenueMonitor";
import { ThemeProvider } from "@/components/system";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";

const snapshot: TVSnapshot = {
  night: {
    id: "night-1",
    venueName: "Soul Fire Pizza",
    themeKey: "april",
    hostDefaultThemeKey: "house",
    roomCode: "ABC123",
    openedAt: "2026-07-20T00:00:00.000Z",
    closedAt: null,
    scheduledAt: "2026-07-20T00:00:00.000Z",
    isLocked: false,
    roomMagicEnabled: false,
  },
  games: [{
    id: "game-1",
    gameNo: 1,
    state: "live",
    startedAt: "2026-07-20T00:01:00.000Z",
    endedAt: null,
    categoryCount: 1,
    questionCount: 1,
  }],
  currentGameId: "game-1",
  categories: [{
    id: "category-1",
    gameId: "game-1",
    name: "Music",
    topic: "Music",
    position: 0,
    color: "#E64A8C",
    state: "ready",
  }],
  questions: [{
    id: "question-1",
    categoryId: "category-1",
    pointValue: 100,
    prompt: "Which singer released Purple Rain?",
    options: ["Prince", "Bowie", "Madonna", "Cher"],
    correctIndex: 0,
    imageUrl: null,
    factBlurb: "Prince released Purple Rain in 1984.",
    playedAt: null,
    finishedAt: null,
    isPicked: true,
  }],
  liveQuestionId: null,
  targetQuestionId: null,
  players: [],
  scores: [],
  liveAnswers: [],
  reveals: [],
};

describe("HostVenueMonitor", () => {
  it("renders the exact audience TV inside a scaled 16:9 stage", () => {
    render(
      <ThemeProvider themeKey="april">
        <HostVenueMonitor
          snapshot={snapshot}
          themeKey="april"
        />
      </ThemeProvider>,
    );

    const preview = screen.getByRole("region", { name: "Venue TV preview" });
    expect(preview).toHaveAttribute("data-audience-safe", "true");
    expect(screen.getByText("What players see")).toBeVisible();
    expect(screen.getByText("TV preview")).toBeVisible();
    expect(screen.getByTestId("venue-tv-preview-frame")).toHaveClass(
      "venue-tv-preview-frame",
    );
    expect(screen.getByTestId("venue-tv-preview-canvas")).toHaveStyle({
      width: "1600px",
      height: "900px",
    });
    expect(screen.getByTestId("tv-grid")).toBeInTheDocument();
    expect(screen.queryByText("Prince released Purple Rain in 1984.")).not.toBeInTheDocument();
  });

  it("keeps the preview read-only without navigating the phone into the venue route", () => {
    render(
      <ThemeProvider themeKey="house">
        <HostVenueMonitor snapshot={snapshot} />
      </ThemeProvider>,
    );

    expect(screen.queryByRole("link", { name: "Open full venue display" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Music for 100 points/i })).not.toBeInTheDocument();
  });
});
