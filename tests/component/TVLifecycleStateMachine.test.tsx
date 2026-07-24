import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TVStateMachine } from "@/components/tv/TVStateMachine";
import { ThemeProvider } from "@/components/system";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";

function lifecycleSnapshot(overrides: Partial<TVSnapshot> = {}): TVSnapshot {
  return {
    night: {
      id: "night-key",
      venueName: "The Venue",
      themeKey: "april",
      hostDefaultThemeKey: "house",
      roomCode: "ABC123",
      openedAt: "2026-07-20T00:00:00Z",
      closedAt: null,
      scheduledAt: null,
      isLocked: false,
      roomMagicEnabled: false,
    },
    games: [
      { id: "g1", gameNo: 1, state: "done", startedAt: "2026-07-20T00:00:00Z", endedAt: "2026-07-20T01:00:00Z", categoryCount: 1, questionCount: 1 },
      { id: "g2", gameNo: 2, state: "live", startedAt: "2026-07-20T01:05:00Z", endedAt: null, categoryCount: 1, questionCount: 1 },
    ],
    currentGameId: "g2",
    categories: [
      { id: "c1", gameId: "g1", name: "History", topic: "History", position: 0, color: null, state: "ready" },
      { id: "c2", gameId: "g2", name: "Music", topic: "Music", position: 0, color: null, state: "ready" },
    ],
    questions: [
      {
        id: "q1",
        categoryId: "c1",
        pointValue: 100,
        prompt: "Old Game 1 question",
        options: ["Old answer", "B", "C", "D"],
        correctIndex: 0,
        imageUrl: null,
        factBlurb: "Old Game 1 fact",
        playedAt: "2026-07-20T00:30:00Z",
        finishedAt: "2026-07-20T00:31:00Z",
        isPicked: true,
      },
      {
        id: "q2",
        categoryId: "c2",
        pointValue: 100,
        prompt: "Game 2 question",
        options: ["A", "B", "C", "D"],
        correctIndex: null,
        imageUrl: null,
        factBlurb: null,
        playedAt: null,
        finishedAt: null,
        isPicked: true,
      },
    ],
    liveQuestionId: null,
    targetQuestionId: "q1",
    players: [],
    scores: [{ player_key: "pk1", display_name: "Jordan", score: 6100, correct_count: 1, answered_count: 1, fastest_correct_ms: 1200 }],
    liveAnswers: [],
    reveals: [{ id: "r1", gameId: "g1", questionId: "q1", event: "resolve", occurredAt: "2026-07-20T00:31:00Z", metadata: null }],
    ...overrides,
  };
}

