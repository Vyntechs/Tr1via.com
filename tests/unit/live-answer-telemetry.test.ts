import { describe, expect, test, vi } from "vitest";

import {
  createLiveAnswerHealthEvent,
  latencyBucketFor,
  recordLiveAnswerHealth,
} from "@/lib/live-answer/telemetry";

const PLAY_ID = "50000000-0000-4000-8000-000000000001";

describe("live answer health telemetry", () => {
  test("constructs only the explicit operational allowlist", () => {
    const event = createLiveAnswerHealthEvent({
      playId: PLAY_ID,
      latencyBucket: "250ms_to_1s",
      resultCode: "confirmed",
      retryCount: 2,
      duplicateCount: 1,
      reconciliationCount: 1,
      resolutionReason: "all_confirmed",
      roomCode: "SECRET",
      answerText: "private answer",
      slotChosen: 4,
      requestBody: { playerId: "private" },
      playerId: "50000000-0000-4000-8000-000000000002",
      deviceId: "private-device",
      submissionId: "50000000-0000-4000-8000-000000000003",
      cookie: "tr1via_device=private",
      authorization: "Bearer private",
      token: "private-token",
      databaseError: "raw database detail",
    });

    expect(event).toEqual({
      playId: PLAY_ID,
      latencyBucket: "250ms_to_1s",
      resultCode: "confirmed",
      retryCount: 2,
      duplicateCount: 1,
      reconciliationCount: 1,
      resolutionReason: "all_confirmed",
    });
    expect(Object.keys(event ?? {})).toEqual([
      "playId",
      "latencyBucket",
      "resultCode",
      "retryCount",
      "duplicateCount",
      "reconciliationCount",
      "resolutionReason",
    ]);
    expect(Object.isFrozen(event)).toBe(true);
  });

  test("omits absent optional measures instead of inventing telemetry", () => {
    expect(
      createLiveAnswerHealthEvent({
        playId: PLAY_ID,
        resultCode: "deadline_passed",
      }),
    ).toEqual({ playId: PLAY_ID, resultCode: "deadline_passed" });
  });

  test("requires a typed result code for every emitted health event", () => {
    expect(createLiveAnswerHealthEvent({ playId: PLAY_ID })).toBeNull();
  });

  test.each([
    ["missing play ID", { resultCode: "confirmed" }],
    ["non-UUID play ID", { playId: "ROOM42", resultCode: "confirmed" }],
    ["untyped result code", { playId: PLAY_ID, resultCode: "raw database failure" }],
    ["fine-grained latency", { playId: PLAY_ID, latencyBucket: "437ms" }],
    ["negative retry count", { playId: PLAY_ID, retryCount: -1 }],
    ["fractional duplicate count", { playId: PLAY_ID, duplicateCount: 1.5 }],
    ["unknown resolution reason", { playId: PLAY_ID, resolutionReason: "because host said so" }],
  ])("fails closed for %s", (_label, input) => {
    expect(createLiveAnswerHealthEvent(input)).toBeNull();
  });

  test("uses stable coarse latency buckets without emitting milliseconds", () => {
    expect(latencyBucketFor(0)).toBe("under_250ms");
    expect(latencyBucketFor(249)).toBe("under_250ms");
    expect(latencyBucketFor(250)).toBe("250ms_to_1s");
    expect(latencyBucketFor(999)).toBe("250ms_to_1s");
    expect(latencyBucketFor(1_000)).toBe("1s_to_3s");
    expect(latencyBucketFor(2_999)).toBe("1s_to_3s");
    expect(latencyBucketFor(3_000)).toBe("3s_to_10s");
    expect(latencyBucketFor(9_999)).toBe("3s_to_10s");
    expect(latencyBucketFor(10_000)).toBe("10s_plus");
    expect(latencyBucketFor(-1)).toBeNull();
    expect(latencyBucketFor(Number.NaN)).toBeNull();
    expect(latencyBucketFor(Number.POSITIVE_INFINITY)).toBeNull();
  });

  test("records only the constructed safe event", () => {
    const sink = vi.fn();

    expect(
      recordLiveAnswerHealth(
        {
          playId: PLAY_ID,
          latencyBucket: "under_250ms",
          resultCode: "resolved",
          duplicateCount: 3,
          resolutionReason: "timer",
          roomCode: "NEVER-EMIT",
          rawDatabaseMessage: "NEVER-EMIT",
        },
        sink,
      ),
    ).toBe(true);
    expect(sink).toHaveBeenCalledOnce();
    expect(sink).toHaveBeenCalledWith({
      playId: PLAY_ID,
      latencyBucket: "under_250ms",
      resultCode: "resolved",
      duplicateCount: 3,
      resolutionReason: "timer",
    });
  });

  test("does not invoke the sink for an invalid event", () => {
    const sink = vi.fn();

    expect(
      recordLiveAnswerHealth(
        { playId: PLAY_ID, resultCode: "database exploded" },
        sink,
      ),
    ).toBe(false);
    expect(sink).not.toHaveBeenCalled();
  });

  test("telemetry sink failure never changes the live mutation outcome", () => {
    const sink = vi.fn(() => {
      throw new Error("collector unavailable");
    });

    expect(
      recordLiveAnswerHealth(
        { playId: PLAY_ID, resultCode: "confirmed" },
        sink,
      ),
    ).toBe(false);
    expect(sink).toHaveBeenCalledOnce();
  });

  test("never reads denied fields while constructing the allowlist", () => {
    const input = {
      playId: PLAY_ID,
      resultCode: "confirmed",
      get requestBody(): never {
        throw new Error("denied field was read");
      },
      get cookie(): never {
        throw new Error("denied field was read");
      },
      get rawDatabaseMessage(): never {
        throw new Error("denied field was read");
      },
    };

    expect(createLiveAnswerHealthEvent(input)).toEqual({
      playId: PLAY_ID,
      resultCode: "confirmed",
    });
  });
});
