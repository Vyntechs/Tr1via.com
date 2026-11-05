import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TVSnapshot } from "@/lib/hooks/useTVRoom";

const h = vi.hoisted(() => {
  type BroadcastHandler = (message: { payload: unknown }) => void;
  const broadcastHandlers = new Map<string, Map<string, BroadcastHandler>>();

  const client = {
    channel: vi.fn((channelName: string) => {
      const channelHandlers = new Map<string, BroadcastHandler>();
      broadcastHandlers.set(channelName, channelHandlers);
      const channel = {
        on: vi.fn((
          kind: string,
          filter: { event?: string },
          handler: (message: { payload: unknown }) => void,
        ) => {
          if (kind === "broadcast" && filter.event) {
            channelHandlers.set(filter.event, handler);
          }
          return channel;
        }),
        subscribe: vi.fn(() => channel),
      };
      return channel;
    }),
    removeChannel: vi.fn(),
  };

  return {
    client,
    broadcast(roomCode: string, event: string, payload: unknown) {
      const handler = broadcastHandlers.get(`room:${roomCode}`)?.get(event);
      if (!handler) throw new Error(`missing ${event} handler for ${roomCode}`);
      handler({ payload });
    },
    reset() {
      broadcastHandlers.clear();
      client.channel.mockClear();
      client.removeChannel.mockClear();
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => h.client,
}));

import { useTVRoom } from "@/lib/hooks/useTVRoom";
import { __resetDiagClientForTests, setDiagSink } from "@/lib/diagnostics/client";

function snapshot(code: string, venueName: string): TVSnapshot {
  return {
    night: {
      id: `night-${code}`,
      venueName,
      themeKey: null,
      hostDefaultThemeKey: null,
      roomCode: code,
      openedAt: null,
      closedAt: null,
      scheduledAt: null,
      isLocked: false,
      roomMagicEnabled: false,
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
  };
}

function response(data: TVSnapshot, json = vi.fn(async () => data)) {
  return {
    ok: true,
    status: 200,
    json,
  } as unknown as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushTimersAndPromises() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
  });
}

