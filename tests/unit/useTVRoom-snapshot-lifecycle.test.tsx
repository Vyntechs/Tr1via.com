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
});
