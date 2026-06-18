import { describe, it, expect } from "vitest";
import {
  lobbyTopicLabel,
  selectUpcomingGameId,
  selectLobbyTopics,
  selectLobbyTopicsFromRoom,
} from "@/lib/tv/lobbyTopics";
import type { TVSnapshot, TVGame, TVCategory } from "@/lib/hooks/useTVRoom";
import type { RoomSnapshot } from "@/lib/hooks/useRoom";
import type { GameRow, CategoryRow } from "@/lib/supabase/types";

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

// Regression: the lobby was rendering categories.topic (the long instruction a
// host gives the AI to generate questions) instead of the host's clean label
// categories.name. The display label is resolved once here in the selection
// core so the TV / player / host-mirror surfaces can't drift.
describe("lobbyTopicLabel", () => {
  it("shows the host's clean category name, not the AI generation instruction", () => {
    expect(
      lobbyTopicLabel("Pest", "Pest like mosquitoes and flies, also children in movies"),
    ).toBe("Pest");
  });
  it("falls back to the generation topic only when the name is blank", () => {
    expect(lobbyTopicLabel("", "fallback topic")).toBe("fallback topic");
    expect(lobbyTopicLabel("   ", "fallback topic")).toBe("fallback topic");
  });
  it("trims the clean name", () => {
    expect(lobbyTopicLabel("  Pest  ", "x")).toBe("Pest");
  });
});

describe("selectLobbyTopics — label regression", () => {
  it("uses the clean category name as the label, never the verbose generation topic", () => {
    const s = snap({
      games: [game("g1", 1, "ready")],
      currentGameId: "g1",
      categories: [
        cat(
          "c1", "g1", 0, "ready",
          "Pest like mosquitoes and flies, also children in movies",
          "Pest", null,
        ),
      ],
    });
    const topics = selectLobbyTopics(s);
    expect(topics).toHaveLength(1);
    expect(topics[0].label).toBe("Pest");
    expect(topics[0].topic).toBe(
      "Pest like mosquitoes and flies, also children in movies",
    );
  });
});

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
      { label: "Movies", name: "Movies", topic: "Disney Pixar Movies", color: "#E64A8C", position: 0 },
      { label: "Music", name: "Music", topic: "80s One-Hit Wonders", color: "#9B7BD8", position: 1 },
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

// ── Player surface (room snapshot, raw snake_case rows) ──────────────────
function rGame(id: string, gameNo: 1 | 2, state: GameRow["state"]): GameRow {
  return { id, game_no: gameNo, state, night_id: "n1", created_at: "" } as unknown as GameRow;
}
function rCat(
  id: string,
  gameId: string,
  position: number,
  state: CategoryRow["state"],
  topic: string,
  name = "Movies",
  color: string | null = "#E64A8C",
): CategoryRow {
  return { id, game_id: gameId, name, topic, position, color, state, created_at: "", flavor: null } as unknown as CategoryRow;
}
function rSnap(partial: Partial<RoomSnapshot>): RoomSnapshot {
  return {
    night: null, hostDefaultThemeKey: null, games: [], categories: [], players: [],
    currentGame: null, currentQuestion: null, lastResolvedQuestion: null,
    currentReveal: null, lastBroadcast: null, isLoading: false,
    ...partial,
  } as RoomSnapshot;
}

describe("selectLobbyTopicsFromRoom", () => {
  it("in the pre-game lobby (no currentGame) returns game 1's ready topics", () => {
    const s = rSnap({
      games: [rGame("g1", 1, "ready"), rGame("g2", 2, "draft")],
      currentGame: null,
      categories: [
        rCat("c2", "g1", 1, "ready", "80s One-Hit Wonders", "Music", "#9B7BD8"),
        rCat("c1", "g1", 0, "ready", "Disney Pixar Movies", "Movies", "#E64A8C"),
        rCat("c3", "g1", 2, "draft", "Not Ready Yet", "Food", null),
        rCat("c9", "g2", 0, "ready", "Other Game Topic", "Sports", "#5AA8E0"),
      ],
    });
    expect(selectLobbyTopicsFromRoom(s)).toEqual([
      { label: "Movies", name: "Movies", topic: "Disney Pixar Movies", color: "#E64A8C", position: 0 },
      { label: "Music", name: "Music", topic: "80s One-Hit Wonders", color: "#9B7BD8", position: 1 },
    ]);
  });

  it("between games (game 1 done, game 2 ready, current = the done game) returns game 2's ready topics", () => {
    // pickCurrentGame returns the most-recently-done game once none is live,
    // so during between-games currentGame is the done game 1; the selector must
    // still surface the UPCOMING game 2's ready topics for the preview.
    const g1 = rGame("g1", 1, "done");
    const s = rSnap({
      games: [g1, rGame("g2", 2, "ready")],
      currentGame: g1,
      categories: [
        rCat("c1", "g1", 0, "ready", "Old Game Topic", "Movies"),
        rCat("c2", "g2", 0, "ready", "Fresh Board Topic", "Sports", "#5AA8E0"),
        rCat("c3", "g2", 1, "draft", "Not Ready Yet", "Food", null),
      ],
    });
    expect(selectLobbyTopicsFromRoom(s)).toEqual([
      { label: "Sports", name: "Sports", topic: "Fresh Board Topic", color: "#5AA8E0", position: 0 },
    ]);
  });

  it("follows the live currentGame when one is set", () => {
    const g2 = rGame("g2", 2, "live");
    const s = rSnap({
      games: [rGame("g1", 1, "done"), g2],
      currentGame: g2,
      categories: [
        rCat("c1", "g1", 0, "ready", "Old Game", "Movies"),
        rCat("c2", "g2", 0, "ready", "Live Game Topic", "Sports", "#5AA8E0"),
      ],
    });
    expect(selectLobbyTopicsFromRoom(s)).toEqual([
      { label: "Sports", name: "Sports", topic: "Live Game Topic", color: "#5AA8E0", position: 0 },
    ]);
  });

  it("excludes not-ready categories and returns [] when none are ready", () => {
    const s = rSnap({
      games: [rGame("g1", 1, "ready")],
      categories: [
        rCat("c1", "g1", 0, "generating", "Gen"),
        rCat("c2", "g1", 1, "review", "Review", "Music"),
      ],
    });
    expect(selectLobbyTopicsFromRoom(s)).toEqual([]);
  });

  it("returns [] when there are no games", () => {
    expect(selectLobbyTopicsFromRoom(rSnap({}))).toEqual([]);
  });
});
