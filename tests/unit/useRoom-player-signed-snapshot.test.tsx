import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoomSnapshotPayload } from "@/lib/room/roomSnapshotPayload";

const h = vi.hoisted(() => {
  const broadcastHandlers = new Map<string, (message: { payload: unknown }) => void>();
  const subscribeCallbacks: Array<(status: string) => void> = [];
  const channelNames: string[] = [];
  const fromCalls: string[] = [];
  let focusTick = 0;

  function queryBuilder() {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      is: vi.fn(() => builder),
      not: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      single: vi.fn(async () => ({ data: null, error: null })),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      then: (onFulfilled: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(onFulfilled),
    };
    return builder;
  }

  const client = {
    realtime: {
      connect: vi.fn(),
      disconnect: vi.fn(),
    },
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      return queryBuilder();
    }),
    channel: vi.fn((name: string) => {
      channelNames.push(name);
      const channel = {
        on: vi.fn(
          (
            kind: string,
            filter: { event?: string },
            handler: (message: { payload: unknown }) => void,
          ) => {
            if (kind === "broadcast" && filter.event) {
              broadcastHandlers.set(filter.event, handler);
            }
            return channel;
          },
        ),
        subscribe: vi.fn((callback?: (status: string) => void) => {
          if (callback) subscribeCallbacks.push(callback);
          callback?.("SUBSCRIBED");
          return channel;
        }),
      };
      return channel;
    }),
    removeChannel: vi.fn(),
  };

  return {
    broadcastHandlers,
    channelNames,
    subscribeCallbacks,
    client,
    fetchSnapshot: vi.fn(),
    fromCalls,
    getFocusTick: () => focusTick,
    reset() {
      broadcastHandlers.clear();
      channelNames.length = 0;
      subscribeCallbacks.length = 0;
      fromCalls.length = 0;
      focusTick = 0;
      client.from.mockClear();
      client.channel.mockClear();
      client.removeChannel.mockClear();
      h.fetchSnapshot.mockReset();
    },
    bumpFocus() {
      focusTick += 1;
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => h.client,
}));

vi.mock("@/lib/room/fetchRoomSnapshot", () => ({
  fetchRoomSnapshotPayload: h.fetchSnapshot,
}));

vi.mock("@/lib/hooks/useRevalidateOnFocus", () => ({
  useRevalidateOnFocus: () => h.getFocusTick(),
}));

vi.mock("@/lib/hooks/useFreshnessWatchdog", () => ({
  useFreshnessWatchdog: () => undefined,
}));

vi.mock("@/lib/hooks/useUnreachableRetry", () => ({
  useUnreachableRetry: () => undefined,
}));

vi.mock("@/lib/hooks/useRoomRoutePoll", () => ({
  useRoomRoutePoll: () => undefined,
}));

import { useRoom } from "@/lib/hooks/useRoom";
import { __resetDiagClientForTests, setDiagSink } from "@/lib/diagnostics/client";
import {
  __resetReachabilityForTests,
  getReachability,
  setReachability,
} from "@/lib/realtime/reachability";

