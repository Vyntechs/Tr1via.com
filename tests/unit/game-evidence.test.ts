import { describe, expect, test, vi } from "vitest";

import {
  createGameEvidenceEvent,
  deadlineDeltaBucketFor,
  recordGameEvidence,
  timingBucketFor,
} from "@/lib/observability/gameEvidence";

const NIGHT_ID = "10000000-0000-4000-8000-000000000001";
const GAME_ID = "20000000-0000-4000-8000-000000000002";
const QUESTION_ID = "30000000-0000-4000-8000-000000000003";
const PLAY_ID = "40000000-0000-4000-8000-000000000004";

describe("game evidence telemetry", () => {
  test("constructs a frozen event from only the explicit allowlist", () => {
    const event = createGameEvidenceEvent({
      event: "game_question_finalize",
      engine: "legacy",
      nightId: NIGHT_ID,
      gameId: GAME_ID,
      questionId: QUESTION_ID,
      playId: PLAY_ID,
      trigger: "timer",
      outcome: "resolved",
      deadlineAt: "2026-09-16T00:13:37.434Z",
      resolvedAt: "2026-09-16T00:13:42.528Z",
      deadlineDeltaBucket: "3s_to_10s_late",
      roomCode: "SECRET",
      displayName: "private player",
      answerText: "private answer",
      selectedChoice: 3,
      playerId: "50000000-0000-4000-8000-000000000005",
      deviceId: "private-device",
      submissionId: "60000000-0000-4000-8000-000000000006",
      cookie: "tr1via_device=private",
      authorization: "Bearer private",
      rawError: "private database detail",
    });

    expect(event).toEqual({
      schema: "tr1via.game_evidence.v1",
      level: "info",
      event: "game_question_finalize",
      engine: "legacy",
      nightId: NIGHT_ID,
      gameId: GAME_ID,
      questionId: QUESTION_ID,
      playId: PLAY_ID,
      outcome: "resolved",
      trigger: "timer",
      deadlineAt: "2026-09-16T00:13:37.434Z",
      resolvedAt: "2026-09-16T00:13:42.528Z",
      deadlineDeltaBucket: "3s_to_10s_late",
    });
    expect(Object.isFrozen(event)).toBe(true);
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("selectedChoice");
  });

  test("never reads forbidden fields", () => {
    const input = {
      event: "game_answer_result",
      engine: "legacy",
      questionId: QUESTION_ID,
      outcome: "accepted",
      get requestBody(): never {
        throw new Error("requestBody was read");
      },
      get cookie(): never {
        throw new Error("cookie was read");
      },
      get playerName(): never {
        throw new Error("playerName was read");
      },
      get rawError(): never {
        throw new Error("rawError was read");
      },
    };

    expect(createGameEvidenceEvent(input)).toMatchObject({
      event: "game_answer_result",
      outcome: "accepted",
      questionId: QUESTION_ID,
    });
  });

  test.each([
    ["unknown event", { event: "player_named_roger" }],
    ["invalid UUID", { event: "game_answer_result", engine: "legacy", questionId: "room-code", outcome: "accepted" }],
    ["raw outcome", { event: "game_answer_result", engine: "legacy", questionId: QUESTION_ID, outcome: "Roger chose A" }],
    ["late answer without timing bucket", { event: "game_answer_result", engine: "legacy", questionId: QUESTION_ID, outcome: "deadline_passed" }],
    ["resolved without authoritative times", { event: "game_question_finalize", engine: "legacy", questionId: QUESTION_ID, trigger: "timer", outcome: "resolved" }],
    ["arbitrary error", { event: "game_error", action: "answer_submit", errorCode: "player_roger_failed" }],
    ["malformed release", { event: "game_answer_result", engine: "legacy", questionId: QUESTION_ID, outcome: "accepted", clientRelease: "branch/main" }],
  ])("fails closed for %s", (_label, input) => {
    expect(createGameEvidenceEvent(input)).toBeNull();
  });

  test("uses stable coarse timing buckets and preserves the exclusive deadline", () => {
    expect(timingBucketFor(0)).toBe("under_250ms");
    expect(timingBucketFor(249)).toBe("under_250ms");
    expect(timingBucketFor(250)).toBe("250ms_to_1s");
    expect(timingBucketFor(1_000)).toBe("1s_to_3s");
    expect(timingBucketFor(10_000)).toBe("10s_plus");
    expect(timingBucketFor(-1)).toBeNull();
    expect(timingBucketFor(Number.NaN)).toBeNull();

    expect(deadlineDeltaBucketFor(-1)).toBe("before_deadline");
    expect(deadlineDeltaBucketFor(0)).toBe("at_deadline");
    expect(deadlineDeltaBucketFor(1)).toBe("under_250ms_late");
    expect(deadlineDeltaBucketFor(250)).toBe("250ms_to_1s_late");
    expect(deadlineDeltaBucketFor(10_000)).toBe("10s_plus_late");
    expect(deadlineDeltaBucketFor(Number.POSITIVE_INFINITY)).toBeNull();
  });

  test("emits exactly one JSON string with a derived level", async () => {
    const sink = vi.fn();
    expect(await recordGameEvidence({
      event: "game_broadcast_result",
      action: "question_resolved",
      outcome: "timeout",
      questionId: QUESTION_ID,
      latencyBucket: "250ms_to_1s",
    }, sink)).toBe(true);

    expect(sink).toHaveBeenCalledOnce();
    expect(sink.mock.calls[0][1]).toBe("warn");
    expect(typeof sink.mock.calls[0][0]).toBe("string");
    expect(JSON.parse(sink.mock.calls[0][0])).toMatchObject({
      schema: "tr1via.game_evidence.v1",
      level: "warn",
      event: "game_broadcast_result",
      outcome: "timeout",
    });
  });

  test("contains synchronous and asynchronous sink failure", async () => {
    const input = {
      event: "game_answer_result",
      engine: "legacy",
      questionId: QUESTION_ID,
      outcome: "accepted",
    };
    const sync = vi.fn(() => { throw new Error("logger unavailable"); });
    const asyncSink = vi.fn(async () => { throw new Error("collector unavailable"); });

    await expect(recordGameEvidence(input, sync)).resolves.toBe(false);
    await expect(recordGameEvidence(input, asyncSink)).resolves.toBe(false);
  });

  test("does not call the sink for invalid evidence", async () => {
    const sink = vi.fn();
    expect(await recordGameEvidence({ event: "game_answer_result" }, sink)).toBe(false);
    expect(sink).not.toHaveBeenCalled();
  });
});
