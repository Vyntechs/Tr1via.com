// Regression lock for deriveHostMode. The two bugs from session 6 — the
// inline TV panel layout (P0.32) and the missing end-of-game CTA (P0.33) —
// hinge on this function returning the right discriminant: it picks which
// controls the bottom strip surfaces and decides when the "End Game →"
// button is allowed to appear. Anything that drifts here would silently
// strand Heather mid-game again.

import { describe, expect, it } from "vitest";
import { deriveHostMode } from "@/lib/host/deriveHostMode";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";

type Game = TVSnapshot["games"][number];
type Category = TVSnapshot["categories"][number];
type Question = TVSnapshot["questions"][number];

function snapshot(overrides: Partial<TVSnapshot> = {}): TVSnapshot {
  return {
    night: {
      id: "night-1",
      venueName: "Test",
      themeKey: "house",
      roomCode: "ABCDEF",
      openedAt: "2026-05-24T00:00:00Z",
      closedAt: null,
      scheduledAt: null,
      isLocked: false,
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

function game(
  overrides: Partial<Game> & Pick<Game, "id" | "gameNo" | "state">,
): Game {
  return {
    startedAt: null,
    endedAt: null,
    categoryCount: 1,
    questionCount: 7,
    ...overrides,
  };
}

function category(
  overrides: Partial<Category> & Pick<Category, "id" | "gameId">,
): Category {
  return {
    name: "Test category",
    topic: "test",
    position: 1,
    color: null,
    state: "ready",
    ...overrides,
  };
}

function question(
  overrides: Partial<Question> & Pick<Question, "id" | "categoryId">,
): Question {
  return {
    prompt: "Q",
    options: ["a", "b", "c", "d"],
    correctIndex: 0,
    pointValue: 100,
    isPicked: true,
    playedAt: null,
    finishedAt: null,
    factBlurb: null,
    imageUrl: null,
    ...overrides,
  };
}

describe("deriveHostMode", () => {
  it("returns loading when no snapshot is provided", () => {
    expect(deriveHostMode(null).mode).toBe("loading");
    expect(deriveHostMode(undefined).mode).toBe("loading");
  });

  it("returns lobby when game 1 is in draft and no game has started", () => {
    const ctx = deriveHostMode(
      snapshot({
        games: [
          game({ id: "g1", gameNo: 1, state: "draft" }),
          game({ id: "g2", gameNo: 2, state: "draft" }),
        ],
        currentGameId: "g1",
      }),
    );
    expect(ctx.mode).toBe("lobby");
    expect(ctx.game1Id).toBe("g1");
    expect(ctx.game2Id).toBe("g2");
  });

  it("returns lobby when game 1 is ready (lock applied but not started)", () => {
    const ctx = deriveHostMode(
      snapshot({
        games: [game({ id: "g1", gameNo: 1, state: "ready" })],
        currentGameId: "g1",
      }),
    );
    expect(ctx.mode).toBe("lobby");
  });

  it("returns picking when game is live with no live question and no recent resolve", () => {
    const ctx = deriveHostMode(
      snapshot({
        games: [game({ id: "g1", gameNo: 1, state: "live" })],
        currentGameId: "g1",
        categories: [category({ id: "c1", gameId: "g1" })],
        questions: [
          question({ id: "q1", categoryId: "c1", finishedAt: null }),
        ],
      }),
    );
    expect(ctx.mode).toBe("picking");
    expect(ctx.canEndGame).toBe(false);
  });

  it("returns question-live when a question is mid-play", () => {
    const ctx = deriveHostMode(
      snapshot({
        games: [game({ id: "g1", gameNo: 1, state: "live" })],
        currentGameId: "g1",
        categories: [category({ id: "c1", gameId: "g1" })],
        questions: [
          question({
            id: "q1",
            categoryId: "c1",
            playedAt: "2026-05-24T00:00:00Z",
            finishedAt: null,
          }),
        ],
        liveQuestionId: "q1",
      }),
    );
    expect(ctx.mode).toBe("question-live");
  });

  it("returns reveal-sticky when a resolve event exists and host hasn't advanced", () => {
    const ctx = deriveHostMode(
      snapshot({
        games: [game({ id: "g1", gameNo: 1, state: "live" })],
        currentGameId: "g1",
        categories: [category({ id: "c1", gameId: "g1" })],
        questions: [
          question({
            id: "q1",
            categoryId: "c1",
            playedAt: "2026-05-24T00:00:00Z",
            finishedAt: "2026-05-24T00:00:30Z",
          }),
        ],
        targetQuestionId: "q1",
        reveals: [
          {
            id: "r1",
            gameId: "g1",
            questionId: "q1",
            event: "resolve",
            occurredAt: "2026-05-24T00:00:30Z",
            metadata: null,
          },
        ],
      }),
    );
    expect(ctx.mode).toBe("reveal-sticky");
  });

  it("falls back to picking when host has advanced past a sticky reveal", () => {
    const ctx = deriveHostMode(
      snapshot({
        games: [game({ id: "g1", gameNo: 1, state: "live" })],
        currentGameId: "g1",
        categories: [category({ id: "c1", gameId: "g1" })],
        questions: [
          question({
            id: "q1",
            categoryId: "c1",
            playedAt: "2026-05-24T00:00:00Z",
            finishedAt: "2026-05-24T00:00:30Z",
          }),
          question({ id: "q2", categoryId: "c1", finishedAt: null }),
        ],
        targetQuestionId: "q1",
        reveals: [
          {
            id: "r1",
            gameId: "g1",
            questionId: "q1",
            event: "resolve",
            occurredAt: "2026-05-24T00:00:30Z",
            metadata: null,
          },
        ],
      }),
      true, // hostAdvanced
    );
    expect(ctx.mode).toBe("picking");
  });

  // P0.33 — the regression. canEndGame must flip to true when every picked
  // question in the current game has finished_at set. The "End Game →" CTA
  // in HostControlStrip surfaces only when this flag is true; if the flag
  // never flips, Heather is stranded on an exhausted board.
  it("flags canEndGame when every picked question of the current game is finished", () => {
    const ctx = deriveHostMode(
      snapshot({
        games: [game({ id: "g1", gameNo: 1, state: "live" })],
        currentGameId: "g1",
        categories: [category({ id: "c1", gameId: "g1" })],
        questions: [
          question({
            id: "q1",
            categoryId: "c1",
            playedAt: "2026-05-24T00:00:00Z",
            finishedAt: "2026-05-24T00:00:30Z",
          }),
          question({
            id: "q2",
            categoryId: "c1",
            playedAt: "2026-05-24T00:01:00Z",
            finishedAt: "2026-05-24T00:01:30Z",
          }),
        ],
      }),
      true, // hostAdvanced — clears the reveal-sticky branch so we land in picking
    );
    expect(ctx.mode).toBe("picking");
    expect(ctx.canEndGame).toBe(true);
  });

  it("does not flag canEndGame when at least one picked question still pending", () => {
    const ctx = deriveHostMode(
      snapshot({
        games: [game({ id: "g1", gameNo: 1, state: "live" })],
        currentGameId: "g1",
        categories: [category({ id: "c1", gameId: "g1" })],
        questions: [
          question({
            id: "q1",
            categoryId: "c1",
            finishedAt: "2026-05-24T00:00:30Z",
          }),
          question({ id: "q2", categoryId: "c1", finishedAt: null }),
        ],
      }),
    );
    expect(ctx.mode).toBe("picking");
    expect(ctx.canEndGame).toBe(false);
  });

  it("only counts picked questions in the current game's categories", () => {
    // Game 1 has a finished picked question; game 2 (current) has none picked
    // yet → canEndGame must stay false even though game 1's slate is done.
    const ctx = deriveHostMode(
      snapshot({
        games: [
          game({ id: "g1", gameNo: 1, state: "live" }),
          game({ id: "g2", gameNo: 2, state: "live" }),
        ],
        currentGameId: "g2",
        categories: [
          category({ id: "c1", gameId: "g1" }),
          category({ id: "c2", gameId: "g2" }),
        ],
        questions: [
          question({
            id: "q1",
            categoryId: "c1",
            finishedAt: "2026-05-24T00:00:30Z",
          }),
          // Game 2 has zero picked rows.
        ],
      }),
    );
    expect(ctx.mode).toBe("picking");
    expect(ctx.canEndGame).toBe(false);
  });

  it("returns intermission when game 1 is done and game 2 is queued", () => {
    const ctx = deriveHostMode(
      snapshot({
        games: [
          game({ id: "g1", gameNo: 1, state: "done" }),
          game({ id: "g2", gameNo: 2, state: "draft" }),
        ],
        currentGameId: "g1",
      }),
    );
    expect(ctx.mode).toBe("intermission");
    expect(ctx.game2State).toBe("draft");
  });

  it("returns finale when the night is closed", () => {
    const ctx = deriveHostMode(
      snapshot({
        night: {
          id: "n1",
          venueName: "Test",
          themeKey: "house",
          roomCode: "ABCDEF",
          openedAt: "2026-05-24T00:00:00Z",
          closedAt: "2026-05-24T02:00:00Z",
          scheduledAt: null,
          isLocked: false,
        },
        games: [
          game({ id: "g1", gameNo: 1, state: "done" }),
          game({ id: "g2", gameNo: 2, state: "done" }),
        ],
        currentGameId: "g2",
      }),
    );
    expect(ctx.mode).toBe("finale");
  });

  it("returns finale when game 2 is done (last game complete)", () => {
    const ctx = deriveHostMode(
      snapshot({
        games: [
          game({ id: "g1", gameNo: 1, state: "done" }),
          game({ id: "g2", gameNo: 2, state: "done" }),
        ],
        currentGameId: "g2",
      }),
    );
    expect(ctx.mode).toBe("finale");
  });

  it("treats a single-game night as finale when game 1 finishes", () => {
    const ctx = deriveHostMode(
      snapshot({
        games: [game({ id: "g1", gameNo: 1, state: "done" })],
        currentGameId: "g1",
      }),
    );
    expect(ctx.mode).toBe("finale");
  });
});
