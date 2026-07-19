import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TVSnapshot } from "@/lib/hooks/useTVRoom";

const h = vi.hoisted(() => {
  const broadcastHandlers = new Map<string, (message: { payload: unknown }) => void>();

  const client = {
    channel: vi.fn(() => {
      const channel = {
        on: vi.fn((
          kind: string,
          filter: { event?: string },
          handler: (message: { payload: unknown }) => void,
        ) => {
          if (kind === "broadcast" && filter.event) {
            broadcastHandlers.set(filter.event, handler);
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
    broadcastHandlers,
    client,
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
