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
    timerExpired: false,
    expiredListeners: new Set<() => void>(),
    setExpired(value: boolean) {
      this.timerExpired = value;
      for (const listener of this.expiredListeners) listener();
    },
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

vi.mock("@/lib/hooks/useTimer", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useTimer: (options: { onZero?: () => void }) => {
      h.timerOnZero = options.onZero ?? null;
      const expired = useSyncExternalStore(
        (listener) => {
          h.expiredListeners.add(listener);
          return () => h.expiredListeners.delete(listener);
        },
        () => h.timerExpired,
        () => h.timerExpired,
      );
      return {
        displaySeconds: expired ? 0 : 12,
        hasExpired: expired,
      };
    },
  };
});

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
    h.timerExpired = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const savedAnswer = (msToLock = 1000) => ({
    questionId: "question-1",
    chosenIndex: 0 as const,
    scramble: [0, 1, 2, 3] as [number, number, number, number],
    lockedAt: "2026-07-18T18:06:01.000Z",
    msToLock,
    isCorrect: null,
    awardedPoints: null,
  });

  const sendState = () => screen.getByTestId("player-send-status");

  it("locks the tapped answer on the same tap and says Sending until the server replies", async () => {
    h.fetchSnapshot.mockResolvedValue(payload([]));
    // The send never gets a reply: everything below happens before the server says anything.
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    render(<PlayerRoomPage />);
    expect(await screen.findByTestId("player-question")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("player-answer-1"));

    // Same frame: the locked screen is up, the question screen is gone, and the
    // phone says it is sending (not locked in) without claiming a time.
    expect(screen.getByTestId("player-locked")).toBeInTheDocument();
    expect(screen.queryByTestId("player-question")).not.toBeInTheDocument();
    expect(sendState()).toHaveAttribute("data-send-state", "sending");
    expect(sendState()).toHaveTextContent("Sending…");
    expect(sendState()).not.toHaveTextContent(/locked/i);
    expect(screen.queryByText(/speed bonus/i)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/answers", expect.objectContaining({ method: "POST" }));
  });

  it("says Locked in from the send reply alone, then the saved row fills in on the same screen", async () => {
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
    const lockedScreen = screen.getByTestId("player-locked");

    // The send reply says yes. The signed room fetch has NOT come back, and
    // the screen already says Locked in.
    await waitFor(() => expect(sendState()).toHaveAttribute("data-send-state", "locked"));
    expect(sendState()).toHaveTextContent("Locked in");
    expect(sendState()).not.toHaveTextContent("Locked at");
    await waitFor(() => expect(h.fetchSnapshot).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("player-locked")).toBe(lockedScreen);

    // The saved row arrives: the real lock time fills in, on the very same
    // screen element (nothing is rebuilt, so nothing can flicker).
    await act(async () => {
      resolveCanonical(payload([savedAnswer(2300)]));
    });
    await waitFor(() => expect(sendState()).toHaveTextContent("2.3s"));
    expect(sendState()).toHaveTextContent("LOCKED AT");
    expect(screen.getByTestId("player-locked")).toBe(lockedScreen);
  });

  it("keeps the choice on screen and says it is retrying when the send does not go through", async () => {
    h.fetchSnapshot.mockResolvedValue(payload([]));
    let answers = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) !== "/api/answers") return new Response("{}", { status: 200 });
      answers += 1;
      if (answers < 3) throw new TypeError("Failed to fetch");
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PlayerRoomPage />);
    expect(await screen.findByTestId("player-question")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("player-answer-1"));
    const lockedScreen = screen.getByTestId("player-locked");

    await waitFor(() => expect(sendState()).toHaveAttribute("data-send-state", "retrying"));
    expect(sendState()).toHaveTextContent("Didn’t go through — retrying");
    expect(screen.getByTestId("player-locked")).toBe(lockedScreen);

    await waitFor(() => expect(sendState()).toHaveAttribute("data-send-state", "locked"), { timeout: 5000 });
    expect(answers).toBe(3);
    expect(screen.getByTestId("player-locked")).toBe(lockedScreen);
  });

  it("when the question closes with the answer never confirmed, says so plainly and stops trying", async () => {
    h.fetchSnapshot.mockResolvedValue(payload([]));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/answers") throw new TypeError("Failed to fetch");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PlayerRoomPage />);
    expect(await screen.findByTestId("player-question")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("player-answer-1"));
    await waitFor(() => expect(sendState()).toHaveAttribute("data-send-state", "retrying"));

    act(() => h.setExpired(true));

    expect(sendState()).toHaveAttribute("data-send-state", "unconfirmed");
    expect(sendState()).toHaveTextContent(/time’s up/i);
    expect(sendState()).toHaveTextContent("We couldn’t confirm your answer");
    expect(sendState()).not.toHaveTextContent("Locked in");
    const sends = () => fetchMock.mock.calls.filter(([url]) => String(url) === "/api/answers").length;
    const before = sends();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(sends()).toBe(before);
  });

  it("sends one answer when the player taps twice", async () => {
    h.fetchSnapshot.mockResolvedValue(payload([]));
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    render(<PlayerRoomPage />);
    expect(await screen.findByTestId("player-question")).toBeInTheDocument();

    const first = screen.getByTestId("player-answer-1");
    const other = screen.getByTestId("player-answer-3");
    fireEvent.click(first);
    fireEvent.click(first); // the same (now replaced) card, again
    fireEvent.click(other);
    fireEvent.keyDown(document, { key: "2" });

    const posts = fetchMock.mock.calls.filter(([url]) => String(url) === "/api/answers");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1]!.body))).toMatchObject({
      slotChosen: 1,
    });
  });

  it("shows the saved answer straight away on a refresh, without sending again", async () => {
    h.fetchSnapshot.mockResolvedValue(payload([savedAnswer(1800)]));
    window.localStorage.setItem(
      "tr1via:pending-answer",
      JSON.stringify({ questionId: "question-1", slotChosen: 1 }),
    );
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<PlayerRoomPage />);

    expect(await screen.findByTestId("player-locked")).toBeInTheDocument();
    expect(sendState()).toHaveTextContent("LOCKED AT");
    expect(sendState()).toHaveTextContent("1.8s");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/answers", expect.anything());
  });

  it("does not send touch or keyboard answers when the timer is at zero", async () => {
    h.timerExpired = true;
    h.fetchSnapshot.mockResolvedValue(payload([]));
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<PlayerRoomPage />);
    expect(await screen.findByTestId("player-question")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("player-answer-1"));
    fireEvent.keyDown(document, { key: "1" });

    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/answers",
      expect.anything(),
    );
    expect(screen.getByTestId("player-answer-1").tagName).toBe("DIV");
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
