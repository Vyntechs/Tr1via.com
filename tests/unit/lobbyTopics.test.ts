import { describe, it, expect } from "vitest";
import { selectUpcomingGameId, selectLobbyTopics } from "@/lib/tv/lobbyTopics";
import type { TVSnapshot, TVGame, TVCategory } from "@/lib/hooks/useTVRoom";

function game(id: string, gameNo: 1 | 2, state: TVGame["state"]): TVGame {
  return { id, gameNo, state, startedAt: null, endedAt: null, categoryCount: 0, questionCount: 0 };
}
function cat(
  id: string,
  gameId: string,
  position: number,
  state: TVCategory["state"],
  topic: string,
  name = "Movies",
  color: string | null = "#E64A8C",
): TVCategory {
  return { id, gameId, name, topic, position, color, state };
}
function snap(partial: Partial<TVSnapshot>): TVSnapshot {
  return {
    night: {
      id: "n1", venueName: "V", themeKey: null, hostDefaultThemeKey: null,
      roomCode: "ABCD", openedAt: null, closedAt: null, scheduledAt: null, isLocked: false,
    },
    games: [], currentGameId: null, categories: [], questions: [],
    liveQuestionId: null, targetQuestionId: null,
    players: [], scores: [], liveAnswers: [], reveals: [],
    ...partial,
  };
}

describe("selectUpcomingGameId", () => {
  it("returns the current game when it's set and not done", () => {
    const s = snap({ games: [game("g1", 1, "done"), game("g2", 2, "ready")], currentGameId: "g2" });
    expect(selectUpcomingGameId(s)).toBe("g2");
  });

  it("falls back to the first not-done game (by number) when there's no current game", () => {
    const s = snap({ games: [game("g1", 1, "draft"), game("g2", 2, "draft")], currentGameId: null });
    expect(selectUpcomingGameId(s)).toBe("g1");
  });

  it("skips a done current game and returns the next not-done game", () => {
    const s = snap({ games: [game("g1", 1, "done"), game("g2", 2, "ready")], currentGameId: "g1" });
    expect(selectUpcomingGameId(s)).toBe("g2");
  });

  it("returns null when every game is done", () => {
    const s = snap({ games: [game("g1", 1, "done"), game("g2", 2, "done")], currentGameId: "g2" });
    expect(selectUpcomingGameId(s)).toBeNull();
  });

  it("returns null when there are no games", () => {
    expect(selectUpcomingGameId(snap({}))).toBeNull();
  });
});

describe("selectLobbyTopics", () => {
  const games = [game("g1", 1, "ready"), game("g2", 2, "draft")];

  it("returns only the upcoming game's READY categories, ordered by position, mapped", () => {
    const s = snap({
      games, currentGameId: "g1",
      categories: [
        cat("c2", "g1", 1, "ready", "80s One-Hit Wonders", "Music", "#9B7BD8"),
        cat("c1", "g1", 0, "ready", "Disney Pixar Movies", "Movies", "#E64A8C"),
        cat("c3", "g1", 2, "draft", "Not Ready Yet", "Food", null),
        cat("c9", "g2", 0, "ready", "Other Game Topic", "Sports", "#5AA8E0"),
      ],
    });
    expect(selectLobbyTopics(s)).toEqual([
      { name: "Movies", topic: "Disney Pixar Movies", color: "#E64A8C", position: 0 },
      { name: "Music", topic: "80s One-Hit Wonders", color: "#9B7BD8", position: 1 },
    ]);
  });

  it("excludes draft/generating/review categories", () => {
    const s = snap({
      games, currentGameId: "g1",
      categories: [
        cat("c1", "g1", 0, "generating", "Gen", "Movies"),
        cat("c2", "g1", 1, "review", "Review", "Music"),
        cat("c3", "g1", 2, "draft", "Draft", "Food"),
      ],
    });
    expect(selectLobbyTopics(s)).toEqual([]);
  });

  it("returns [] when there's no upcoming game", () => {
    const s = snap({ games: [game("g1", 1, "done")], currentGameId: "g1",
      categories: [cat("c1", "g1", 0, "ready", "Topic")] });
    expect(selectLobbyTopics(s)).toEqual([]);
  });

  it("preserves a null color (the component fills it in at render)", () => {
    const s = snap({ games, currentGameId: "g1",
      categories: [cat("c1", "g1", 0, "ready", "Mystery", "Unknownland", null)] });
    expect(selectLobbyTopics(s)[0].color).toBeNull();
  });
});