describe("useTVRoom snapshot request lifecycle", () => {
  beforeEach(() => {
    h.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("tells the diagnostic reporter a question is live on the TV until the snapshot says it closed", async () => {
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
      const live = { ...snapshot("ABCDEF", "Question up"), liveQuestionId: "q1" };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(response(live))
        .mockResolvedValueOnce(response(snapshot("ABCDEF", "Answer reveal")));
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useTVRoom("ABCDEF"));
      await waitFor(() => expect(result.current.snapshot?.night.venueName).toBe("Question up"));
      expect(open).toEqual([true]);
      expect(log).toEqual(["open:true", "ready"]);

      act(() => {
        h.broadcast("ABCDEF", "game-started", { gameId: "g", serverNow: "2026-07-19T00:00:01.000Z" });
      });
      await waitFor(() => expect(result.current.snapshot?.night.venueName).toBe("Answer reveal"));
      expect(open).toEqual([true, false]);
    } finally {
      setDiagSink(null);
      __resetDiagClientForTests();
    }
  });

  it("refetches immediately when a game-started wake-up arrives", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot("ABCDEF", "Game 2 ready")))
      .mockResolvedValueOnce(response(snapshot("ABCDEF", "Game 2 live")));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useTVRoom("ABCDEF"));
    await waitFor(() => expect(result.current.snapshot?.night.venueName).toBe("Game 2 ready"));

    act(() => {
      h.broadcast("ABCDEF", "game-started", {
        gameId: "game-2",
        serverNow: "2026-07-19T00:00:01.000Z",
      });
    });

    await waitFor(() => expect(result.current.snapshot?.night.venueName).toBe("Game 2 live"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches on a scores hint without touching the reveal tag the timer reads", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => response(snapshot("ABCDEF", "Live")));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useTVRoom("ABCDEF"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => {
      h.broadcast("ABCDEF", "reveal", {
        questionId: "room-a-question",
        revealedAt: "2026-07-19T00:00:00.000Z",
        serverNow: "2026-07-19T00:00:00.000Z",
      });
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const tag = result.current.lastBroadcast;

    act(() => {
      h.broadcast("ABCDEF", "scores-refetch", {
        questionId: "older-question",
        serverNow: "2026-07-19T00:00:02.000Z",
      });
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(result.current.lastBroadcast).toBe(tag);
  });

  it("refetches immediately when the host publishes standings", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot("ABCDEF", "Answer reveal")))
      .mockResolvedValueOnce(response(snapshot("ABCDEF", "Standings board")));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useTVRoom("ABCDEF"));
    await waitFor(() => expect(result.current.snapshot?.night.venueName).toBe("Answer reveal"));

    act(() => {
      h.broadcast("ABCDEF", "advance", {
        questionId: "question-1",
        serverNow: "2026-07-19T00:00:01.000Z",
      });
    });

    await waitFor(() => expect(result.current.snapshot?.night.venueName).toBe("Standings board"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a newer same-room response when an older request finishes last", async () => {
    const older = deferred<Response>();
    const newer = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot("ABCDEF", "Initial")))
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useTVRoom("ABCDEF"));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      result.current.refresh();
      result.current.refresh();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      newer.resolve(response(snapshot("ABCDEF", "Newest")));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(result.current.snapshot?.night.venueName).toBe("Newest"),
    );

    await act(async () => {
      older.resolve(response(snapshot("ABCDEF", "Stale")));
      await Promise.resolve();
    });
    expect(result.current.snapshot?.night.venueName).toBe("Newest");
  });

  it("does not let a previous room response overwrite the room after a code switch", async () => {
    const previousRoom = deferred<Response>();
    const nextRoom = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot("ABCDEF", "Room A")))
      .mockImplementationOnce(() => previousRoom.promise)
      .mockImplementationOnce(() => nextRoom.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender } = renderHook(
      ({ code }) => useTVRoom(code),
      { initialProps: { code: "ABCDEF" } },
    );
    await waitFor(() =>
      expect(result.current.snapshot?.night.venueName).toBe("Room A"),
    );

    act(() => result.current.refresh());
    rerender({ code: "GHIJKL" });

    expect(result.current.status).toBe("loading");
    expect(result.current.snapshot).toBeNull();

    await act(async () => {
      nextRoom.resolve(response(snapshot("GHIJKL", "Room B")));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(result.current.snapshot?.night.venueName).toBe("Room B"),
    );

    await act(async () => {
      previousRoom.resolve(response(snapshot("ABCDEF", "Stale Room A")));
      await Promise.resolve();
    });
    expect(result.current.snapshot?.night.venueName).toBe("Room B");
  });

  it("masks room A welcome, fireworks, and Room Magic state immediately in room B", async () => {
    const nextRoom = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot("ABCDEF", "Room A")))
      .mockResolvedValueOnce(response(snapshot("ABCDEF", "Room A refreshed")))
      .mockImplementationOnce(() => nextRoom.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender } = renderHook(
      ({ code }) => useTVRoom(code),
      { initialProps: { code: "ABCDEF" } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      h.broadcast("ABCDEF", "roster-changed", {
        joinToken: "room-a-welcome",
        displayName: "Alice",
        joinedAt: "2026-07-19T00:00:01.000Z",
        serverNow: "2026-07-19T00:00:01.000Z",
      });
      h.broadcast("ABCDEF", "fireworks", {
        kind: "salvo",
        fireAt: "2026-07-19T00:00:02.000Z",
        serverNow: "2026-07-19T00:00:01.000Z",
      });
      h.broadcast("ABCDEF", "room-magic-reaction", {
        id: "room-a-reaction",
        kind: "wow",
        serverNow: "2026-07-19T00:00:01.000Z",
      });
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.lastBroadcast?.joinToken).toBe("room-a-welcome");
    expect(result.current.lastFireworksBeat).not.toBeNull();
    expect(result.current.lastRoomMagicReaction?.id).toBe("room-a-reaction");

    rerender({ code: "GHIJKL" });

    expect(result.current.lastBroadcast).toBeNull();
    expect(result.current.lastFireworksBeat).toBeNull();
    expect(result.current.lastRoomMagicReaction).toBeNull();

    await act(async () => {
      nextRoom.resolve(response(snapshot("GHIJKL", "Room B")));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.lastBroadcast).toBeNull();
    expect(result.current.lastFireworksBeat).toBeNull();
    expect(result.current.lastRoomMagicReaction).toBeNull();
  });

  it("ignores every queued room A callback without superseding room B and accepts room B callbacks", async () => {
    const nextRoom = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot("ABCDEF", "Room A")))
      .mockImplementationOnce(() => nextRoom.promise)
      .mockResolvedValue(response(snapshot("GHIJKL", "Room B refreshed")));
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender } = renderHook(
      ({ code }) => useTVRoom(code),
      { initialProps: { code: "ABCDEF" } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ code: "GHIJKL" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const roomBRequest = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;

    act(() => {
      h.broadcast("ABCDEF", "reveal", {
        questionId: "room-a-question",
        serverNow: "2026-07-19T00:00:01.000Z",
      });
      h.broadcast("ABCDEF", "undo", {
        questionId: "room-a-question",
        serverNow: "2026-07-19T00:00:01.000Z",
      });
      h.broadcast("ABCDEF", "resolve", {
        questionId: "room-a-question",
        serverNow: "2026-07-19T00:00:01.000Z",
        correctIndex: 2,
      });
      h.broadcast("ABCDEF", "end-early", {
        questionId: "room-a-question",
        serverNow: "2026-07-19T00:00:01.000Z",
      });
      h.broadcast("ABCDEF", "game-ended", {});
      h.broadcast("ABCDEF", "roster-changed", {
        joinToken: "stale-room-a-welcome",
        serverNow: "2026-07-19T00:00:01.000Z",
      });
      h.broadcast("ABCDEF", "fireworks", {
        kind: "finale",
        fireAt: "2026-07-19T00:00:02.000Z",
        serverNow: "2026-07-19T00:00:01.000Z",
      });
      h.broadcast("ABCDEF", "room-magic-reaction", {
        id: "stale-room-a-reaction",
        kind: "wow",
        serverNow: "2026-07-19T00:00:01.000Z",
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(roomBRequest?.signal?.aborted).toBe(false);
    expect(result.current.lastBroadcast).toBeNull();
    expect(result.current.lastFireworksBeat).toBeNull();
    expect(result.current.lastRoomMagicReaction).toBeNull();

    await act(async () => {
      nextRoom.resolve(response(snapshot("GHIJKL", "Room B")));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(result.current.snapshot?.night.venueName).toBe("Room B"),
    );

    act(() => {
      h.broadcast("GHIJKL", "roster-changed", {
        joinToken: "room-b-welcome",
        displayName: "Blair",
        joinedAt: "2026-07-19T00:00:03.000Z",
        serverNow: "2026-07-19T00:00:03.000Z",
      });
      h.broadcast("GHIJKL", "fireworks", {
        kind: "salvo",
        fireAt: "2026-07-19T00:00:04.000Z",
        serverNow: "2026-07-19T00:00:03.000Z",
      });
      h.broadcast("GHIJKL", "room-magic-reaction", {
        id: "room-b-reaction",
        kind: "wow",
        serverNow: "2026-07-19T00:00:03.000Z",
      });
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(result.current.lastBroadcast?.joinToken).toBe("room-b-welcome");
    expect(result.current.lastFireworksBeat).not.toBeNull();
    expect(result.current.lastRoomMagicReaction?.id).toBe("room-b-reaction");
  });

  it("aborts an in-flight request on unmount and ignores its response body", async () => {
    const afterUnmount = deferred<Response>();
    const json = vi.fn(async () => snapshot("ABCDEF", "After unmount"));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot("ABCDEF", "Initial")))
      .mockImplementationOnce(() => afterUnmount.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() => useTVRoom("ABCDEF"));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => result.current.refresh());
    const requestInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    unmount();

    expect(requestInit?.signal?.aborted).toBe(true);
    await act(async () => {
      afterUnmount.resolve(response(snapshot("ABCDEF", "After unmount"), json));
      await Promise.resolve();
    });
    expect(json).not.toHaveBeenCalled();
  });

  it("keeps the four-second safety poll updating the active room", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot("ABCDEF", "Initial")))
      .mockResolvedValueOnce(response(snapshot("ABCDEF", "Polled")));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useTVRoom("ABCDEF"));
    await flushTimersAndPromises();
    expect(result.current.snapshot?.night.venueName).toBe("Initial");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    await flushTimersAndPromises();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.snapshot?.night.venueName).toBe("Polled");
  });

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
    await flushTimersAndPromises();
  }

  function signalOf(fetchMock: ReturnType<typeof vi.fn>, call: number) {
    return (fetchMock.mock.calls[call][1] as RequestInit).signal as AbortSignal;
  }

  it("lets a slow reply land: a safety poll skips a request under 5s old", async () => {
    vi.useFakeTimers();
    const slow = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot("ABCDEF", "Initial")))
      .mockReturnValueOnce(slow.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useTVRoom("ABCDEF"));
    await flushTimersAndPromises();

    await advance(4_000); // the poll at 4s starts the slow request
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await advance(4_000); // the poll at 8s finds it 4s old and leaves it alone
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signalOf(fetchMock, 1).aborted).toBe(false);

    await advance(500);
    slow.resolve(response(snapshot("ABCDEF", "Slow reply")));
    await flushTimersAndPromises();

    expect(result.current.status).toBe("ready");
    expect(result.current.snapshot?.night.venueName).toBe("Slow reply");
  });

  it("skips while the very first load is pending, then polls again once the 5s bound clears it", async () => {
    vi.useFakeTimers();
    const hung = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(hung.promise)
      .mockResolvedValueOnce(response(snapshot("ABCDEF", "Recovered")));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useTVRoom("ABCDEF"));
    await flushTimersAndPromises();

    await advance(4_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await advance(1_000); // the 5s bound gives up on it
    expect(signalOf(fetchMock, 0).aborted).toBe(true);
    expect(result.current.status).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await advance(3_000); // the poll at 8s has nothing in flight
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("ready");
    expect(result.current.snapshot?.night.venueName).toBe("Recovered");
  });

  it("replaces a request that is stuck past 5s, which the fetch bound can't see once headers land", async () => {
    vi.useFakeTimers();
    const stuckBody = deferred<TVSnapshot>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot("ABCDEF", "Initial")))
      .mockResolvedValueOnce(
        response(snapshot("ABCDEF", "never"), vi.fn(() => stuckBody.promise)),
      )
      .mockResolvedValueOnce(response(snapshot("ABCDEF", "Replaced")));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useTVRoom("ABCDEF"));
    await flushTimersAndPromises();

    await advance(4_000); // starts the request whose body never arrives
    await advance(4_000); // 4s old: skipped
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await advance(4_000); // 8s old: replaced
    expect(signalOf(fetchMock, 1).aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.snapshot?.night.venueName).toBe("Replaced");
  });

  it("still aborts and restarts for a broadcast, however young the request", async () => {
    vi.useFakeTimers();
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useTVRoom("ABCDEF"));
    await flushTimersAndPromises();

    await advance(2_000);
    act(() => {
      h.broadcast("ABCDEF", "resolve", {
        questionId: "q1",
        serverNow: "2026-07-20T01:00:00.000Z",
      });
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signalOf(fetchMock, 0).aborted).toBe(true);

    await advance(2_000); // the poll at 4s finds a 2s-old request
    expect(fetchMock).toHaveBeenCalledTimes(2);

    second.resolve(response(snapshot("ABCDEF", "After resolve")));
    await flushTimersAndPromises();
    expect(result.current.snapshot?.night.venueName).toBe("After resolve");
  });

  it.each([
    ["a server error", () => Promise.resolve({ ok: false, status: 503 } as Response), 0],
    ["a dropped connection", () => Promise.reject(new TypeError("Failed to fetch")), 0],
    ["a hung request", () => new Promise<Response>(() => {}), 5_000],
  ])("keeps the last snapshot through %s, then takes the next good one", async (_name, failure, failsAfterMs) => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot("ABCDEF", "Last good")))
      .mockImplementationOnce(failure)
      .mockResolvedValue(response(snapshot("ABCDEF", "Back online")));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useTVRoom("ABCDEF"));
    await flushTimersAndPromises();

    await advance(4_000); // the poll at 4s meets the failure
    await advance(failsAfterMs);
    expect(result.current.status).toBe("error");
    expect(result.current.snapshot?.night.venueName).toBe("Last good");

    await advance(8_000 - failsAfterMs); // the poll at 12s at the latest
    expect(result.current.status).toBe("ready");
    expect(result.current.snapshot?.night.venueName).toBe("Back online");
  });
});
