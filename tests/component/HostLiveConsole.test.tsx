import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HostLiveConsole } from "@/components/host/HostLiveConsole";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";

type Game = TVSnapshot["games"][number];
type Category = TVSnapshot["categories"][number];
type Question = TVSnapshot["questions"][number];

function game(overrides: Partial<Game> & Pick<Game, "id" | "gameNo" | "state">): Game {
  return {
    startedAt: null,
    endedAt: null,
    categoryCount: 1,
    questionCount: 1,
    ...overrides,
  };
}

function category(overrides: Partial<Category> & Pick<Category, "id" | "gameId">): Category {
  return {
    name: "Salsa",
    topic: "Salsa",
    position: 0,
    color: "#E64A8C",
    state: "ready",
    ...overrides,
  };
}

function question(overrides: Partial<Question> & Pick<Question, "id" | "categoryId">): Question {
  return {
    prompt: "Which salsa dance originated in New York City?",
    options: ["Salsa on 2", "Tango", "Foxtrot", "Waltz"],
    correctIndex: 0,
    pointValue: 100,
    imageUrl: null,
    factBlurb: null,
    playedAt: null,
    finishedAt: null,
    isPicked: true,
    ...overrides,
  };
}

function snapshot(overrides: Partial<TVSnapshot> = {}): TVSnapshot {
  return {
    night: {
      id: "night-1",
      venueName: "Soul Fire Pizza",
      themeKey: "july",
      hostDefaultThemeKey: "july",
      roomCode: "ABC123",
      openedAt: "2026-07-08T00:00:00Z",
      closedAt: null,
      scheduledAt: "2026-07-08T00:00:00Z",
      isLocked: false,
      roomMagicEnabled: false,
    },
    games: [],
    currentGameId: null,
    categories: [],
    questions: [],
    liveQuestionId: null,
    targetQuestionId: null,
    players: [],
    scores: [],
    liveAnswers: [],
    reveals: [],
    ...overrides,
  };
}

describe("HostLiveConsole public control strip", () => {
  it("uses stage-safe labels on the mirrored lobby controls", () => {
    render(
      <HostLiveConsole
        themeKey="house"
        tvSnapshot={snapshot({
          games: [game({ id: "g1", gameNo: 1, state: "draft" })],
          currentGameId: "g1",
        })}
        players={[]}
        playersTotal={0}
        onStartGame1={() => {}}
      />,
    );

    expect(screen.getByTestId("host-start-game-1-btn")).toHaveTextContent("Start round 1");
    expect(screen.queryByText("Start Game 1")).not.toBeInTheDocument();
    expect(screen.getByTestId("host-players-btn")).toHaveTextContent("Room (0)");
  });

  it("uses plain audience-safe action labels while a question is live", () => {
    const q = question({
      id: "q1",
      categoryId: "c1",
      playedAt: "2026-07-08T00:00:00Z",
    });
    render(
      <HostLiveConsole
        themeKey="house"
        tvSnapshot={snapshot({
          games: [game({ id: "g1", gameNo: 1, state: "live" })],
          currentGameId: "g1",
          categories: [category({ id: "c1", gameId: "g1" })],
          questions: [q],
          liveQuestionId: "q1",
        })}
        onEndEarly={() => {}}
      />,
    );

    expect(screen.getByTestId("host-end-early-btn")).toHaveTextContent("Show answer now");
    expect(screen.queryByText("End early · reveal")).not.toBeInTheDocument();
  });
});