function playerPayload(label = "confirmed"): RoomSnapshotPayload {
  return {
    audience: "player",
    night: {
      nightKey: "night-key-1",
      venue_name: label,
      room_code: "ABCDEF",
      scheduled_at: null,
      opened_at: "2026-07-18T18:00:00.000Z",
      closed_at: null,
      theme_key: "house",
      is_locked: false,
      room_magic_enabled: false,
      created_at: "2026-07-18T18:00:00.000Z",
    },
    hostDefaultThemeKey: "house",
    games: [
      {
        id: "game-1",
        game_no: 1,
        state: "live",
        started_at: "2026-07-18T18:05:00.000Z",
        ended_at: null,
        category_count: 1,
        question_count: 1,
      },
    ],
    categories: [
      {
        id: "category-1",
        game_id: "game-1",
        name: "Music",
        topic: "Music",
        position: 0,
        color: null,
        state: "ready",
        flavor: null,
        created_at: "2026-07-18T18:00:00.000Z",
      },
    ],
    players: [
      {
        playerKey: "player-key-1",
        displayName: "Maya",
        joinedAt: "2026-07-18T18:01:00.000Z",
        lastSeenAt: "2026-07-18T18:02:00.000Z",
        removedAt: null,
        appSwitchTotalSeconds: 0,
      },
    ],
    currentQuestion: {
      id: "question-1",
      categoryId: "category-1",
      difficulty: 1,
      factBlurb: null,
      imageAttribution: null,
      imageSource: null,
      imageUrl: null,
      isPicked: true,
      options: ["A", "B", "C", "D"],
      playedAt: "2026-07-18T18:06:00.000Z",
      finishedAt: null,
      pointValue: 100,
      prompt: label,
      source: "manual",
    },
    lastResolvedQuestion: null,
    currentReveal: null,
    allQuestions: [],
    self: {
      playerKey: "player-key-1",
      displayName: "Maya",
      joinedAt: "2026-07-18T18:01:00.000Z",
      lastSeenAt: "2026-07-18T18:02:00.000Z",
      removedAt: null,
      appSwitchTotalSeconds: 0,
    },
    myAnswers: [
      {
        questionId: "old-question",
        chosenIndex: 2,
        scramble: [2, 0, 3, 1],
        lockedAt: "2026-07-18T18:04:00.000Z",
        msToLock: 2200,
        isCorrect: true,
        awardedPoints: 110,
      },
    ],
    myParticipations: [
      {
        gameId: "game-1",
        joinedAt: "2026-07-18T18:01:00.000Z",
      },
    ],
    scores: [
      {
        gameId: "game-1",
        playerKey: "player-key-1",
        displayName: "Maya",
        score: 110,
        answeredCount: 1,
        correctCount: 1,
        fastestCorrectMs: 2200,
      },
    ],
    allScores: [],
    questionScrambles: { "question-1": [0, 1, 2, 3] },
  };
}

