import { describe, expect, it } from "vitest";
import { deriveAllLockedAutoRevealDecision } from "@/lib/game/allLockedAutoReveal";

const activePlayerIds = ["p1", "p2", "p3"];
const scoreRows = [
  { player_id: "p1" },
  { player_id: "p2" },
  { player_id: "p3" },
];
const lockedAnswers = [
  { question_id: "q1", player_id: "p1" },
  { question_id: "q1", player_id: "p2" },
  { question_id: "q1", player_id: "p3" },
];

describe("deriveAllLockedAutoRevealDecision", () => {
  it("is incomplete without a current game", () => {
    expect(
      deriveAllLockedAutoRevealDecision({
        currentGameId: null,
        liveQuestionId: "q1",
        activePlayerIds,
        scoreRows,
        answers: lockedAnswers,
      }),
    ).toEqual({
      eligibleCount: 0,
      lockedCount: 0,
      complete: false,
      reason: "no_current_game",
    });
  });

  it("is incomplete without a live question", () => {
    expect(
      deriveAllLockedAutoRevealDecision({
        currentGameId: "g1",
        liveQuestionId: null,
        activePlayerIds,
        scoreRows,
        answers: lockedAnswers,
      }),
    ).toEqual({
      eligibleCount: 0,
      lockedCount: 0,
      complete: false,
      reason: "no_live_question",
    });
  });

  it("is incomplete when eligibility has not loaded", () => {
    expect(
      deriveAllLockedAutoRevealDecision({
        currentGameId: "g1",
        liveQuestionId: "q1",
        activePlayerIds,
        scoreRows: null,
        answers: lockedAnswers,
      }),
    ).toEqual({
      eligibleCount: 0,
      lockedCount: 0,
      complete: false,
      reason: "unknown_eligibility",
    });
  });

  it("is incomplete when there are zero eligible players", () => {
    expect(
      deriveAllLockedAutoRevealDecision({
        currentGameId: "g1",
        liveQuestionId: "q1",
        activePlayerIds: [],
        scoreRows: [],
        answers: [],
      }),
    ).toEqual({
      eligibleCount: 0,
      lockedCount: 0,
      complete: false,
      reason: "no_eligible_players",
    });
  });

  it("counts only answers for the live question", () => {
    expect(
      deriveAllLockedAutoRevealDecision({
        currentGameId: "g1",
        liveQuestionId: "q1",
        activePlayerIds,
        scoreRows,
        answers: [
          { question_id: "q1", player_id: "p1" },
          { question_id: "q-old", player_id: "p2" },
          { question_id: "q1", player_id: "p3" },
        ],
      }),
    ).toEqual({
      eligibleCount: 3,
      lockedCount: 2,
      complete: false,
      reason: "not_everyone_locked",
    });
  });

  it("deduplicates answer rows by player id defensively", () => {
    expect(
      deriveAllLockedAutoRevealDecision({
        currentGameId: "g1",
        liveQuestionId: "q1",
        activePlayerIds,
        scoreRows,
        answers: [
          { question_id: "q1", player_id: "p1" },
          { question_id: "q1", player_id: "p1" },
          { question_id: "q1", player_id: "p2" },
          { question_id: "q1", player_id: "p3" },
        ],
      }),
    ).toEqual({
      eligibleCount: 3,
      lockedCount: 3,
      complete: true,
    });
  });

  it("ignores removed players and non-participants", () => {
    expect(
      deriveAllLockedAutoRevealDecision({
        currentGameId: "g2",
        liveQuestionId: "q2",
        activePlayerIds: ["p1", "p2"],
        scoreRows: [
          { player_id: "p1" },
          { player_id: "p2" },
          { player_id: "late-game-one-only" },
          { player_id: null },
        ],
        answers: [
          { question_id: "q2", player_id: "p1" },
          { question_id: "q2", player_id: "p2" },
        ],
      }),
    ).toEqual({
      eligibleCount: 2,
      lockedCount: 2,
      complete: true,
    });
  });

  it("returns complete only when every eligible player locked this question", () => {
    expect(
      deriveAllLockedAutoRevealDecision({
        currentGameId: "g1",
        liveQuestionId: "q1",
        activePlayerIds,
        scoreRows,
        answers: lockedAnswers,
      }),
    ).toEqual({
      eligibleCount: 3,
      lockedCount: 3,
      complete: true,
    });
  });
});
