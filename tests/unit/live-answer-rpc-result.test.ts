import { describe, expect, it } from "vitest";

import {
  freshLiveEventFromRpc,
  parseLiveAnswerRpcEnvelope,
  parseLiveCommandRpcEnvelope,
  parseLiveFinalizeRpcEnvelope,
} from "@/lib/live-answer/rpcResult";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const GAME_ID = "22222222-2222-4222-8222-222222222222";
const PLAY_ID = "33333333-3333-4333-8333-333333333333";

const commandWinner = {
  code: "applied",
  applied: true,
  eventKind: "play_opened",
  runId: RUN_ID,
  gameId: GAME_ID,
  playId: PLAY_ID,
  roomRevision: 8,
  controlRevision: 5,
} as const;

describe("live RPC result validation", () => {
  it("maps only a database-declared command winner to a transaction-winner event", () => {
    const parsed = parseLiveCommandRpcEnvelope({
      freshlyApplied: true,
      result: commandWinner,
    });

    expect(parsed).toMatchObject({
      freshlyApplied: true,
      freshness: "transaction_winner",
      result: commandWinner,
    });
    expect(freshLiveEventFromRpc(parsed)).toEqual({
      applied: true,
      freshness: "transaction_winner",
      kind: "play_opened",
      runId: RUN_ID,
      roomRevision: 8,
      controlRevision: 5,
      playId: PLAY_ID,
    });
  });

  it("parses an exact command replay but never turns it into a fresh event", () => {
    const parsed = parseLiveCommandRpcEnvelope({
      freshlyApplied: false,
      result: commandWinner,
    });

    expect(parsed?.freshness).toBe("replay");
    expect(freshLiveEventFromRpc(parsed)).toBeNull();
  });

  it("fails closed for missing, malformed, extra, or contradictory envelope data", () => {
    expect(parseLiveCommandRpcEnvelope({ result: commandWinner })).toBeNull();
    expect(
      parseLiveCommandRpcEnvelope({ freshlyApplied: true }),
    ).toBeNull();
    expect(
      parseLiveCommandRpcEnvelope({
        freshlyApplied: "true",
        result: commandWinner,
      }),
    ).toBeNull();
    expect(
      parseLiveCommandRpcEnvelope({
        freshlyApplied: true,
        result: { ...commandWinner, playerId: "identity-leak" },
      }),
    ).toBeNull();
    expect(
      parseLiveCommandRpcEnvelope({
        freshlyApplied: true,
        result: { code: "stale", applied: false },
      }),
    ).toBeNull();
    expect(freshLiveEventFromRpc(null)).toBeNull();
  });

  it("requires the exact ancestry fields for each canonical command event", () => {
    const playWithoutGame: Record<string, unknown> = { ...commandWinner };
    delete playWithoutGame.gameId;
    expect(
      parseLiveCommandRpcEnvelope({
        freshlyApplied: true,
        result: playWithoutGame,
      }),
    ).toBeNull();
    expect(
      parseLiveCommandRpcEnvelope({
        freshlyApplied: true,
        result: {
          code: "applied",
          applied: true,
          eventKind: "night_opened",
          runId: RUN_ID,
          gameId: GAME_ID,
          roomRevision: 1,
          controlRevision: 1,
        },
      }),
    ).toBeNull();
    expect(
      parseLiveCommandRpcEnvelope({
        freshlyApplied: true,
        result: {
          code: "applied",
          applied: true,
          eventKind: "night_reset",
          runId: RUN_ID,
          roomRevision: 0,
          controlRevision: 0,
        },
      }),
    ).toBeNull();
  });

  it("parses canonical answer results without trusting answer identity or choice fields", () => {
    const winner = parseLiveAnswerRpcEnvelope({
      freshlyApplied: true,
      result: {
        code: "confirmed",
        confirmedSlot: 3,
        duplicate: false,
        eventKind: "answer_progress",
        runId: RUN_ID,
        playId: PLAY_ID,
        roomRevision: 9,
        controlRevision: 5,
      },
    });
    const retry = parseLiveAnswerRpcEnvelope({
      freshlyApplied: false,
      result: { code: "retry_later", retryAfterMs: 100 },
    });

    expect(freshLiveEventFromRpc(winner)).toEqual({
      applied: true,
      freshness: "transaction_winner",
      kind: "answer_progress",
      runId: RUN_ID,
      roomRevision: 9,
      controlRevision: 5,
      playId: PLAY_ID,
    });
    expect(retry?.result).toEqual({ code: "retry_later", retryAfterMs: 100 });
    expect(retry?.freshness).toBe("non_winner");
    expect(freshLiveEventFromRpc(retry)).toBeNull();
    expect(
      parseLiveAnswerRpcEnvelope({
        freshlyApplied: true,
        result: {
          code: "confirmed",
          confirmedSlot: 3,
          duplicate: false,
          eventKind: "answer_progress",
          runId: RUN_ID,
          playId: PLAY_ID,
          roomRevision: 9,
          controlRevision: 5,
          playerId: "identity-leak",
        },
      }),
    ).toBeNull();
  });

  it("discriminates finalize transitions and rejects event/result mismatches", () => {
    const finalWindow = parseLiveFinalizeRpcEnvelope({
      freshlyApplied: true,
      result: {
        code: "final_window",
        applied: true,
        eventKind: "final_window_started",
        runId: RUN_ID,
        playId: PLAY_ID,
        roomRevision: 10,
        controlRevision: 6,
      },
    });
    const notDue = parseLiveFinalizeRpcEnvelope({
      freshlyApplied: false,
      result: {
        code: "not_due",
        applied: false,
        runId: RUN_ID,
        playId: PLAY_ID,
        roomRevision: 10,
        controlRevision: 6,
      },
    });

    expect(freshLiveEventFromRpc(finalWindow)?.kind).toBe(
      "final_window_started",
    );
    expect(freshLiveEventFromRpc(notDue)).toBeNull();
    expect(notDue?.freshness).toBe("non_winner");
    expect(
      parseLiveFinalizeRpcEnvelope({
        freshlyApplied: true,
        result: {
          code: "resolved",
          applied: true,
          eventKind: "final_window_started",
          runId: RUN_ID,
          playId: PLAY_ID,
          roomRevision: 11,
          controlRevision: 7,
        },
      }),
    ).toBeNull();
  });
});
