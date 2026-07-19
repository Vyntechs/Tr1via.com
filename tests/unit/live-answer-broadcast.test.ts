import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { broadcastAppliedLiveRoomEvent } from "@/lib/api/broadcast";

const fetchMock = vi.fn();

const live = {
  runId: "run-1",
  roomRevision: 8,
  controlRevision: 5,
  playId: "play-1",
  play: {
    playId: "play-1",
    gameId: "game-1",
    questionId: "question-1",
    state: "accepting" as const,
    openedAt: "2026-07-19T01:00:00.000Z",
    mainZeroAt: "2026-07-19T01:00:30.000Z",
    finalWindowStartsAt: null,
    finalWindowEndsAt: "2026-07-19T01:00:32.000Z",
    finalizeAt: null,
    eligibleCount: 3,
    confirmedCount: 1,
  },
};

describe("authoritative live room broadcast boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("broadcasts a transaction-winner answer event with aggregate state only", async () => {
    vi.useFakeTimers();
    const sent = await broadcastAppliedLiveRoomEvent("ABCDEF", {
      applied: true,
      freshness: "transaction_winner",
      kind: "answer_progress",
      serverNow: "2026-07-19T01:00:04.000Z",
      live,
      playerId: "PLAYER-ID-LEAK",
      deviceId: "DEVICE-ID-LEAK",
      submissionId: "SUBMISSION-ID-LEAK",
      slotChosen: 3,
      canonicalIndex: 1,
      eligibilityReason: "REASON-LEAK",
    } as Parameters<typeof broadcastAppliedLiveRoomEvent>[1]);

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.messages).toEqual([{
      topic: "room:ABCDEF",
      event: "live-room-event",
      payload: {
        kind: "answer_progress",
        serverNow: "2026-07-19T01:00:04.000Z",
        runId: "run-1",
        roomRevision: 8,
        controlRevision: 5,
        playId: "play-1",
        state: "accepting",
        openedAt: "2026-07-19T01:00:00.000Z",
        mainZeroAt: "2026-07-19T01:00:30.000Z",
        finalWindowStartsAt: null,
        finalWindowEndsAt: "2026-07-19T01:00:32.000Z",
        eligibleCount: 3,
        confirmedCount: 1,
        finalizeAt: null,
      },
    }]);
    const json = JSON.stringify(body);
    expect(json).not.toContain("PLAYER-ID-LEAK");
    expect(json).not.toContain("DEVICE-ID-LEAK");
    expect(json).not.toContain("SUBMISSION-ID-LEAK");
    expect(json).not.toContain("REASON-LEAK");
    expect(json).not.toContain("slotChosen");
    expect(json).not.toContain("canonicalIndex");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not rebroadcast an applied exact replay", async () => {
    const sent = await broadcastAppliedLiveRoomEvent("ABCDEF", {
      applied: true,
      freshness: "replay",
      kind: "play_resolved",
      serverNow: "2026-07-19T01:00:32.000Z",
      live,
    });

    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns a resolved play into a safe refetch signal without award details", async () => {
    const sent = await broadcastAppliedLiveRoomEvent("ABCDEF", {
      applied: true,
      freshness: "transaction_winner",
      kind: "play_resolved",
      serverNow: "2026-07-19T01:00:32.000Z",
      live: {
        ...live,
        play: { ...live.play, state: "resolved" },
      },
      awards: [{
        playerId: "PLAYER-ID-LEAK",
        isCorrect: true,
        awardedPoints: 110,
      }],
    } as Parameters<typeof broadcastAppliedLiveRoomEvent>[1]);

    expect(sent).toBe(true);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.messages[0].payload).toMatchObject({
      kind: "play_resolved",
      refetch: true,
      playId: "play-1",
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("awards");
    expect(serialized).not.toContain("PLAYER-ID-LEAK");
    expect(serialized).not.toContain("isCorrect");
    expect(serialized).not.toContain("awardedPoints");
  });

  it("aborts a nonsettling Realtime transport within the live answer budget", async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_input, init: RequestInit | undefined) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    });

    let settled = false;
    const result = broadcastAppliedLiveRoomEvent("ABCDEF", {
      applied: true,
      freshness: "transaction_winner",
      kind: "answer_progress",
      serverNow: "2026-07-19T01:00:04.000Z",
      live,
    }).then(
      () => "resolved" as const,
      () => "rejected" as const,
    ).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(749);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(settled).toBe(true);
    expect(await result).toBe("rejected");
    expect(capturedSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails closed when the transaction did not apply or freshness is missing", async () => {
    const rejected = await broadcastAppliedLiveRoomEvent("ABCDEF", {
      applied: false,
      freshness: "transaction_winner",
      kind: "answer_progress",
      serverNow: "2026-07-19T01:00:04.000Z",
      live,
    });
    const missing = await broadcastAppliedLiveRoomEvent("ABCDEF", {
      applied: true,
      kind: "answer_progress",
      serverNow: "2026-07-19T01:00:04.000Z",
      live,
    } as Parameters<typeof broadcastAppliedLiveRoomEvent>[1]);

    expect(rejected).toBe(false);
    expect(missing).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