describe("useRoom player audience", () => {
  beforeEach(() => {
    h.reset();
    __resetReachabilityForTests();
    h.fetchSnapshot.mockResolvedValue(playerPayload());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("player useRoom must not use legacy bootstrap fetches");
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("tells the diagnostic reporter a question is live until the room says it closed (not when the player locks in)", async () => {
    const open: boolean[] = [];
    const log: string[] = [];
    setDiagSink({
      event: () => {},
      questionOpen: (value) => {
        open.push(value);
        log.push(`open:${value}`);
      },
      roomReady: () => log.push("ready"),
    });
    try {
      h.fetchSnapshot
        .mockResolvedValueOnce(playerPayload("live"))
        // the room moved on: no live question any more
        .mockResolvedValueOnce({ ...playerPayload("closed"), currentQuestion: null });
      const { result } = renderHook(() =>
        useRoom({ roomCode: "ABCDEF", audience: "player", sessionReady: true }),
      );
      await waitFor(() => expect(result.current.night?.venue_name).toBe("live"));
      expect(open).toEqual([true]);
      // "the room has loaded" is told AFTER what is on screen, so the reporter
      // never sees a loaded room whose open question it has not heard about.
      expect(log).toEqual(["open:true", "ready"]);

      act(() => {
        h.broadcastHandlers.get("resolve")?.({
          payload: { questionId: "question-1", serverNow: "2026-07-18T18:06:26.000Z" },
        });
      });
      await waitFor(() => expect(result.current.night?.venue_name).toBe("closed"));
      expect(open).toEqual([true, false]);
    } finally {
      setDiagSink(null);
      __resetDiagClientForTests();
    }
  });

  it("waits for session readiness, then consumes the signed player payload without raw reads", async () => {
    const { result, rerender } = renderHook(
      ({ sessionReady }) =>
        useRoom({ roomCode: "ABCDEF", audience: "player", sessionReady }),
      { initialProps: { sessionReady: false } },
    );

    expect(h.fetchSnapshot).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(true);

    rerender({ sessionReady: true });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.self?.id).toBe("player-key-1");
    expect(result.current.myAnswers?.[0]?.id).toBe("answer:old-question");
    expect(result.current.myParticipations?.[0]?.id).toBe("participation:game-1");
    expect(result.current.scores?.[0]?.score).toBe(110);
    expect(h.fromCalls).toEqual([]);
    expect(h.channelNames).toEqual(["room:ABCDEF"]);
  });

  it("re-reads on a scores hint and keeps the reveal tag the timer reads", async () => {
    h.fetchSnapshot.mockResolvedValue(playerPayload("confirmed"));
    const { result } = renderHook(() =>
      useRoom({ roomCode: "ABCDEF", audience: "player", sessionReady: true }),
    );
    await waitFor(() => expect(result.current.night?.venue_name).toBe("confirmed"));

    act(() => {
      h.broadcastHandlers.get("reveal")?.({
        payload: {
          questionId: "question-1",
          serverNow: "2026-07-18T18:06:01.000Z",
          revealedAt: "2026-07-18T18:06:00.000Z",
        },
      });
    });
    await waitFor(() => expect(h.fetchSnapshot).toHaveBeenCalledTimes(2));
    const tag = result.current.lastBroadcast;

    act(() => {
      h.broadcastHandlers.get("scores-refetch")?.({
        payload: { questionId: "older-question", serverNow: "2026-07-18T18:06:03.000Z" },
      });
    });
    await waitFor(() => expect(h.fetchSnapshot).toHaveBeenCalledTimes(3));
    expect(result.current.lastBroadcast).toEqual(tag);
  });

  it("keeps the last confirmed snapshot visible while a broadcast refetch is pending", async () => {
    let resolveRecovery!: (payload: RoomSnapshotPayload) => void;
    h.fetchSnapshot
      .mockResolvedValueOnce(playerPayload("first confirmed"))
      .mockImplementationOnce(
        () =>
          new Promise<RoomSnapshotPayload>((resolve) => {
            resolveRecovery = resolve;
          }),
      );

    const { result } = renderHook(() =>
      useRoom({ roomCode: "ABCDEF", audience: "player", sessionReady: true }),
    );
    await waitFor(() => expect(result.current.night?.venue_name).toBe("first confirmed"));

    act(() => {
      h.broadcastHandlers.get("reveal")?.({
        payload: {
          questionId: "question-1",
          serverNow: "2026-07-18T18:06:01.000Z",
          revealedAt: "2026-07-18T18:06:00.000Z",
        },
      });
    });

    expect(h.fetchSnapshot).toHaveBeenCalledTimes(2);
    expect(result.current.night?.venue_name).toBe("first confirmed");
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      resolveRecovery(playerPayload("recovered"));
    });
    await waitFor(() => expect(result.current.night?.venue_name).toBe("recovered"));
  });

  it("refetches the signed snapshot for the allowlisted recovery broadcasts", async () => {
    const { result } = renderHook(() =>
      useRoom({ roomCode: "ABCDEF", audience: "player", sessionReady: true }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    for (const event of ["reveal", "undo", "resolve", "advance", "game-started", "game-ended"] as const) {
      const before = h.fetchSnapshot.mock.calls.length;
      act(() => {
        h.broadcastHandlers.get(event)?.({
          payload: {
            questionId: "question-1",
            serverNow: "2026-07-18T18:06:01.000Z",
          },
        });
      });
      await waitFor(() => expect(h.fetchSnapshot).toHaveBeenCalledTimes(before + 1));
    }

    expect(h.channelNames).toEqual(["room:ABCDEF"]);
    expect(h.fromCalls).toEqual([]);
  });

  it("does not turn every player's answer-progress event into a venue-wide snapshot storm", async () => {
    const { result } = renderHook(() =>
      useRoom({ roomCode: "ABCDEF", audience: "player", sessionReady: true }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const before = h.fetchSnapshot.mock.calls.length;

    act(() => {
      for (let index = 0; index < 40; index += 1) {
        h.broadcastHandlers.get("live-room-event")?.({
          payload: {
            kind: "answer_progress",
            live: { roomRevision: index + 1 },
          },
        });
      }
    });
    expect(h.fetchSnapshot).toHaveBeenCalledTimes(before);

    act(() => {
      h.broadcastHandlers.get("live-room-event")?.({
        payload: { kind: "play_resolved", live: { roomRevision: 41 } },
      });
    });
    await waitFor(() => expect(h.fetchSnapshot).toHaveBeenCalledTimes(before + 1));
  });

  it("moves a signed player from Game 2 ready to live on game-started", async () => {
    const beforeStart = playerPayload("waiting for Game 2");
    beforeStart.games = [
      { ...beforeStart.games[0], state: "done", ended_at: "2026-07-18T19:00:00.000Z" },
      {
        ...beforeStart.games[0],
        id: "game-2",
        game_no: 2,
        state: "ready",
        started_at: null,
        ended_at: null,
      },
    ];
    beforeStart.currentQuestion = null;
    const afterStart = structuredClone(beforeStart);
    afterStart.games[1] = {
      ...afterStart.games[1],
      state: "live",
      started_at: "2026-07-18T19:05:00.000Z",
    };
    h.fetchSnapshot
      .mockResolvedValueOnce(beforeStart)
      .mockResolvedValueOnce(afterStart);

    const { result } = renderHook(() =>
      useRoom({ roomCode: "ABCDEF", audience: "player", sessionReady: true }),
    );
    await waitFor(() => expect(result.current.currentGame?.state).toBe("done"));

    act(() => {
      h.broadcastHandlers.get("game-started")?.({
        payload: {
          gameId: "game-2",
          serverNow: "2026-07-18T19:05:00.000Z",
        },
      });
    });

    await waitFor(() => expect(result.current.currentGame?.state).toBe("live"));
    expect(result.current.currentGame?.id).toBe("game-2");
    expect(h.fromCalls).toEqual([]);
  });

  it("treats roster-changed as an identity-free refresh signal", async () => {
    const { result } = renderHook(() =>
      useRoom({ roomCode: "ABCDEF", audience: "player", sessionReady: true }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const before = h.fetchSnapshot.mock.calls.length;

    act(() => {
      h.broadcastHandlers.get("roster-changed")?.({
        payload: {
          joinToken: "join-event-token",
          displayName: "Blair",
          joinedAt: "2026-07-18T18:07:00.000Z",
          colorKey: 4,
          serverNow: "2026-07-18T18:07:00.000Z",
          playerId: "22222222-2222-4222-8222-222222222222",
        },
      });
    });

    await waitFor(() => expect(h.fetchSnapshot).toHaveBeenCalledTimes(before + 1));
    expect(result.current.lastBroadcast).toMatchObject({
      event: "roster-changed",
      joinToken: "join-event-token",
      displayName: "Blair",
    });
    expect(result.current.lastBroadcast).not.toHaveProperty("playerId");
  });

  it("runs a queued signed refresh after an active refresh fails", async () => {
    let rejectOlder!: (reason?: unknown) => void;
    h.fetchSnapshot
      .mockResolvedValueOnce(playerPayload("initial"))
      .mockImplementationOnce(
        () =>
          new Promise<RoomSnapshotPayload>((_resolve, reject) => {
            rejectOlder = reject;
          }),
      )
      .mockResolvedValueOnce(playerPayload("newer success"));

    const { result } = renderHook(() =>
      useRoom({ roomCode: "ABCDEF", audience: "player", sessionReady: true }),
    );
    await waitFor(() => expect(result.current.night?.venue_name).toBe("initial"));

    act(() => {
      h.broadcastHandlers.get("reveal")?.({ payload: {} });
      h.broadcastHandlers.get("undo")?.({ payload: {} });
    });

    await act(async () => {
      rejectOlder(new Error("stale network failure"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(result.current.night?.venue_name).toBe("newer success"),
    );
    expect(getReachability()).toBe("ok");
    expect(result.current.night?.venue_name).toBe("newer success");
  });

  it("refetches on focus/online recovery and the safety heartbeat", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(() =>
      useRoom({ roomCode: "ABCDEF", audience: "player", sessionReady: true }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.isLoading).toBe(false);
    expect(h.fetchSnapshot).toHaveBeenCalledTimes(1);

    h.bumpFocus();
    rerender();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.fetchSnapshot).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(h.fetchSnapshot).toHaveBeenCalledTimes(3);
  });

  describe("spread recovery", () => {
    async function joined() {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const view = renderHook(() =>
        useRoom({ roomCode: "ABCDEF", audience: "player", sessionReady: true }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(h.fetchSnapshot).toHaveBeenCalledTimes(1);
      return view;
    }
    const advance = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    const lastChannel = () => h.subscribeCallbacks[h.subscribeCallbacks.length - 1]!;

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("a dropped channel rebuilds and reads once, at a random moment, not at once", async () => {
      await joined();
      const channelsBefore = h.subscribeCallbacks.length;
      act(() => lastChannel()("CHANNEL_ERROR"));
      await advance(0);
      expect(h.subscribeCallbacks.length).toBe(channelsBefore + 1); // rebuilt
      expect(h.fetchSnapshot).toHaveBeenCalledTimes(1); // and not read yet
      await advance(999);
      expect(h.fetchSnapshot).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(h.fetchSnapshot).toHaveBeenCalledTimes(2); // 0.5 of 2000
      await advance(5000);
      expect(h.fetchSnapshot).toHaveBeenCalledTimes(2);
    });

    it("a channel that rejoins by itself gets the same single spread read", async () => {
      await joined();
      const channel = lastChannel();
      // Inside the 2s throttle, so no rebuild: only the rejoin can recover it.
      vi.setSystemTime(Date.now() + 5000);
      act(() => channel("TIMED_OUT"));
      await advance(0);
      await advance(1000); // the rebuild's read
      expect(h.fetchSnapshot).toHaveBeenCalledTimes(2);
      act(() => lastChannel()("CLOSED")); // throttled: no rebuild this time
      act(() => lastChannel()("SUBSCRIBED"));
      expect(h.fetchSnapshot).toHaveBeenCalledTimes(2);
      await advance(1000);
      expect(h.fetchSnapshot).toHaveBeenCalledTimes(3);
    });

    it("the first join costs no extra read", async () => {
      await joined();
      await advance(5000);
      expect(h.fetchSnapshot).toHaveBeenCalledTimes(1);
    });

    it("reachability coming back reads once more after a random wait", async () => {
      await joined();
      act(() => setReachability("unreachable"));
      act(() => setReachability("ok"));
      expect(h.fetchSnapshot).toHaveBeenCalledTimes(1);
      await advance(1000);
      expect(h.fetchSnapshot).toHaveBeenCalledTimes(2);
    });

    it("a rejoin and a reachability recovery together still read once", async () => {
      await joined();
      act(() => setReachability("unreachable"));
      act(() => lastChannel()("CLOSED"));
      act(() => setReachability("ok"));
      await advance(0);
      act(() => lastChannel()("SUBSCRIBED"));
      await advance(1000);
      expect(h.fetchSnapshot).toHaveBeenCalledTimes(2);
    });

    it("a question event during the wait still reads at once", async () => {
      await joined();
      act(() => setReachability("unreachable"));
      act(() => setReachability("ok"));
      act(() => {
        h.broadcastHandlers.get("reveal")?.({
          payload: { questionId: "q9", serverNow: "2026-11-04T20:00:00.000Z" },
        });
      });
      await advance(0);
      expect(h.fetchSnapshot).toHaveBeenCalledTimes(2);
    });

    it("stamps the reveal with this device's clock when it arrives", async () => {
      const { result } = await joined();
      const now = Date.now();
      act(() => {
        h.broadcastHandlers.get("reveal")?.({
          payload: { questionId: "q9", serverNow: "2026-11-04T20:00:00.000Z" },
        });
      });
      await advance(0);
      expect(result.current.lastBroadcast).toMatchObject({ event: "reveal", receivedAtMs: now });
    });

    it("drops the wait when the room goes away", async () => {
      const { unmount } = await joined();
      act(() => setReachability("unreachable"));
      act(() => setReachability("ok"));
      unmount();
      await advance(5000);
      expect(h.fetchSnapshot).toHaveBeenCalledTimes(1);
    });
  });
});
