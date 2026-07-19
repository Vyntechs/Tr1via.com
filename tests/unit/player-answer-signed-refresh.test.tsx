import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoomSnapshotPayload } from "@/lib/room/roomSnapshotPayload";

const h = vi.hoisted(() => {
  const handlers = new Map<string, (message: { payload: unknown }) => void>();
  const fetchSnapshot = vi.fn();
  const client = {
    realtime: { connect: vi.fn(), disconnect: vi.fn() },
    channel: vi.fn(() => {
      const channel = {
        on: vi.fn(
          (
            kind: string,
            filter: { event?: string },
            handler: (message: { payload: unknown }) => void,
          ) => {
            if (kind === "broadcast" && filter.event) {
              handlers.set(filter.event, handler);
            }
            return channel;
          },
        ),
        subscribe: vi.fn((callback?: (status: string) => void) => {
          callback?.("SUBSCRIBED");
          return channel;
        }),
      };
      return channel;
    }),
    removeChannel: vi.fn(),
  };

  return { client, fetchSnapshot, handlers };
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ code: "ABCDEF" }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

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

vi.mock("@/lib/hooks/useDeviceSession", () => ({
  useDeviceSession: () => ({ isReady: true, isLoading: false }),
}));

vi.mock("@/lib/hooks/useTimer", () => ({
  useTimer: () => ({ displaySeconds: 12 }),
}));

vi.mock("@/lib/hooks/useLockCount", () => ({
  useLockCount: () => 1,
}));

vi.mock("@/lib/hooks/useLockInSync", () => ({
  useLockInSync: () => undefined,
}));

vi.mock("@/lib/hooks/usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => false,
}));

import PlayerRoomPage from "@/app/(player)/room/[code]/page";
import { __resetReachabilityForTests } from "@/lib/realtime/reachability";

function payload(
  myAnswers: Extract<RoomSnapshotPayload, { audience: "player" }>["myAnswers"],
): RoomSnapshotPayload {
  return {
    audience: "player",
    night: {
      id: "night-1",
      host_id: "host-1",
      venue_name: "Test Venue",
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
    games: [{
      id: "game-1",
      night_id: "night-1",
      game_no: 1,
      state: "live",
      started_at: "2026-07-18T18:05:00.000Z",
      ended_at: null,
      category_count: 1,
      question_count: 1,
    }],
    categories: [{
      id: "category-1",
      game_id: "game-1",
      name: "Music",
      topic: "Music",
      position: 0,
      color: null,
      state: "ready",
      flavor: null,
      created_at: "2026-07-18T18:00:00.000Z",
    }],
    players: [{
      id: "player-1",
      nightId: "night-1",
      displayName: "Maya",
      joinedAt: "2026-07-18T18:01:00.000Z",
      lastSeenAt: "2026-07-18T18:02:00.000Z",
      removedAt: null,
      appSwitchTotalSeconds: 0,
    }],
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
      prompt: "Pick one",
      source: "manual",
    },
    lastResolvedQuestion: null,
    currentReveal: null,
    allQuestions: [],
    self: {
      id: "player-1",
      nightId: "night-1",
      displayName: "Maya",
      joinedAt: "2026-07-18T18:01:00.000Z",
      lastSeenAt: "2026-07-18T18:02:00.000Z",
      removedAt: null,
      appSwitchTotalSeconds: 0,
    },
    myAnswers,
    myParticipations: [{
      id: "participation-1",
      playerId: "player-1",
      gameId: "game-1",
      joinedAt: "2026-07-18T18:01:00.000Z",
    }],
    scores: [{
      game_id: "game-1",
      player_id: "player-1",
      display_name: "Maya",
      score: 0,
      answered_count: 0,
      correct_count: 0,
      fastest_correct_ms: null,
    }],
    allScores: [],
  };
}

describe("player answer signed snapshot refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    window.localStorage.clear();
    __resetReachabilityForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("waits for the canonical answer row, then immediately enters PlayerLocked", async () => {
    let resolveCanonical!: (value: RoomSnapshotPayload) => void;
    h.fetchSnapshot
      .mockResolvedValueOnce(payload([]))
      .mockImplementationOnce(
        () =>
          new Promise<RoomSnapshotPayload>((resolve) => {
            resolveCanonical = resolve;
          }),
      );
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/answers") return new Response(null, { status: 204 });
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PlayerRoomPage />);
    expect(await screen.findByTestId("player-question")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("player-answer-1"));

    await waitFor(() => expect(h.fetchSnapshot).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("player-question")).toBeInTheDocument();
    expect(screen.queryByTestId("player-locked")).not.toBeInTheDocument();

    await act(async () => {
      resolveCanonical(payload([{
        id: "answer-1",
        questionId: "question-1",
        playerId: "player-1",
        chosenIndex: 0,
        scramble: [0, 1, 2, 3],
        lockedAt: "2026-07-18T18:06:01.000Z",
        msToLock: 1000,
        isCorrect: null,
        awardedPoints: null,
      }]));
    });

    expect(await screen.findByTestId("player-locked")).toBeInTheDocument();
  });

  it("keeps Game 1 standings visible while Game 2 awaits its first question", async () => {
    const signed = payload([]) as Extract<
      RoomSnapshotPayload,
      { audience: "player" }
    >;
    signed.games = [
      { ...signed.games[0], id: "game-1", game_no: 1, state: "done" },
      {
        ...signed.games[0],
        id: "game-2",
        game_no: 2,
        state: "live",
        started_at: "2026-07-18T19:00:00.000Z",
      },
    ];
    signed.myParticipations = [
      ...signed.myParticipations,
      {
        id: "participation-2",
        playerId: "player-1",
        gameId: "game-2",
        joinedAt: "2026-07-18T18:59:00.000Z",
      },
    ];
    signed.scores = [{
      game_id: "game-2",
      player_id: "player-1",
      display_name: "Maya",
      score: 0,
      answered_count: 0,
      correct_count: 0,
      fastest_correct_ms: null,
    }];
    signed.allScores = [{
      game_id: "game-1",
      player_id: "player-1",
      display_name: "Maya",
      score: 500,
      answered_count: 1,
      correct_count: 1,
      fastest_correct_ms: 1000,
    }];
    h.fetchSnapshot.mockResolvedValueOnce(signed);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    render(<PlayerRoomPage />);

    expect(await screen.findByTestId("player-between-games")).toBeInTheDocument();
    expect(screen.getByTestId("standings-you")).toHaveTextContent("500");
  });
});
