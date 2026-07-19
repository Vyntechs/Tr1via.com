import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { TVSnapshot } from "@/lib/hooks/useTVRoom";

const supaMock = vi.hoisted(() => {
  const broadcastHandlers = new Map<string, (msg: { payload: unknown }) => void>();
  const fromCalls: string[] = [];

  function reset() {
    broadcastHandlers.clear();
    fromCalls.length = 0;
  }

  function qb(rows: Record<string, unknown>[], single = false) {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      is: vi.fn(() => builder),
      not: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      single: vi.fn(async () => ({ data: rows[0] ?? null, error: null })),
      maybeSingle: vi.fn(async () => ({ data: rows[0] ?? null, error: null })),
      then: (onF: (v: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({
          data: single ? rows[0] ?? null : rows,
          error: null,
        }).then(onF),
    };
    return builder;
  }

  const client = {
    realtime: {
      connect: vi.fn(),
      disconnect: vi.fn(),
    },
    channel: vi.fn(() => {
      const channel = {
        on: vi.fn((
          kind: string,
          filter: { event?: string },
          handler: (msg: { payload: unknown }) => void,
        ) => {
          if (kind === "broadcast" && filter.event) {
            broadcastHandlers.set(filter.event, handler);
          }
          return channel;
        }),
        subscribe: vi.fn((cb?: (status: string) => void) => {
          cb?.("SUBSCRIBED");
          return channel;
        }),
      };
      return channel;
    }),
    removeChannel: vi.fn(),
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      if (table === "nights") {
        return qb(
          [
            {
              id: "night-1",
              host_id: "host-1",
              venue_name: "Venue",
              room_code: "ABCDEF",
              theme_key: "house",
              room_magic_enabled: true,
              is_locked: false,
              scheduled_at: null,
              opened_at: null,
              closed_at: null,
              created_at: "2026-06-30T12:00:00.000Z",
            },
          ],
          true,
        );
      }
      if (table === "games") {
        return qb([
          {
            id: "game-1",
            night_id: "night-1",
            game_no: 1,
            state: "live",
            started_at: null,
            ended_at: null,
            category_count: 0,
            question_count: 0,
          },
        ]);
      }
      return qb([]);
    }),
    broadcast(event: string, payload: unknown) {
      broadcastHandlers.get(event)?.({ payload });
    },
    fromCallCount() {
      return fromCalls.length;
    },
  };

  return {
    getSupabaseBrowser: () => client,
    client,
    reset,
  };
});

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: supaMock.getSupabaseBrowser,
}));

import { useRoom } from "@/lib/hooks/useRoom";
import { useTVRoom } from "@/lib/hooks/useTVRoom";

const roomMagicEvent = {
  id: "reaction-1",
  kind: "wow",
  serverNow: "2026-06-30T12:00:30.000Z",
};

function readyTVSnapshot(): TVSnapshot {
  return {
    night: {
      id: "night-1",
      venueName: "Venue",
      themeKey: "house",
      hostDefaultThemeKey: null,
      roomCode: "ABCDEF",
      openedAt: null,
      closedAt: null,
      scheduledAt: null,
      isLocked: false,
      roomMagicEnabled: true,
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

describe("Room Magic broadcast hooks", () => {
  beforeEach(() => {
    supaMock.reset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/nights/by-code/")) {
          return {
            ok: true,
            json: async () => ({
              nightId: "night-1",
              hostDefaultThemeKey: "house",
            }),
          };
        }
        if (url.includes("/api/tv/")) {
          return {
            ok: true,
            status: 200,
            json: async () => readyTVSnapshot(),
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("useRoom stores Room Magic reactions separately without mutating lastBroadcast or refetching", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const { result } = renderHook(() =>
      useRoom({ roomCode: "ABCDEF", audience: "host" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const fetchCountBefore = fetchMock.mock.calls.length;
    const fromCountBefore = supaMock.client.fromCallCount();

    act(() => {
      supaMock.client.broadcast("room-magic-reaction", roomMagicEvent);
    });

    expect(result.current.lastRoomMagicReaction).toEqual(roomMagicEvent);
    expect(result.current.lastBroadcast).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(fetchCountBefore);
    expect(supaMock.client.fromCallCount()).toBe(fromCountBefore);
  });

  it("useRoom ignores malformed Room Magic reaction payloads", async () => {
    const { result } = renderHook(() =>
      useRoom({ roomCode: "ABCDEF", audience: "host" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      supaMock.client.broadcast("room-magic-reaction", {
        kind: "chat",
        id: roomMagicEvent.id,
        serverNow: roomMagicEvent.serverNow,
      });
    });

    expect(result.current.lastRoomMagicReaction).toBeNull();
  });

  it("useTVRoom stores Room Magic reactions separately without mutating lastBroadcast or refetching", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const { result } = renderHook(() => useTVRoom("ABCDEF"));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    const fetchCountBefore = fetchMock.mock.calls.length;

    act(() => {
      supaMock.client.broadcast("room-magic-reaction", roomMagicEvent);
    });

    expect(result.current.lastRoomMagicReaction).toEqual(roomMagicEvent);
    expect(result.current.lastBroadcast).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(fetchCountBefore);
  });
});