describe("TVStateMachine lifecycle boundaries", () => {
  it("uses a finished current-game target as sticky reveal evidence", () => {
    const current = lifecycleSnapshot({
      games: [
        { id: "g1", gameNo: 1, state: "live", startedAt: "2026-07-20T00:00:00Z", endedAt: null, categoryCount: 1, questionCount: 1 },
      ],
      currentGameId: "g1",
      targetQuestionId: "q1",
      categories: [
        { id: "c1", gameId: "g1", name: "History", topic: "History", position: 0, color: null, state: "ready" },
      ],
      questions: [lifecycleSnapshot().questions[0]!],
      reveals: [],
    });

    render(
      <ThemeProvider themeKey="april">
        <TVStateMachine snapshot={current} themeKey="april" />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("tv-reveal")).toBeVisible();
  });

  it("keeps the just-resolved answer visible when the live pointer clears", () => {
    const current = lifecycleSnapshot({
      games: [
        { id: "g1", gameNo: 1, state: "live", startedAt: "2026-07-20T00:00:00Z", endedAt: null, categoryCount: 1, questionCount: 1 },
      ],
      currentGameId: "g1",
      targetQuestionId: null,
      categories: [
        { id: "c1", gameId: "g1", name: "History", topic: "History", position: 0, color: null, state: "ready" },
      ],
      questions: [lifecycleSnapshot().questions[0]!],
      reveals: [{ id: "r1", gameId: "g1", questionId: "q1", event: "resolve", occurredAt: "2026-07-20T00:31:00Z", metadata: null }],
    });

    render(
      <ThemeProvider themeKey="april">
        <TVStateMachine snapshot={current} themeKey="april" />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("tv-reveal")).toBeVisible();
  });

  it("shows the shared standings board after the host advances a resolved question", () => {
    const current = lifecycleSnapshot({
      games: [
        { id: "g1", gameNo: 1, state: "live", startedAt: "2026-07-20T00:00:00Z", endedAt: null, categoryCount: 1, questionCount: 1 },
      ],
      currentGameId: "g1",
      targetQuestionId: "q1",
      categories: [
        { id: "c1", gameId: "g1", name: "History", topic: "History", position: 0, color: null, state: "ready" },
      ],
      questions: [lifecycleSnapshot().questions[0]!],
      reveals: [
        { id: "a1", gameId: "g1", questionId: "q1", event: "advance", occurredAt: "2026-07-20T00:32:00Z", metadata: null },
        { id: "r1", gameId: "g1", questionId: "q1", event: "resolve", occurredAt: "2026-07-20T00:31:00Z", metadata: null },
      ],
    });

    render(
      <ThemeProvider themeKey="april">
        <TVStateMachine snapshot={current} themeKey="april" />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("tv-grid")).toBeVisible();
    expect(screen.getByText("Jordan")).toBeVisible();
    expect(screen.getByText("6,100")).toBeVisible();
    expect(screen.queryByTestId("tv-reveal")).not.toBeInTheDocument();
  });

  it("recovers the shared standings board from a durable advance without a legacy resolve row", () => {
    const resolvedQuestion = {
      ...lifecycleSnapshot().questions[0]!,
      finishedAt: "2026-07-20T00:31:00Z",
    };
    const current = lifecycleSnapshot({
      games: [
        { id: "g1", gameNo: 1, state: "live", startedAt: "2026-07-20T00:00:00Z", endedAt: null, categoryCount: 1, questionCount: 1 },
      ],
      currentGameId: "g1",
      targetQuestionId: "q1",
      categories: [
        { id: "c1", gameId: "g1", name: "History", topic: "History", position: 0, color: null, state: "ready" },
      ],
      questions: [resolvedQuestion],
      reveals: [
        { id: "a1", gameId: "g1", questionId: "q1", event: "advance", occurredAt: "2026-07-20T00:32:00Z", metadata: null },
      ],
    });

    render(
      <ThemeProvider themeKey="april">
        <TVStateMachine snapshot={current} themeKey="april" />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("tv-grid")).toBeVisible();
    expect(screen.queryByTestId("tv-reveal")).not.toBeInTheDocument();
  });

  it("labels the live Game 2 first-question gap honestly instead of promising a future launch", () => {
    render(
      <ThemeProvider themeKey="april">
        <TVStateMachine snapshot={lifecycleSnapshot()} themeKey="april" />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("tv-intermission")).toBeVisible();
    expect(screen.getByText("GAME 2 STARTED · FIRST QUESTION NEXT")).toBeVisible();
    expect(screen.getByText("FIRST QUESTION APPEARS WHEN THE HOST CHOOSES IT")).toBeVisible();
    expect(screen.queryByText("GAME 2 LAUNCHES WHEN HOST SAYS GO")).not.toBeInTheDocument();
    expect(screen.queryByText("GAME 2 STARTS WHEN THE HOST IS READY")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tv-reveal")).not.toBeInTheDocument();
    expect(screen.queryByText("Old answer")).not.toBeInTheDocument();
  });

  it("keeps the ready Game 2 state distinct from a started game", () => {
    const ready = lifecycleSnapshot({
      games: lifecycleSnapshot().games.map((game) =>
        game.id === "g2"
          ? { ...game, state: "ready", startedAt: null }
          : game,
      ),
    });

    render(
      <ThemeProvider themeKey="april">
        <TVStateMachine snapshot={ready} themeKey="april" />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("tv-intermission")).toBeVisible();
    expect(screen.getByText("GAME 2 · READY")).toBeVisible();
    expect(screen.getByText("GAME 2 STARTS WHEN THE HOST IS READY")).toBeVisible();
    expect(screen.queryByText("GAME 2 STARTED · FIRST QUESTION NEXT")).not.toBeInTheDocument();
  });

  it("shows the venue finale only after the final game is durably done", () => {
    const live = lifecycleSnapshot();
    const view = render(
      <ThemeProvider themeKey="house">
        <TVStateMachine snapshot={live} themeKey="house" />
      </ThemeProvider>,
    );
    expect(screen.queryByTestId("tv-finale-winner")).not.toBeInTheDocument();

    const done = lifecycleSnapshot({
      games: live.games.map((game) => game.id === "g2" ? { ...game, state: "done", endedAt: "2026-07-20T02:00:00Z" } : game),
      scores: [{ player_key: "pk2", display_name: "Morgan", score: 7200, correct_count: 1, answered_count: 1, fastest_correct_ms: 900 }],
    });
    view.rerender(
      <ThemeProvider themeKey="house">
        <TVStateMachine snapshot={done} themeKey="house" />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("tv-finale-winner")).toBeVisible();
    expect(screen.getByText("Morgan.")).toBeVisible();
  });
});
