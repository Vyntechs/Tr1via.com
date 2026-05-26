// Regression lock for deriveHostMode. The two bugs from session 6 — the
// inline TV panel layout (P0.32) and the missing end-of-game CTA (P0.33) —
// hinge on this function returning the right discriminant: it picks which
// controls the bottom strip surfaces and decides when the "End Game →"
// button is allowed to appear. Anything that drifts here would silently
// strand Heather mid-game again.

import { describe, expect, it } from "vitest";
import { deriveHostMode, getRemainingTopics } from "@/lib/host/deriveHostMode";
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
      hostDefaultThemeKey: "daylight",
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
          hostDefaultThemeKey: "daylight",
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

  // After PR-section-end-cinematic: the section-end "Pick the next topic"
  // surface is gone. The grid is the canonical picker for the entire game,
  // and the cinematic moment lives in a separate overlay driven by
  // useSectionCompleteCelebration. deriveHostMode only needs to confirm
  // we're in `picking` mode (and that canEndGame still flips correctly
  // when every category is exhausted — covered above).
  it("stays in plain picking mode when one category is exhausted but others remain", () => {
    const ctx = deriveHostMode(
      snapshot({
        games: [game({ id: "g1", gameNo: 1, state: "live" })],
        currentGameId: "g1",
        categories: [
          category({ id: "c1", gameId: "g1" }),
          category({ id: "c2", gameId: "g1" }),
        ],
        questions: [
          // c1 fully done
          question({
            id: "q1",
            categoryId: "c1",
            finishedAt: "2026-05-24T00:00:30Z",
          }),
          // c2 still has unplayed
          question({ id: "q2", categoryId: "c2", finishedAt: null }),
        ],
      }),
      true, // hostAdvanced — skip reveal-sticky so we land in picking
    );
    expect(ctx.mode).toBe("picking");
    expect(ctx.canEndGame).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// getRemainingTopics — pure helper. Still exported because
// useSectionCompleteCelebration uses similar per-category logic and other
// future surfaces may want a "what's left in each topic" list.
// ─────────────────────────────────────────────────────────────────────────

describe("getRemainingTopics", () => {
  it("returns empty when game id is null", () => {
    expect(getRemainingTopics({ categories: [], questions: [] }, null)).toEqual([]);
  });

  it("skips categories whose every picked question is played", () => {
    const out = getRemainingTopics(
      {
        categories: [
          category({ id: "c1", gameId: "g1", position: 1, name: "Geography" }),
          category({ id: "c2", gameId: "g1", position: 2, name: "Music" }),
        ],
        questions: [
          question({
            id: "q1",
            categoryId: "c1",
            finishedAt: "2026-05-24T00:00:30Z",
          }),
          question({ id: "q2", categoryId: "c2", finishedAt: null }),
        ],
      },
      "g1",
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.categoryId).toBe("c2");
    expect(out[0]?.name).toBe("Music");
  });

  it("picks the lowest-points UNPLAYED question per category", () => {
    const out = getRemainingTopics(
      {
        categories: [category({ id: "c1", gameId: "g1", name: "Geography" })],
        questions: [
          // 100 is finished, 200 is the lowest unplayed, 300/400 also unplayed
          question({
            id: "q-100",
            categoryId: "c1",
            pointValue: 100,
            finishedAt: "2026-05-24T00:00:30Z",
          }),
          question({ id: "q-300", categoryId: "c1", pointValue: 300, finishedAt: null }),
          question({ id: "q-200", categoryId: "c1", pointValue: 200, finishedAt: null }),
          question({ id: "q-400", categoryId: "c1", pointValue: 400, finishedAt: null }),
        ],
      },
      "g1",
    );
    expect(out[0]?.lowestQuestionId).toBe("q-200");
    expect(out[0]?.remainingCount).toBe(3);
    expect(out[0]?.totalCount).toBe(4);
  });

  it("sorts results by category position", () => {
    const out = getRemainingTopics(
      {
        categories: [
          category({ id: "c-late", gameId: "g1", position: 3, name: "Late" }),
          category({ id: "c-early", gameId: "g1", position: 1, name: "Early" }),
          category({ id: "c-mid", gameId: "g1", position: 2, name: "Mid" }),
        ],
        questions: [
          question({ id: "qa", categoryId: "c-late", finishedAt: null }),
          question({ id: "qb", categoryId: "c-early", finishedAt: null }),
          question({ id: "qc", categoryId: "c-mid", finishedAt: null }),
        ],
      },
      "g1",
    );
    expect(out.map((r) => r.name)).toEqual(["Early", "Mid", "Late"]);
  });

  it("ignores categories that belong to OTHER games", () => {
    const out = getRemainingTopics(
      {
        categories: [
          category({ id: "c1", gameId: "g1" }),
          category({ id: "c2", gameId: "g2" }),
        ],
        questions: [
          question({ id: "q1", categoryId: "c1", finishedAt: null }),
          question({ id: "q2", categoryId: "c2", finishedAt: null }),
        ],
      },
      "g1",
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.categoryId).toBe("c1");
  });
});
