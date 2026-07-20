import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoomSnapshotPayload } from "@/lib/room/roomSnapshotPayload";

const h = vi.hoisted(() => {
  const broadcastHandlers = new Map<string, (message: { payload: unknown }) => void>();
  let activeNightId = "night-a";
  let resilient = false;
  const runId = "11111111-1111-4111-8111-111111111111";

  const nightRow = () => ({
    id: activeNightId,
    host_id: "host-1",
    venue_name: "Venue",
    room_code: activeNightId === "night-a" ? "ABCDEF" : "GHIJKL",
    theme_key: "may",
    room_magic_enabled: true,
    is_locked: false,
    scheduled_at: null,
    opened_at: "2026-07-19T00:00:00.000Z",
    closed_at: null,
    created_at: "2026-07-19T00:00:00.000Z",
    answer_engine: resilient ? "resilient_v1" : "legacy",
    answer_engine_latched_at: resilient ? "2026-07-19T00:00:00.000Z" : null,
    current_run_id: resilient ? runId : null,
    control_revision: resilient ? 5 : 0,
    room_revision: resilient ? 5 : 0,
  });

  const rowsFor = (table: string): Record<string, unknown>[] => {
    if (table === "nights") return [nightRow()];
    if (table === "games") return [{
      id: `game-${activeNightId}`,
      night_id: activeNightId,
      game_no: 1,
      state: "live",
      started_at: "2026-07-19T00:00:00.000Z",
      ended_at: null,
      category_count: 1,
      question_count: 1,
    }];
    if (table === "categories") return [{
      id: `category-${activeNightId}`,
      game_id: `game-${activeNightId}`,
      name: "Music",
      topic: "Music",
      position: 0,
      color: null,
      state: "ready",
    }];
    if (table === "players") return [{
      id: `player-${activeNightId}`,
      night_id: activeNightId,
      device_id: "device-1",
      display_name: "Alice",
      joined_at: "2026-07-19T00:00:00.000Z",
      last_seen_at: "2026-07-19T00:00:01.000Z",
      removed_at: null,
      app_switch_total_seconds: 0,
    }, {
      id: `removed-${activeNightId}`,
      night_id: activeNightId,
      device_id: "device-2",
      display_name: "Removed",
      joined_at: "2026-07-19T00:00:00.000Z",
      last_seen_at: "2026-07-19T00:00:01.000Z",
      removed_at: "2026-07-19T00:00:02.000Z",
      app_switch_total_seconds: 0,
    }];
    if (table === "questions") return [{
      id: `question-${activeNightId}`,
      category_id: `category-${activeNightId}`,
      difficulty: 1,
      fact_blurb: null,
      image_attribution: null,
      image_source: null,
      image_url: null,
      is_picked: true,
      options: ["A", "B", "C", "D"],
      played_at: "2026-07-19T00:00:00.000Z",
      finished_at: null,
      point_value: 100,
      prompt: "Question?",
      source: "manual",
      correct_index: 0,
    }];
    return [];
  };

  function queryBuilder(table: string) {
    let rows = rowsFor(table);
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => {
        if (!column.includes(".")) rows = rows.filter((row) => row[column] === value);
        return builder;
      }),
      is: vi.fn((column: string, value: unknown) => {
        rows = rows.filter((row) => (row[column] ?? null) === value);
        return builder;
      }),
      not: vi.fn((column: string, _operator: string, value: unknown) => {
        rows = rows.filter((row) => (row[column] ?? null) !== value);
        return builder;
      }),
      order: vi.fn(() => builder),
      limit: vi.fn((count: number) => {
        rows = rows.slice(0, count);
        return builder;
      }),
      single: vi.fn(async () => ({ data: rows[0] ?? null, error: null })),
      maybeSingle: vi.fn(async () => ({ data: rows[0] ?? null, error: null })),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return builder;
  }

  const client = {
    realtime: { connect: vi.fn(), disconnect: vi.fn() },
    from: vi.fn((table: string) => queryBuilder(table)),
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
        subscribe: vi.fn((callback?: (status: string) => void) => {
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
    client,
    fetchSnapshot: vi.fn(),
    setActiveNight(nightId: string) {
      activeNightId = nightId;
    },
    setResilient(value: boolean) {
      resilient = value;
    },
    runId,
    reset() {
      activeNightId = "night-a";
      resilient = false;
      broadcastHandlers.clear();
      client.from.mockClear();
      client.channel.mockClear();
      client.removeChannel.mockClear();
      h.fetchSnapshot.mockReset();
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
  useRevalidateOnFocus: () => 0,
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
import { roomToTVSnapshot } from "@/lib/host/roomToTVSnapshot";
import { countHouseLightsLocks } from "@/lib/room-magic/house-lights";

function hostPayload(
  nightId: string,
  tvPlayerKeys: Record<string, string>,
): RoomSnapshotPayload {
  return {
    audience: "host",
    night: { id: nightId },
    tvPlayerKeys,
  } as RoomSnapshotPayload;
}

function resilientHostPayload(revision: number): RoomSnapshotPayload {
  const gameId = "game-night-a";
  return {
    audience: "host",
    night: {
      id: "night-a",
      host_id: "host-1",
      venue_name: "Venue",
      room_code: "ABCDEF",
      theme_key: "may",
      room_magic_enabled: true,
      is_locked: false,
      scheduled_at: null,
      opened_at: "2026-07-19T00:00:00.000Z",
      closed_at: null,
      created_at: "2026-07-19T00:00:00.000Z",
      answer_engine: "resilient_v1",
      answer_engine_latched_at: "2026-07-19T00:00:00.000Z",
      current_run_id: h.runId,
      control_revision: revision,
      room_revision: revision,
    },
    hostDefaultThemeKey: "may",
    games: [{
      id: gameId,
      night_id: "night-a",
      game_no: 1,
      state: "live",
      started_at: "2026-07-19T00:00:00.000Z",
      ended_at: null,
      category_count: 1,
      question_count: 1,
    }],
    categories: [{
      id: "category-night-a",
      game_id: gameId,
      name: "Music",
      topic: "Music",
      position: 0,
      color: null,
      state: "ready",
    }],
    players: [],
    currentQuestion: null,
    lastResolvedQuestion: null,
    currentReveal: null,
    allQuestions: [],
    allScores: [],
    scores: [],
    scoreGameId: gameId,
    tvPlayerKeys: {},
    self: null,
    liveAnswers: [],
    roomMagicReactions: [],
    live: {
      runId: h.runId,
      roomRevision: revision,
      controlRevision: revision,
      playId: null,
      play: null,
      operations: { eligibleCount: 0, confirmedCount: 0, awaitingCount: 0 },
    },
  } as RoomSnapshotPayload;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushBootstrap() {
  await act(async () => {
    for (let index = 0; index < 40; index += 1) await Promise.resolve();
  });
}

function expectInlineIdentityVisible(room: ReturnType<typeof useRoom>) {
  const nightId = room.night?.id ?? "night-a";
  const rawPlayerId = `player-${nightId}`;
  const questionId = `question-${nightId}`;
  const snapshot = roomToTVSnapshot({
    room,
    allQuestions: [],
    scores: [{
      player_id: rawPlayerId,
      display_name: "Alice",
      score: 100,
      correct_count: 1,
      answered_count: 1,
      fastest_correct_ms: 1200,
    } as never],
    answers: [{
      id: "answer-1",
      question_id: questionId,
      player_id: rawPlayerId,
      ms_to_lock: 1200,
      is_correct: null,
      chosen_index: 0,
    }],
  });

  expect(snapshot?.players).toHaveLength(1);
  expect(snapshot?.scores).toHaveLength(1);
  expect(snapshot?.liveAnswers).toHaveLength(1);
  expect(countHouseLightsLocks(snapshot?.liveAnswers ?? [], questionId)).toBe(1);
}

describe("useRoom host TV-key lifecycle", () => {
  beforeEach(() => {
    h.reset();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("GHIJKL")) h.setActiveNight("night-b");
      return {
        ok: true,
        json: async () => ({
          nightId: url.includes("GHIJKL") ? "night-b" : "night-a",
          hostDefaultThemeKey: "may",
        }),
      };
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the inline roster, scores, lock, and House Lights while heartbeat refresh is pending", async () => {
    const heartbeatRefresh = deferred<RoomSnapshotPayload>();
    h.fetchSnapshot
      .mockResolvedValueOnce(hostPayload("night-a", {
        "player-night-a": "pk_tv_a",
      }))
      .mockImplementationOnce(() => heartbeatRefresh.promise);

    const { result } = renderHook(() =>
      useRoom({ roomCode: "ABCDEF", audience: "host" }),
    );
    await flushBootstrap();
    expect(result.current.tvPlayerKeys).toEqual({ "player-night-a": "pk_tv_a" });
    expectInlineIdentityVisible(result.current);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await flushBootstrap();

    expect(h.fetchSnapshot).toHaveBeenCalledTimes(2);
    expect(result.current.tvPlayerKeys).toEqual({ "player-night-a": "pk_tv_a" });
    expectInlineIdentityVisible(result.current);
  });

  it("ignores an older roster refresh that resolves after a newer complete map", async () => {
    const older = deferred<RoomSnapshotPayload>();
    const newer = deferred<RoomSnapshotPayload>();
    h.fetchSnapshot
      .mockResolvedValueOnce(hostPayload("night-a", {
        "player-night-a": "pk_tv_a",
      }))
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    const { result } = renderHook(() =>
      useRoom({ roomCode: "ABCDEF", audience: "host" }),
    );
    await flushBootstrap();

    act(() => {
      h.broadcastHandlers.get("roster-changed")?.({
        payload: { joinToken: "one", serverNow: "2026-07-19T00:00:01.000Z" },
      });
      h.broadcastHandlers.get("roster-changed")?.({
        payload: { joinToken: "two", serverNow: "2026-07-19T00:00:02.000Z" },
      });
    });

    await act(async () => {
      newer.resolve(hostPayload("night-a", {
        "player-night-a": "pk_tv_a",
        "player-night-a-new": "pk_tv_new",
      }));
      await Promise.resolve();
    });
    await flushBootstrap();
    expect(result.current.tvPlayerKeys).toHaveProperty("player-night-a-new", "pk_tv_new");

    await act(async () => {
      older.resolve(hostPayload("night-a", {
        "player-night-a": "pk_tv_a",
      }));
      await Promise.resolve();
    });
    await flushBootstrap();
    expect(result.current.tvPlayerKeys).toHaveProperty("player-night-a-new", "pk_tv_new");
  });

  it("clears the prior room's keys when the actual night changes", async () => {
    const nextNightRefresh = deferred<RoomSnapshotPayload>();
    h.fetchSnapshot
      .mockResolvedValueOnce(hostPayload("night-a", {
        "player-night-a": "pk_tv_a",
      }))
      .mockImplementationOnce(() => nextNightRefresh.promise);

    const { result, rerender } = renderHook(
      ({ roomCode }) => useRoom({ roomCode, audience: "host" }),
      { initialProps: { roomCode: "ABCDEF" } },
    );
    await flushBootstrap();
    expect(result.current.tvPlayerKeys).toEqual({ "player-night-a": "pk_tv_a" });

    rerender({ roomCode: "GHIJKL" });
    await flushBootstrap();

    expect(result.current.night?.id).toBe("night-b");
    expect(result.current.tvPlayerKeys).toEqual({});
  });

  it("retained keys never resurrect a removed player", async () => {
    h.fetchSnapshot.mockResolvedValue(hostPayload("night-a", {
      "player-night-a": "pk_tv_a",
      "removed-night-a": "pk_tv_removed",
    }));
    const { result } = renderHook(() =>
      useRoom({ roomCode: "ABCDEF", audience: "host" }),
    );
    await flushBootstrap();

    const snapshot = roomToTVSnapshot({
      room: result.current,
      allQuestions: [],
      scores: [],
      answers: [],
    });
    expect(snapshot?.players.map((player) => player.id)).toEqual(["pk_tv_a"]);
  });

  it("treats resilient broadcasts only as validated wake-ups for a newer signed host snapshot", async () => {
    h.setResilient(true);
    h.fetchSnapshot
      .mockResolvedValueOnce(resilientHostPayload(5))
      .mockResolvedValueOnce(resilientHostPayload(5))
      .mockResolvedValueOnce(resilientHostPayload(6));
    const { result } = renderHook(() =>
      useRoom({ roomCode: "ABCDEF", audience: "host" }),
    );
    await flushBootstrap();

    expect(result.current.live?.roomRevision).toBe(5);
    expect(h.fetchSnapshot).toHaveBeenCalledTimes(1);

    act(() => {
      h.broadcastHandlers.get("live-room-event")?.({
        payload: { live: { runId: h.runId, roomRevision: 5 } },
      });
      h.broadcastHandlers.get("live-room-event")?.({
        payload: { live: { runId: "22222222-2222-4222-8222-222222222222", roomRevision: 99 } },
      });
    });
    await flushBootstrap();
    expect(h.fetchSnapshot).toHaveBeenCalledTimes(1);

    act(() => {
      h.broadcastHandlers.get("live-room-event")?.({
        payload: { live: { runId: h.runId, roomRevision: 6 } },
      });
    });
    await flushBootstrap();

    expect(h.fetchSnapshot).toHaveBeenCalledTimes(2);
    expect(result.current.live?.roomRevision).toBe(5);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await flushBootstrap();

    expect(h.fetchSnapshot).toHaveBeenCalledTimes(3);
    expect(result.current.live?.roomRevision).toBe(6);
    expect(result.current.scoreGameId).toBe("game-night-a");
  });
});
