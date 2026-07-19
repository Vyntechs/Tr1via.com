import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("broadcasts a transaction-winner answer event with aggregate state only", async () => {
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
