import { describe, it, expect } from "vitest";
import {
  buildGame1Standings,
  selectBetweenGamesView,
  isWaitingForGame2FirstQuestion,
  clearEndedGameQuestions,
} from "@/lib/player/betweenGames";
import type {
  GameScoreRow,
  GameRow,
  CategoryRow,
  QuestionRow,
} from "@/lib/supabase/types";

function score(player_id: string, display_name: string, score: number): GameScoreRow {
  return {
    game_id: "g1",
    player_id,
    display_name,
    score,
    correct_count: 0,
    answered_count: 0,
    fastest_correct_ms: null,
  } as GameScoreRow;
}

// Already sorted desc by score, the way the page queries it (.order score desc).
const SCORES: GameScoreRow[] = [
  score("a", "Alice", 12320),
  score("c", "Carol", 9160),
  score("y", "You", 8420),
  score("b", "Bob", 3080),
  score("d", "Dave", 2100),
  score("e", "Evan", 1500),
];

describe("buildGame1Standings", () => {
  it("returns the top N ranked, marking the player's row when in the top", () => {
    const { top, you } = buildGame1Standings(SCORES, "y", 5);
    expect(top.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(top.map((r) => r.name)).toEqual(["Alice", "Carol", "You", "Bob", "Dave"]);
    expect(top.find((r) => r.isYou)?.name).toBe("You");
    expect(you).toBeNull(); // player is inside the top → no pinned row
  });

  it("pins the player's own row when they rank below the cutoff", () => {
    const { top, you } = buildGame1Standings(SCORES, "e", 5);
    expect(top.some((r) => r.isYou)).toBe(false);
    expect(you).toEqual({ rank: 6, name: "Evan", score: 1500, isYou: true });
  });

  it("returns you=null when the player has no score row", () => {
    const { top, you } = buildGame1Standings(SCORES, "ghost", 5);
    expect(top.some((r) => r.isYou)).toBe(false);
    expect(you).toBeNull();
  });

  it("handles fewer players than the limit", () => {
    const { top, you } = buildGame1Standings(SCORES.slice(0, 3), "y", 5);
    expect(top.map((r) => r.name)).toEqual(["Alice", "Carol", "You"]);
    expect(you).toBeNull();
  });
});

describe("selectBetweenGamesView", () => {
  const base = { game1State: "done", game2State: "ready", inGame2: false };

  it("returns 'join' when game 1 is done, game 2 not started, and player hasn't joined", () => {
    expect(selectBetweenGamesView(base)).toBe("join");
  });

  it("returns 'waiting' once the player has joined and game 2 is still draft/ready", () => {
    expect(selectBetweenGamesView({ ...base, inGame2: true })).toBe("waiting");
    expect(selectBetweenGamesView({ ...base, game2State: "draft", inGame2: true })).toBe("waiting");
  });

  it("returns null once game 2 goes live (the question flow takes over)", () => {
    expect(selectBetweenGamesView({ ...base, game2State: "live", inGame2: true })).toBeNull();
  });

  it("returns null when game 2 is done (night over) or game 1 isn't done yet", () => {
    expect(selectBetweenGamesView({ ...base, game2State: "done", inGame2: true })).toBeNull();
    expect(selectBetweenGamesView({ ...base, game1State: "live" })).toBeNull();
  });

  it("returns null when there is no game 2", () => {
    expect(selectBetweenGamesView({ game1State: "done", game2State: null, inGame2: false })).toBeNull();
  });
});

describe("isWaitingForGame2FirstQuestion", () => {
  const base = {
    game1State: "done",
    game2State: "live",
    inGame2: true,
    game2Id: "g2",
    currentQuestionGameId: null,
  };

  it("holds the waiting screen after Game 2 starts but before its first question", () => {
    expect(isWaitingForGame2FirstQuestion(base)).toBe(true);
  });

  it("overrides a stale Game 1 question instead of showing its old reveal", () => {
    expect(
      isWaitingForGame2FirstQuestion({ ...base, currentQuestionGameId: "g1" }),
    ).toBe(true);
  });

  it("hands control to the question flow once Game 2 has a question", () => {
    expect(
      isWaitingForGame2FirstQuestion({ ...base, currentQuestionGameId: "g2" }),
    ).toBe(false);
  });
});

const games = [
  { id: "g1", state: "done" },
  { id: "g2", state: "live" },
] as GameRow[];
const categories = [
  { id: "c1", game_id: "g1" },
  { id: "c2", game_id: "g2" },
] as CategoryRow[];
const q = (id: string, category_id: string) => ({ id, category_id }) as QuestionRow;

describe("clearEndedGameQuestions", () => {
  it("clears a question whose game is now done", () => {
    const out = clearEndedGameQuestions({
      games, categories,
      currentQuestion: null,
      lastResolvedQuestion: q("q1", "c1"), // belongs to done g1
    });
    expect(out.lastResolvedQuestion).toBeNull();
  });

  it("keeps a question whose game is still live", () => {
    const lrq = q("q2", "c2"); // belongs to live g2
    const out = clearEndedGameQuestions({
      games, categories, currentQuestion: null, lastResolvedQuestion: lrq,
    });
    expect(out.lastResolvedQuestion).toBe(lrq);
  });

  it("clears currentQuestion too when its game is done", () => {
    const out = clearEndedGameQuestions({
      games, categories,
      currentQuestion: q("q1", "c1"),
      lastResolvedQuestion: null,
    });
    expect(out.currentQuestion).toBeNull();
  });

  it("keeps a question when its category isn't known (can't determine the game)", () => {
    const orphan = q("q9", "cX");
    const out = clearEndedGameQuestions({
      games, categories, currentQuestion: null, lastResolvedQuestion: orphan,
    });
    expect(out.lastResolvedQuestion).toBe(orphan);
  });
});
