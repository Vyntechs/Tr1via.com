import { describe, expect, it } from "vitest";
import { deriveHostStage } from "@/lib/host/gameConsole";

describe("deriveHostStage", () => {
  it("uses game-ready before game 1 starts", () => {
    expect(
      deriveHostStage({
        game1: "ready",
        game2: "ready",
        currentGame: 1,
        livePlay: null,
        lastResolve: null,
        nightClosed: false,
      }),
    ).toEqual({ stage: "game-ready", primary: "start-game-1" });
  });

  it("never reuses a prior game's reveal during intermission", () => {
    expect(
      deriveHostStage({
        game1: "done",
        game2: "ready",
        currentGame: 1,
        livePlay: null,
        lastResolve: { id: "q21", game: 1 },
        nightClosed: false,
      }),
    ).toEqual({ stage: "intermission", primary: "start-game-2" });
  });

  it("uses answer-result only for a resolve from the current live game", () => {
    expect(
      deriveHostStage({
        game1: "done",
        game2: "live",
        currentGame: 2,
        livePlay: null,
        lastResolve: { id: "q7", game: 2 },
        nightClosed: false,
      }),
    ).toEqual({ stage: "answer-result", primary: "return-to-board" });
  });

  it("returns to the board when a live game only has a prior game's resolve", () => {
    expect(
      deriveHostStage({
        game1: "done",
        game2: "live",
        currentGame: 2,
        livePlay: null,
        lastResolve: { id: "q21", game: 1 },
        nightClosed: false,
      }),
    ).toEqual({ stage: "board", primary: null });
  });

  it("fails closed when a live game receives an unowned legacy resolve", () => {
    const malformedLegacyInput = {
      game1: "done",
      game2: "live",
      currentGame: 2,
      livePlay: null,
      lastResolve: { id: "q21" },
      nightClosed: false,
    } as unknown as Parameters<typeof deriveHostStage>[0];

    expect(deriveHostStage(malformedLegacyInput)).toEqual({
      stage: "board",
      primary: null,
    });
  });

  it("prioritizes a staged question over a prior result in the current game", () => {
    expect(
      deriveHostStage({
        game1: "live",
        game2: "ready",
        currentGame: 1,
        livePlay: null,
        lastResolve: { id: "q7", game: 1 },
        stagedQuestion: "q8",
        nightClosed: false,
      }),
    ).toEqual({ stage: "private-preview", primary: "show-question" });
  });

  it("keeps the live question ahead of a staged question", () => {
    expect(
      deriveHostStage({
        game1: "live",
        game2: "ready",
        currentGame: 1,
        livePlay: "q8",
        lastResolve: null,
        stagedQuestion: "q8",
        nightClosed: false,
      }),
    ).toEqual({ stage: "question-live", primary: "end-early" });
  });

  it("offers Present winners only after the final live game has no questions left", () => {
    expect(
      deriveHostStage({
        game1: "done",
        game2: "live",
        currentGame: 2,
        livePlay: null,
        lastResolve: null,
        nightClosed: false,
        finalGameExhausted: true,
      }),
    ).toEqual({ stage: "finale", primary: "present-winners" });
  });

  it("uses durable final-game completion to separate End game from the closed state", () => {
    expect(
      deriveHostStage({
        game1: "done",
        game2: "done",
        currentGame: 2,
        livePlay: null,
        lastResolve: { id: "q42", game: 2 },
        nightClosed: false,
      }),
    ).toEqual({ stage: "finale", primary: "end-game" });

    expect(
      deriveHostStage({
        game1: "done",
        game2: "done",
        currentGame: 2,
        livePlay: null,
        lastResolve: { id: "q42", game: 2 },
        nightClosed: true,
      }),
    ).toEqual({ stage: "finale", primary: null });
  });
});
