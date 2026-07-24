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

  return {
    client,
    fetchSnapshot,
    handlers,
    timerOnZero: null as null | (() => void),
  };
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
  useTimer: (options: { onZero?: () => void }) => {
    h.timerOnZero = options.onZero ?? null;
    return { displaySeconds: 12 };
  },
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
      nightKey: "night-key-1",
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
      playerKey: "player-key-1",
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
      playerKey: "player-key-1",
      displayName: "Maya",
      joinedAt: "2026-07-18T18:01:00.000Z",
      lastSeenAt: "2026-07-18T18:02:00.000Z",
      removedAt: null,
      appSwitchTotalSeconds: 0,
    },
    myAnswers,
    myParticipations: [{
      gameId: "game-1",
      joinedAt: "2026-07-18T18:01:00.000Z",
    }],
    scores: [{
      gameId: "game-1",
      playerKey: "player-key-1",
      displayName: "Maya",
      score: 0,
      answeredCount: 0,
      correctCount: 0,
      fastestCorrectMs: null,
    }],
    allScores: [],
    questionScrambles: { "question-1": [0, 1, 2, 3] },
  };
}

describe("player answer signed snapshot refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    window.localStorage.clear();
    __resetReachabilityForTests();
    h.timerOnZero = null;
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
        questionId: "question-1",
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

  it("coalesces simultaneous transition wake-ups into sequential signed refreshes", async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    h.fetchSnapshot
      .mockResolvedValueOnce(payload([]))
      .mockImplementation(
        () => new Promise<RoomSnapshotPayload>((resolve) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          releases.push(() => {
            active -= 1;
            resolve(payload([]));
          });
        }),
      );
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

    render(<PlayerRoomPage />);
    expect(await screen.findByTestId("player-question")).toBeInTheDocument();
    expect(h.fetchSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      h.handlers.get("reveal")?.({
        payload: {
          questionId: "question-1",
          serverNow: "2026-07-18T18:06:00.000Z",
          revealedAt: "2026-07-18T18:06:00.000Z",
        },
      });
      h.handlers.get("resolve")?.({
        payload: {
          questionId: "question-1",
          serverNow: "2026-07-18T18:06:20.000Z",
          correctIndex: 0,
        },
      });
    });

    // One request is active; the second wake-up is represented by one queued
    // trailing refresh instead of overlapping the first.
    expect(h.fetchSnapshot).toHaveBeenCalledTimes(2);
    expect(active).toBe(1);

    await act(async () => releases.shift()?.());
    await waitFor(() => expect(h.fetchSnapshot).toHaveBeenCalledTimes(3));
    expect(active).toBe(1);
    await act(async () => releases.shift()?.());

    expect(maxActive).toBe(1);
    expect(h.client.channel).toHaveBeenCalledTimes(1);
  });

  it("reconciles the signed score snapshot after this phone's timer resolves", async () => {
    h.fetchSnapshot.mockResolvedValue(payload([]));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      new Response("{}", { status: String(input).endsWith("/resolve") ? 200 : 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<PlayerRoomPage />);
    expect(await screen.findByTestId("player-question")).toBeInTheDocument();
    expect(h.fetchSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => h.timerOnZero?.());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/questions/question-1/resolve",
      expect.objectContaining({ method: "POST" }),
    ));
    await waitFor(() => expect(h.fetchSnapshot).toHaveBeenCalledTimes(2));
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
        gameId: "game-2",
        joinedAt: "2026-07-18T18:59:00.000Z",
      },
    ];
    signed.scores = [{
      gameId: "game-2",
      playerKey: "player-key-1",
      displayName: "Maya",
      score: 0,
      answeredCount: 0,
      correctCount: 0,
      fastestCorrectMs: null,
    }];
    signed.allScores = [{
      gameId: "game-1",
      playerKey: "player-key-1",
      displayName: "Maya",
      score: 500,
      answeredCount: 1,
      correctCount: 1,
      fastestCorrectMs: 1000,
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
