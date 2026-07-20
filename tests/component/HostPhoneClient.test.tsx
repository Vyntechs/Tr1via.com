import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HostPhoneClient } from "@/app/host/phone/[nightId]/HostPhoneClient";
import type { RoomSnapshot } from "@/lib/hooks/useRoom";
import type {
  AnswerRow,
  CategoryRow,
  GameRow,
  GameScoreRow,
  NightRow,
  PlayerRow,
  QuestionRow,
} from "@/lib/supabase/types";
import type { RoomFallbackPayload } from "@/lib/room/roomSnapshotPayload";
import type { HostLiveProjection } from "@/lib/live-answer/contracts";

const h = vi.hoisted(() => ({
  room: null as RoomSnapshot | null,
  questions: [] as QuestionRow[],
  fetch: vi.fn(),
  refresh: vi.fn(),
  scoreRows: [] as GameScoreRow[],
  scoreChangeHandlers: [] as Array<() => void>,
  fallback: { backupMode: false, payload: null as RoomFallbackPayload | null },
  autoRevealOptions: null as {
    decision: { complete: boolean; eligibleCount: number; lockedCount: number } | null;
    onAutoReveal: () => unknown;
  } | null,
}));

const RUN_ID = "33333333-3333-4333-8333-333333333333";
const COMMAND_ID = "44444444-4444-4444-8444-444444444444" as `${string}-${string}-${string}-${string}-${string}`;
const SECOND_COMMAND_ID = "55555555-5555-4555-8555-555555555555" as `${string}-${string}-${string}-${string}-${string}`;
const PLAY_ID = "66666666-6666-4666-8666-666666666666";

vi.mock("@/lib/hooks/useRoom", () => ({
  useRoom: () => h.room,
}));

vi.mock("@/lib/hooks/useTimer", () => ({
  useTimer: () => ({ secondsRemaining: 14 }),
}));

vi.mock("@/lib/room/roomFallbackStore", () => ({
  useRoomFallback: () => h.fallback,
}));

vi.mock("@/lib/hooks/useAllLockedAutoReveal", () => ({
  useAllLockedAutoReveal: (options: typeof h.autoRevealOptions) => {
    h.autoRevealOptions = options;
  },
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => ({
    from: (table: string) => {
      if (table === "categories") {
        return {
          select: () => ({
            in: async () => ({ data: [{ id: "c1" }] }),
          }),
        };
      }
      if (table === "questions") {
        return {
          select: () => ({
            in: () => ({
              eq: async () => ({ data: h.questions }),
            }),
          }),
        };
      }
      if (table === "game_scores") {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: h.scoreRows, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: async () => ({ data: [] }),
        }),
      };
    },
    channel: () => {
      const channel = {
        on: (
          _event: string,
          filter: { table?: string },
          handler: () => void,
        ) => {
          if (filter.table === "adjustments") h.scoreChangeHandlers.push(handler);
          return channel;
        },
        subscribe: () => ({}),
      };
      return channel;
    },
    removeChannel: () => undefined,
  }),
}));

const night: NightRow = {
  id: "night-1",
  host_id: "host-1",
  venue_name: "Soul Fire Pizza",
  room_code: "ABC123",
  scheduled_at: "2026-07-08T00:00:00Z",
  opened_at: "2026-07-08T00:00:00Z",
  closed_at: null,
  theme_key: "house",
  is_locked: false,
  room_magic_enabled: false,
  created_at: "2026-07-08T00:00:00Z",
};

function resilientNight(overrides: Partial<NightRow> = {}): NightRow {
  return {
    ...night,
    answer_engine: "resilient_v1",
    current_run_id: RUN_ID,
    control_revision: 4,
    ...overrides,
  };
}

function resilientLive(overrides: Partial<HostLiveProjection> = {}): HostLiveProjection {
  return {
    runId: RUN_ID,
    roomRevision: 8,
    controlRevision: 5,
    playId: PLAY_ID,
    play: {
      playId: PLAY_ID,
      gameId: "g1",
      questionId: "q1",
      state: "accepting",
      openedAt: "2026-07-08T00:01:30Z",
      mainZeroAt: "2026-07-08T00:02:00Z",
      finalWindowStartsAt: null,
      finalWindowEndsAt: "2026-07-08T00:02:02Z",
      finalizeAt: null,
      eligibleCount: 2,
      confirmedCount: 1,
    },
    operations: { eligibleCount: 2, confirmedCount: 1, awaitingCount: 1 },
    ...overrides,
  };
}

const readyGame: GameRow = {
  id: "g1",
  night_id: "night-1",
  game_no: 1,
  state: "ready",
  started_at: null,
  ended_at: null,
  category_count: 1,
  question_count: 1,
};

function game(
  id: string,
  gameNo: 1 | 2,
  state: GameRow["state"],
): GameRow {
  return {
    ...readyGame,
    id,
    game_no: gameNo,
    state,
    started_at: state === "live" || state === "done" ? "2026-07-08T00:01:00Z" : null,
    ended_at: state === "done" ? `2026-07-08T00:0${gameNo + 1}:00Z` : null,
  };
}

const readyCategory: CategoryRow = {
  id: "c1",
  game_id: "g1",
  name: "Salsa",
  topic: "Salsa",
  position: 0,
  color: "#E64A8C",
  state: "ready",
  flavor: null,
  created_at: "2026-07-08T00:00:00Z",
};

const pickedQuestion: QuestionRow = {
  id: "q1",
  category_id: "c1",
  prompt: "Which salsa dance originated in New York City?",
  options: ["Salsa on 2", "Tango", "Foxtrot", "Waltz"],
  correct_index: 0,
  difficulty: 1,
  point_value: 100,
  fact_blurb: null,
  image_url: null,
  image_attribution: null,
  image_source: null,
  is_picked: true,
  played_at: null,
  finished_at: null,
  source: "ai",
};

const secondPickedQuestion: QuestionRow = {
  ...pickedQuestion,
  id: "q2",
  prompt: "Which salsa style is danced in a circular pattern?",
  point_value: 200,
  difficulty: 2,
};

const player = (id: string): PlayerRow => ({
  id,
  night_id: "night-1",
  device_id: `device-${id}`,
  display_name: `Player ${id}`,
  joined_at: "2026-07-08T00:00:00Z",
  last_seen_at: "2026-07-08T00:00:00Z",
  removed_at: null,
  app_switch_total_seconds: 0,
  can_answer: true,
});

const answer = (id: string, playerId: string): AnswerRow => ({
  id,
  question_id: "q1",
  player_id: playerId,
  chosen_index: 0,
  scramble: [0, 1, 2, 3],
  locked_at: "2026-07-08T00:01:35Z",
  ms_to_lock: 5_000,
  is_correct: null,
  awarded_points: null,
});

const score = (playerId: string): GameScoreRow => ({
  game_id: "g1",
  player_id: playerId,
  display_name: `Player ${playerId}`,
  score: 0,
  answered_count: 0,
  correct_count: 0,
  fastest_correct_ms: null,
});

function fallbackPayload(overrides: Partial<RoomFallbackPayload> = {}): RoomFallbackPayload {
  return {
    night,
    hostDefaultThemeKey: "house",
    games: [readyGame],
    categories: [readyCategory],
    players: [],
    currentQuestion: null,
    lastResolvedQuestion: null,
    currentReveal: null,
    allQuestions: [],
    myAnswers: [],
    myParticipations: [],
    allScores: [],
    scores: [],
    scoreGameId: "g1",
    tvPlayerKeys: {},
    liveAnswers: [],
    roomMagicReactions: [],
    ...overrides,
  };
}

function room(): RoomSnapshot {
  return {
    night,
    games: [readyGame],
    categories: [readyCategory],
    players: [],
    currentGame: readyGame,
    currentQuestion: null,
    currentReveal: null,
    lastResolvedQuestion: null,
    lastBroadcast: null,
    lastFireworksBeat: null,
    lastRoomMagicReaction: null,
    hostDefaultThemeKey: "house",
    requestRefresh: h.refresh,
    isLoading: false,
  };
}

function preflightResponse(overrides: Record<string, unknown> = {}) {
  return {
    checks: {
      content: "ready",
      tv: "unknown",
      players: "unknown",
      network: "control-path-healthy",
      controls: "ready",
    },
    canStart: true,
    startReason: null,
    checkedAt: "2026-07-20T12:00:00.000Z",
    elapsedMs: 37,
    playerCount: 0,
    content: {
      gameId: "g1",
      categoryCount: 1,
      expectedCategoryCount: 1,
      pickedQuestionCount: 1,
      expectedQuestionCount: 1,
      reason: null,
    },
    ...overrides,
  };
}

describe("HostPhoneClient reveal flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const liveGame = game("g1", 1, "live");
    h.room = { ...room(), games: [liveGame], currentGame: liveGame };
    h.questions = [pickedQuestion, secondPickedQuestion];
    h.fetch.mockReset();
    h.refresh.mockReset();
    h.scoreRows = [];
    h.scoreChangeHandlers = [];
    h.fallback = { backupMode: false, payload: null };
    h.autoRevealOptions = null;
    h.fetch.mockImplementation(async (input: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(input) === "/api/nights/night-1/preflight"
            ? preflightResponse()
            : { ok: true },
        ),
        { status: 200 },
      ));
    vi.stubGlobal("fetch", h.fetch);
  });

  it("shows the shared backup board without privately previewing a question until selection", async () => {
    const fallbackQuestion = {
      ...pickedQuestion,
      id: "fallback-q",
      prompt: "Fallback-only private prompt",
    };
    h.questions = [pickedQuestion];
    h.fallback = {
      backupMode: true,
      payload: fallbackPayload({ allQuestions: [fallbackQuestion] }),
    };

    const view = render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );
    expect(await screen.findByRole("grid", { name: "Question board" })).toBeVisible();
    expect(screen.queryByText(fallbackQuestion.prompt)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salsa for 100 points" }));
    expect(await screen.findByText(fallbackQuestion.prompt)).toBeVisible();

    const liveGame = game("g1", 1, "live");
    const liveQuestion = { ...pickedQuestion, played_at: "2026-07-08T00:01:30Z" };
    h.room = {
      ...room(),
      games: [liveGame],
      currentGame: liveGame,
      currentQuestion: liveQuestion,
      players: [player("p1"), player("p2")],
    };
    h.fallback = {
      backupMode: true,
      payload: fallbackPayload({
        games: [liveGame],
        currentQuestion: liveQuestion,
        players: h.room.players,
        liveAnswers: [answer("a1", "p1")],
        scores: [score("p1"), score("p2")],
      }),
    };
    view.rerender(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    expect(await screen.findByText("1 of 2 locked")).toBeVisible();
  });

  it("uses shared eligibility to auto-end only when every eligible player is locked", async () => {
    const liveGame = game("g1", 1, "live");
    const liveQuestion = { ...pickedQuestion, played_at: "2026-07-08T00:01:30Z" };
    const players = [player("p1"), player("p2")];
    h.room = {
      ...room(),
      games: [liveGame],
      currentGame: liveGame,
      currentQuestion: liveQuestion,
      players,
    };
    h.fallback = {
      backupMode: true,
      payload: fallbackPayload({
        games: [liveGame],
        currentQuestion: liveQuestion,
        players,
        liveAnswers: [answer("a1", "p1"), answer("a2", "p2")],
        scores: [score("p1"), score("p2")],
      }),
    };

    render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    await waitFor(() => expect(h.autoRevealOptions?.decision?.complete).toBe(true));
    expect(h.autoRevealOptions?.decision).toMatchObject({
      eligibleCount: 2,
      lockedCount: 2,
    });
    await h.autoRevealOptions?.onAutoReveal();
    expect(h.fetch).toHaveBeenCalledWith(
      "/api/games/g1/end-early",
      expect.objectContaining({
        body: JSON.stringify({ questionId: "q1", requireAllLocked: true }),
      }),
    );
  });

  it("uses only authoritative resilient play counts for lock display and auto-reveal", async () => {
    const liveGame = game("g1", 1, "live");
    const liveQuestion = { ...pickedQuestion, played_at: "2026-07-08T00:01:30Z" };
    h.room = {
      ...room(),
      night: resilientNight({ control_revision: 5 }),
      games: [liveGame],
      currentGame: liveGame,
      currentQuestion: liveQuestion,
      players: [player("p1"), player("p2"), player("late")],
      liveAnswers: [],
      live: resilientLive({
        play: { ...resilientLive().play!, eligibleCount: 2, confirmedCount: 2 },
        operations: { eligibleCount: 2, confirmedCount: 2, awaitingCount: 0 },
      }),
    };
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(COMMAND_ID);

    render(
      <HostPhoneClient nightId="night-1" roomCode="ABC123" hostName="Heather Moore" themeKey="house" />,
    );

    expect(await screen.findByText("2 of 2 locked")).toBeVisible();
    await waitFor(() => expect(h.autoRevealOptions?.decision).toMatchObject({
      complete: true,
      eligibleCount: 2,
      lockedCount: 2,
    }));
    await h.autoRevealOptions?.onAutoReveal();
    expect(h.fetch).toHaveBeenCalledWith(
      "/api/games/g1/end-early",
      expect.objectContaining({
        body: JSON.stringify({
          playId: PLAY_ID,
          runId: RUN_ID,
          commandId: COMMAND_ID,
          expectedControlRevision: 5,
        }),
      }),
    );
  });

  it("reveals the exact selected question after Game 1 has started", async () => {
    render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Salsa for 200 points" }));
    expect(screen.getByText(secondPickedQuestion.prompt)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show question" }));

    await waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1));
    expect(h.fetch.mock.calls[0][0]).toBe("/api/games/g1/reveal");
    expect(h.fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ questionId: "q2" }),
    });
  });

  it("starts a ready resilient game with authoritative control metadata before revealing", async () => {
    const live = game("g1", 1, "live");
    h.room = {
      ...room(),
      night: resilientNight(),
      games: [live],
      currentGame: live,
    };
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(COMMAND_ID)
      .mockReturnValueOnce(SECOND_COMMAND_ID);
    h.fetch.mockImplementation(async (input: RequestInfo | URL) => new Response(
      JSON.stringify(String(input).endsWith("/start")
        ? {
            code: "applied",
            applied: true,
            eventKind: "game_started",
            runId: RUN_ID,
            gameId: "g1",
            roomRevision: 5,
            controlRevision: 5,
          }
        : {
            code: "applied",
            applied: true,
            eventKind: "play_opened",
            runId: RUN_ID,
            gameId: "g1",
            playId: PLAY_ID,
            roomRevision: 6,
            controlRevision: 6,
          }),
      { status: 200 },
    ));

    render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Salsa for 100 points" }));
    live.state = "ready";
    live.started_at = null;
    fireEvent.click(screen.getByRole("button", { name: "Show question" }));

    await waitFor(() => expect(h.fetch).toHaveBeenCalledWith(
      "/api/games/g1/start",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: RUN_ID,
          commandId: COMMAND_ID,
          expectedControlRevision: 4,
        }),
      },
    ));
    expect(h.fetch.mock.calls.findIndex(([url]) => url === "/api/games/g1/start")).toBeLessThan(
      h.fetch.mock.calls.findIndex(([url]) => url === "/api/games/g1/reveal"),
    );
    expect(h.fetch).toHaveBeenCalledWith(
      "/api/games/g1/reveal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: "q1",
          runId: RUN_ID,
          commandId: SECOND_COMMAND_ID,
          expectedControlRevision: 5,
        }),
      },
    );
  });

  it("sends exact resilient bodies with a fresh command for reveal, end early, and undo", async () => {
    const liveGame = game("g1", 1, "live");
    const liveQuestion = { ...pickedQuestion, played_at: "2026-07-08T00:01:30Z" };
    h.room = {
      ...room(),
      night: resilientNight({ control_revision: 5 }),
      games: [liveGame],
      currentGame: liveGame,
      currentQuestion: null,
      live: resilientLive(),
    };
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(COMMAND_ID)
      .mockReturnValueOnce(SECOND_COMMAND_ID)
      .mockReturnValueOnce(COMMAND_ID);

    const view = render(
      <HostPhoneClient nightId="night-1" roomCode="ABC123" hostName="Heather Moore" themeKey="house" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Salsa for 100 points" }));
    fireEvent.click(screen.getByRole("button", { name: "Show question" }));
    await waitFor(() => expect(h.fetch).toHaveBeenCalledWith(
      "/api/games/g1/reveal",
      expect.objectContaining({
        body: JSON.stringify({
          questionId: "q1",
          runId: RUN_ID,
          commandId: COMMAND_ID,
          expectedControlRevision: 5,
        }),
      }),
    ));

    h.room = { ...h.room, currentQuestion: liveQuestion };
    view.rerender(
      <HostPhoneClient nightId="night-1" roomCode="ABC123" hostName="Heather Moore" themeKey="house" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /End early/i }));
    await waitFor(() => expect(h.fetch).toHaveBeenCalledWith(
      "/api/games/g1/end-early",
      expect.objectContaining({
        body: JSON.stringify({
          playId: PLAY_ID,
          runId: RUN_ID,
          commandId: SECOND_COMMAND_ID,
          expectedControlRevision: 5,
        }),
      }),
    ));

    fireEvent.click(screen.getByRole("button", { name: /Undo/i }));
    await waitFor(() => expect(h.fetch).toHaveBeenCalledWith(
      "/api/games/g1/undo",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playId: PLAY_ID,
          runId: RUN_ID,
          commandId: COMMAND_ID,
          expectedControlRevision: 5,
        }),
      },
    ));
    expect(new Set([COMMAND_ID, SECOND_COMMAND_ID]).size).toBe(2);
  });

  it("sends the exact resilient End Game body", async () => {
    const liveGame = game("g1", 1, "live");
    h.room = {
      ...room(),
      night: resilientNight({ control_revision: 5 }),
      games: [liveGame],
      currentGame: liveGame,
      live: resilientLive({
        playId: null,
        play: null,
        operations: { eligibleCount: 0, confirmedCount: 0, awaitingCount: 0 },
      }),
    };
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(COMMAND_ID);
    render(
      <HostPhoneClient nightId="night-1" roomCode="ABC123" hostName="Heather Moore" themeKey="house" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "End Game 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm end Game 1" }));
    await waitFor(() => expect(h.fetch).toHaveBeenCalledWith(
      "/api/games/g1/end",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: RUN_ID,
          commandId: COMMAND_ID,
          expectedControlRevision: 5,
        }),
      },
    ));
  });

  it("fails visibly before fetch when resilient play command metadata is absent", async () => {
    const liveGame = game("g1", 1, "live");
    const liveQuestion = { ...pickedQuestion, played_at: "2026-07-08T00:01:30Z" };
    h.room = {
      ...room(),
      night: resilientNight({ control_revision: 5 }),
      games: [liveGame],
      currentGame: liveGame,
      currentQuestion: liveQuestion,
      live: resilientLive({ playId: null, play: null }),
    };
    render(
      <HostPhoneClient nightId="night-1" roomCode="ABC123" hostName="Heather Moore" themeKey="house" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /End early/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/control metadata is not ready/i);
    expect(h.fetch.mock.calls.some(([url]) => url === "/api/games/g1/end-early")).toBe(false);
  });

  it("treats a 200 rejected resilient command as a visible failure and refreshes canonical state", async () => {
    const liveGame = game("g1", 1, "live");
    h.room = {
      ...room(),
      night: resilientNight({ control_revision: 5 }),
      games: [liveGame],
      currentGame: liveGame,
      live: resilientLive(),
    };
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(COMMAND_ID);
    h.fetch.mockImplementation(async () => new Response(
      JSON.stringify({ code: "stale", applied: false }),
      { status: 200 },
    ));

    render(
      <HostPhoneClient nightId="night-1" roomCode="ABC123" hostName="Heather Moore" themeKey="house" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Salsa for 100 points" }));
    fireEvent.click(screen.getByRole("button", { name: "Show question" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/changed before this command could be applied/i);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("returns from private preview to the board without revealing", async () => {
    render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Salsa for 100 points" }));
    expect(screen.getByText(pickedQuestion.prompt)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back to board" }));

    expect(screen.getByRole("grid", { name: "Question board" })).toBeVisible();
    expect(screen.queryByText(pickedQuestion.prompt)).not.toBeInTheDocument();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("marks the preview private and shows answer, host note, and image readiness", async () => {
    const previewQuestion = {
      ...pickedQuestion,
      fact_blurb: "New York dancers developed the style in the 1970s.",
      image_url: "https://images.example/salsa.jpg",
      image_attribution: "Photo by Casey",
    };
    h.fallback = {
      backupMode: true,
      payload: fallbackPayload({ allQuestions: [previewQuestion] }),
    };
    render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="march"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Salsa for 100 points" }));
    expect(screen.getByText("Private on Heather’s phone · Not on TV")).toBeVisible();
    expect(screen.getByText("Correct")).toBeVisible();
    expect(screen.getByText(previewQuestion.fact_blurb)).toBeVisible();
    expect(screen.getByRole("img", { name: "Question image preview" })).toHaveAttribute(
      "src",
      expect.stringContaining("salsa.jpg"),
    );
    expect(screen.getByText("Image ready")).toBeVisible();
    expect(screen.queryByText(/room/i)).not.toBeInTheDocument();
  });

  it("clears a selection when that question becomes played", async () => {
    h.fallback = {
      backupMode: true,
      payload: fallbackPayload({ allQuestions: [pickedQuestion, secondPickedQuestion] }),
    };
    const view = render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Salsa for 100 points" }));
    expect(screen.getByText(pickedQuestion.prompt)).toBeVisible();

    h.fallback = {
      backupMode: true,
      payload: fallbackPayload({
        allQuestions: [
          { ...pickedQuestion, played_at: "2026-07-19T01:00:00Z" },
          secondPickedQuestion,
        ],
      }),
    };
    view.rerender(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    expect(await screen.findByRole("grid", { name: "Question board" })).toBeVisible();
    expect(screen.queryByText(pickedQuestion.prompt)).not.toBeInTheDocument();
  });

  it("clears a selection when control advances to another game", async () => {
    const game1 = game("g1", 1, "live");
    const game2 = game("g2", 2, "ready");
    const game2Category: CategoryRow = {
      ...readyCategory,
      id: "c2",
      game_id: "g2",
      name: "Movies",
      topic: "Movies",
    };
    const game2Question: QuestionRow = {
      ...pickedQuestion,
      id: "q-game-2",
      category_id: "c2",
      prompt: "Which movie won Best Picture?",
    };
    h.room = { ...room(), games: [game1, game2], currentGame: game1 };
    h.fallback = {
      backupMode: true,
      payload: fallbackPayload({ games: [game1, game2], allQuestions: [pickedQuestion, game2Question] }),
    };
    const view = render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Salsa for 100 points" }));
    expect(screen.getByText(pickedQuestion.prompt)).toBeVisible();

    h.room = {
      ...h.room,
      games: [{ ...game1, state: "done" }, game2],
      categories: [readyCategory, game2Category],
      currentGame: { ...game1, state: "done" },
    };
    view.rerender(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    expect(await screen.findByRole("heading", { name: "Game 2 is ready" })).toBeVisible();
    expect(screen.queryByText(pickedQuestion.prompt)).not.toBeInTheDocument();

    const liveGame2 = { ...game2, state: "live" as const, started_at: "2026-07-08T00:03:00Z" };
    h.room = { ...h.room, games: [{ ...game1, state: "done" }, liveGame2], currentGame: liveGame2 };
    view.rerender(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );
    expect(await screen.findByRole("button", { name: "Movies for 100 points" })).toBeVisible();
    expect(screen.queryByText(pickedQuestion.prompt)).not.toBeInTheDocument();
  });

  it("provides honest Board, Players, Scores, and TV destinations", async () => {
    const liveGame = game("g1", 1, "live");
    h.room = { ...room(), games: [liveGame], currentGame: liveGame, players: [player("p1")] };
    render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    expect(await screen.findByRole("navigation", { name: "Host controls" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Players" }));
    expect(screen.getByRole("heading", { name: "Players" })).toBeVisible();
    expect(screen.getByText("Player p1")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Scores" }));
    expect(screen.getByRole("heading", { name: "Game 1 standings" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "TV" }));
    expect(screen.getByRole("heading", { name: "Venue TV" })).toBeVisible();
    const venueTVLink = screen.getByRole("link", { name: "Open venue TV" });
    expect(venueTVLink).toHaveAttribute("href", "/tv/ABC123");
    expect(venueTVLink).toHaveStyle({
      display: "inline-flex",
      minHeight: "48px",
      minWidth: "48px",
    });

    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(screen.getByRole("grid", { name: "Question board" })).toBeVisible();
  });

  it("does not claim TV or phone delivery without observation receipts", async () => {
    h.room = {
      ...room(),
      night: resilientNight(),
      deliveryRevision: {
        runId: RUN_ID,
        roomRevision: 8,
        controlRevision: 4,
        playId: null,
      },
      players: [player("p1")],
    };
    render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    expect(await screen.findByText("Sending…")).toBeVisible();
    expect(screen.queryByText("TV live")).not.toBeInTheDocument();
    expect(screen.queryByText(/phones live/)).not.toBeInTheDocument();
  });

  it("keeps every lifecycle and TV command at least 48px tall", async () => {
    h.room = room();
    const view = render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    expect(await screen.findByRole("button", { name: "Start Game 1" })).toHaveStyle({ minHeight: "48px" });
    expect(screen.getByRole("link", { name: "Open venue screen" })).toHaveStyle({ minHeight: "48px" });

    const liveGame = game("g1", 1, "live");
    h.room = { ...room(), games: [liveGame], currentGame: liveGame };
    view.rerender(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "End Game 1" }));
    expect(screen.getByRole("button", { name: "Keep playing" })).toHaveStyle({ minHeight: "48px" });
    expect(screen.getByRole("button", { name: "Confirm end Game 1" })).toHaveStyle({ minHeight: "48px" });
  });

  it("uses game-control fallback copy when no game is available and when a lifecycle request fails", async () => {
    h.room = { ...room(), games: [], categories: [], currentGame: null };
    const view = render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );
    expect(await screen.findByText("GAME CONTROL")).toBeVisible();
    expect(screen.queryByText(/show control/i)).not.toBeInTheDocument();

    h.room = room();
    view.rerender(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );
    const start = await screen.findByRole("button", { name: "Start Game 1" });
    h.fetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 }));
    fireEvent.click(start);
    expect(await screen.findByRole("alert")).toHaveTextContent("game control failed");
    expect(screen.getByRole("button", { name: "Dismiss" })).toHaveStyle({
      minHeight: "48px",
      minWidth: "48px",
    });
    expect(screen.queryByText(/show control/i)).not.toBeInTheDocument();
  });

  it("keeps the private-preview API limited to live call-site data", () => {
    const source = readFileSync(
      join(process.cwd(), "components/host/HostPhoneUpcoming.tsx"),
      "utf8",
    );
    for (const deadProp of [
      "onPickDifferent",
      "roomLive",
      "playerCount",
      "questionIndex",
      "questionTotal",
    ]) {
      expect(source).not.toContain(deadProp);
    }
  });

  it("exposes explicit round controls on the same private phone surface", async () => {
    h.room = room();
    render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    const start = await screen.findByRole("button", { name: "Start Game 1" });
    fireEvent.click(start);

    await waitFor(() => expect(h.fetch).toHaveBeenCalledWith(
      "/api/games/g1/start",
      { method: "POST" },
    ));
  });

  it("advances from a completed Game 1 to the Game 2 start control", async () => {
    const game1 = game("g1", 1, "done");
    const game2 = game("g2", 2, "draft");
    h.room = {
      ...room(),
      night: resilientNight(),
      games: [game1, game2],
      currentGame: game1,
    };
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(COMMAND_ID);

    render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Start Game 2" }));
    await waitFor(() => expect(h.fetch).toHaveBeenCalledWith(
      "/api/games/g2/start",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: RUN_ID,
          commandId: COMMAND_ID,
          expectedControlRevision: 4,
        }),
      },
    ));
  });

  it("requires confirmation before ending a live game", async () => {
    const liveGame = game("g1", 1, "live");
    h.room = { ...room(), games: [liveGame], currentGame: liveGame };

    render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "End Game 1" }));
    expect(h.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm end Game 1" }));
    await waitFor(() => expect(h.fetch).toHaveBeenCalledWith(
      "/api/games/g1/end",
      expect.objectContaining({ method: "POST" }),
    ));
  });

  it("closes the night only after both games are done", async () => {
    const game1 = game("g1", 1, "done");
    const game2 = game("g2", 2, "done");
    h.room = {
      ...room(),
      games: [game1, game2],
      currentGame: game2,
    };

    render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    expect(await screen.findByRole("heading", { name: "Winners are being presented" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "End game" }));
    await waitFor(() => expect(h.fetch).toHaveBeenCalledWith(
      "/api/nights/night-1/close",
      expect.objectContaining({ method: "POST" }),
    ));
  });

  it("renders the Game 1 intermission and starts Game 2 without reusing the old result", async () => {
    const game1 = game("g1", 1, "done");
    const game2 = game("g2", 2, "ready");
    h.room = {
      ...room(),
      games: [game1, game2],
      currentGame: game1,
      lastResolvedQuestion: { ...pickedQuestion, finished_at: "2026-07-08T00:02:00Z" },
      scoreGameId: "g1",
      scores: [{ ...score("p1"), display_name: "Jordan", score: 6100 }],
    };

    render(
      <HostPhoneClient nightId="night-1" roomCode="ABC123" hostName="Heather Moore" themeKey="house" />,
    );

    expect(await screen.findByText("Game 1 complete")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Game 2 is ready" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Return to board" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start Game 2" }));
    await waitFor(() => expect(h.fetch).toHaveBeenCalledWith(
      "/api/games/g2/start",
      expect.objectContaining({ method: "POST" }),
    ));
  });

  it("uses the exact resilient final-game End command when the host presents winners", async () => {
    const game1 = game("g1", 1, "done");
    const game2 = game("g2", 2, "live");
    const game2Category = { ...readyCategory, id: "c2", game_id: "g2", name: "Final game" };
    const finalQuestion = {
      ...pickedQuestion,
      id: "q-final",
      category_id: "c2",
      played_at: "2026-07-08T00:01:30Z",
      finished_at: "2026-07-08T00:02:00Z",
    };
    h.room = {
      ...room(),
      night: resilientNight({ control_revision: 9 }),
      games: [game1, game2],
      categories: [readyCategory, game2Category],
      currentGame: game2,
      currentQuestion: null,
      lastResolvedQuestion: null,
      live: resilientLive({
        playId: null,
        play: null,
        controlRevision: 9,
        operations: { eligibleCount: 0, confirmedCount: 0, awaitingCount: 0 },
      }),
      scoreGameId: "g2",
      scores: [{ ...score("p1"), game_id: "g2", display_name: "Jordan", score: 7200 }],
    };
    h.fallback = {
      backupMode: true,
      payload: fallbackPayload({
        games: [game1, game2],
        categories: [readyCategory, game2Category],
        allQuestions: [finalQuestion],
        scoreGameId: "g2",
        scores: h.room.scores ?? [],
      }),
    };
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(COMMAND_ID);

    render(
      <HostPhoneClient nightId="night-1" roomCode="ABC123" hostName="Heather Moore" themeKey="house" />,
    );

    expect(await screen.findByRole("heading", { name: "Final scores are ready" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Present winners" }));
    await waitFor(() => expect(h.fetch).toHaveBeenCalledWith(
      "/api/games/g2/end",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: RUN_ID,
          commandId: COMMAND_ID,
          expectedControlRevision: 9,
        }),
      },
    ));
  });

  it("shows a completed finale with no active End action after close", async () => {
    const game1 = game("g1", 1, "done");
    const game2 = game("g2", 2, "done");
    h.room = {
      ...room(),
      night: { ...night, closed_at: "2026-07-08T03:00:00Z" },
      games: [game1, game2],
      currentGame: game2,
    };
    render(
      <HostPhoneClient nightId="night-1" roomCode="ABC123" hostName="Heather Moore" themeKey="april" />,
    );
    expect(await screen.findByRole("heading", { name: "Game complete" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "End game" })).not.toBeInTheDocument();
  });

  it("shows the current game's answer result, then returns to an unselected board on request", async () => {
    const liveGame = game("g1", 1, "live");
    const liveQuestion = {
      ...pickedQuestion,
      played_at: "2026-07-08T00:01:30Z",
    };
    h.room = {
      ...room(),
      games: [liveGame],
      currentGame: liveGame,
      currentQuestion: liveQuestion,
      players: [player("p1")],
    };
    const view = render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );
    await screen.findByText(/End early/);

    h.questions = [
      { ...liveQuestion, finished_at: "2026-07-08T00:01:45Z" },
      secondPickedQuestion,
    ];
    h.room = {
      ...h.room,
      currentQuestion: null,
      lastResolvedQuestion: { ...liveQuestion, finished_at: "2026-07-08T00:01:45Z" },
    };
    h.fallback = {
      backupMode: true,
      payload: fallbackPayload({
        games: [liveGame],
        categories: [readyCategory],
        players: h.room.players,
        currentQuestion: null,
        lastResolvedQuestion: h.room.lastResolvedQuestion,
        allQuestions: h.questions,
        liveAnswers: [{ ...answer("a1", "p1"), is_correct: true, awarded_points: 100 }],
        scores: [{ ...score("p1"), score: 100, answered_count: 1, correct_count: 1 }],
      }),
    };
    view.rerender(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    expect(await screen.findByText("1 Salsa on 2")).toBeVisible();
    const returnToBoard = screen.getByRole("button", { name: "Return to board" });
    expect(returnToBoard).toHaveStyle({ minHeight: "48px" });
    fireEvent.click(returnToBoard);
    expect(await screen.findByRole("grid", { name: "Question board" })).toBeVisible();
    expect(screen.queryByText(secondPickedQuestion.prompt)).not.toBeInTheDocument();
  });

  it("never renders a stale Game 1 answer result after Game 2 becomes authoritative", async () => {
    const game1 = game("g1", 1, "done");
    const game2 = game("g2", 2, "live");
    const resolvedGame1Question = { ...pickedQuestion, finished_at: "2026-07-08T00:01:45Z" };
    h.room = {
      ...room(),
      games: [game1, game2],
      currentGame: game2,
      currentQuestion: null,
      lastResolvedQuestion: resolvedGame1Question,
      categories: [readyCategory, { ...readyCategory, id: "c2", game_id: "g2", name: "Game 2" }],
    };
    h.questions = [{ ...secondPickedQuestion, category_id: "c2" }];

    render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    expect(await screen.findByRole("grid", { name: "Question board" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Return to board" })).not.toBeInTheDocument();
    expect(screen.queryByText("1 Salsa on 2")).not.toBeInTheDocument();
  });

  it("posts a score adjustment with the host-entered audit reason from Scores", async () => {
    const liveGame = game("g1", 1, "live");
    h.room = {
      ...room(),
      games: [liveGame],
      currentGame: liveGame,
      players: [player("p1")],
    };
    h.fallback = {
      backupMode: true,
      payload: fallbackPayload({
        games: [liveGame],
        categories: [readyCategory],
        players: h.room.players,
        allQuestions: h.questions,
        scores: [{ ...score("p1"), display_name: "Jordan", score: 6100, answered_count: 12, correct_count: 8 }],
      }),
    };
    h.scoreRows = [{ ...score("p1"), display_name: "Jordan", score: 6100, answered_count: 12, correct_count: 8 }];
    h.fetch.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/adjustments") {
        h.scoreRows = [{ ...score("p1"), display_name: "Jordan", score: 6200, answered_count: 12, correct_count: 8 }];
        return new Response(JSON.stringify({ adjustmentId: "adj-1", delta: 100 }), { status: 201 });
      }
      return new Response(JSON.stringify(preflightResponse()), { status: 200 });
    });

    render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Scores" }));
    fireEvent.click(await screen.findByRole("button", { name: "Adjust points for Jordan" }));
    fireEvent.change(screen.getByPlaceholderText(/scoring fix/i), { target: { value: "Host-awarded bonus" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply +100" }));

    await waitFor(() => expect(h.fetch).toHaveBeenCalledWith(
      "/api/adjustments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: "p1",
          gameId: "g1",
          delta: 100,
          reason: "Host-awarded bonus",
        }),
      },
    ));
    expect(await screen.findByText("6,200")).toBeVisible();
    expect(h.refresh).not.toHaveBeenCalled();

    h.scoreRows = [{ ...score("p1"), display_name: "Jordan", score: 6300, answered_count: 13, correct_count: 9 }];
    await act(async () => {
      h.scoreChangeHandlers.forEach((handler) => handler());
    });
    expect(await screen.findByText("6,300")).toBeVisible();
  });

  it("refreshes resilient scores from the signed exact-game projection without masking later scores", async () => {
    const liveGame = game("g1", 1, "live");
    h.room = {
      ...room(),
      night: resilientNight(),
      games: [liveGame],
      currentGame: liveGame,
      players: [player("p1")],
      scoreGameId: "g1",
      scores: [{ ...score("p1"), display_name: "Jordan", score: 6100 }],
    };
    h.refresh.mockImplementation(async () => {
      h.room = {
        ...h.room!,
        scoreGameId: "g1",
        scores: [{ ...score("p1"), display_name: "Jordan", score: 6200 }],
      };
    });
    h.fetch.mockImplementation(async (input: RequestInfo | URL) =>
      String(input) === "/api/adjustments"
        ? new Response(JSON.stringify({ adjustmentId: "adj-2", delta: 100 }), { status: 201 })
        : new Response(JSON.stringify(preflightResponse()), { status: 200 }),
    );

    const view = render(
      <HostPhoneClient nightId="night-1" roomCode="ABC123" hostName="Heather Moore" themeKey="house" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Scores" }));
    fireEvent.click(screen.getByRole("button", { name: "Adjust points for Jordan" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply +100" }));
    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
    view.rerender(
      <HostPhoneClient nightId="night-1" roomCode="ABC123" hostName="Heather Moore" themeKey="house" />,
    );
    expect(await screen.findByText("6,200")).toBeVisible();

    h.room = {
      ...h.room!,
      scoreGameId: "g1",
      scores: [{ ...score("p1"), display_name: "Jordan", score: 6300 }],
    };
    view.rerender(
      <HostPhoneClient nightId="night-1" roomCode="ABC123" hostName="Heather Moore" themeKey="house" />,
    );
    expect(await screen.findByText("6,300")).toBeVisible();
  });

  it("keeps intermission Game 1 score labels and adjustments bound to Game 1", async () => {
    const game1 = game("g1", 1, "done");
    const game2 = game("g2", 2, "ready");
    h.room = {
      ...room(),
      games: [game1, game2],
      currentGame: game1,
      players: [player("p1")],
    };
    h.fallback = {
      backupMode: true,
      payload: fallbackPayload({
        games: [game1, game2],
        players: h.room.players,
        scoreGameId: "g1",
        scores: [{ ...score("p1"), display_name: "Jordan", score: 6100 }],
      }),
    };
    h.scoreRows = [{ ...score("p1"), display_name: "Jordan", score: 6100 }];
    render(
      <HostPhoneClient nightId="night-1" roomCode="ABC123" hostName="Heather Moore" themeKey="house" />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Scores" }));
    expect(screen.getByRole("heading", { name: "Game 1 standings" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Adjust points for Jordan" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply +100" }));
    await waitFor(() => expect(h.fetch).toHaveBeenCalledWith(
      "/api/adjustments",
      expect.objectContaining({ body: expect.stringContaining('"gameId":"g1"') }),
    ));
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("clears prior score rows while Game 2's score snapshot is not ready", async () => {
    const game1 = game("g1", 1, "done");
    const game2 = game("g2", 2, "live");
    h.room = { ...room(), games: [game1, game2], currentGame: game2 };
    h.fallback = {
      backupMode: true,
      payload: fallbackPayload({
        games: [game1, game2],
        scoreGameId: "g2",
        scores: [],
        allScores: [{ ...score("p1"), game_id: "g1", display_name: "Old Game 1", score: 6100 }],
      }),
    };
    render(
      <HostPhoneClient nightId="night-1" roomCode="ABC123" hostName="Heather Moore" themeKey="house" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Scores" }));
    expect(screen.getByRole("heading", { name: "Game 2 standings" })).toBeVisible();
    expect(screen.getByText("Scores appear after play begins.")).toBeVisible();
    expect(screen.queryByText("Old Game 1")).not.toBeInTheDocument();
  });

  it("returns an undone reveal to the board and requires an explicit re-selection", async () => {
    const liveGame = game("g1", 1, "live");
    const liveQuestion = {
      ...pickedQuestion,
      played_at: "2026-07-08T00:01:30Z",
    };
    h.room = {
      ...room(),
      games: [liveGame],
      currentGame: liveGame,
      currentQuestion: liveQuestion,
      lastBroadcast: {
        event: "reveal",
        questionId: "q1",
        serverNow: new Date().toISOString(),
      },
    };
    const view = render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );
    await screen.findByText(/End early/);

    h.room = {
      ...h.room,
      currentQuestion: null,
      lastBroadcast: {
        event: "undo",
        questionId: "q1",
        serverNow: new Date().toISOString(),
      },
    };
    view.rerender(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    expect(await screen.findByRole("grid", { name: "Question board" })).toBeVisible();
    expect(screen.queryByText(pickedQuestion.prompt)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salsa for 100 points" }));
    expect(await screen.findByText(pickedQuestion.prompt)).toBeVisible();
  });

  it("uses the truthful preflight as the only Game 1 start surface", async () => {
    h.room = { ...room(), night: resilientNight() };
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(COMMAND_ID);
    h.fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/nights/night-1/preflight") {
        return new Response(JSON.stringify(preflightResponse()), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    expect(await screen.findByRole("heading", { name: "Game 1 is ready for a final check" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Start Game 1" })).toHaveLength(1);
    expect(screen.queryByRole("grid", { name: "Question board" })).not.toBeInTheDocument();
    expect(screen.getByText("Venue TV not confirmed")).toBeVisible();
    expect(h.fetch).toHaveBeenCalledWith(
      "/api/nights/night-1/preflight",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Start Game 1" }));
    await waitFor(() => expect(h.fetch).toHaveBeenCalledWith(
      "/api/games/g1/start",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: RUN_ID,
          commandId: COMMAND_ID,
          expectedControlRevision: 4,
        }),
      },
    ));
  });

  it("blocks a resilient Game 1 start when required control metadata is missing", async () => {
    h.room = {
      ...room(),
      night: resilientNight({ current_run_id: null }),
    };

    render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Start Game 1" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Game control metadata is not ready. Refresh the game before starting.",
    );
    expect(h.fetch.mock.calls.some(([url]) => url === "/api/games/g1/start")).toBe(false);
  });

  it("does not fetch or mount the preflight after Game 1 has started", async () => {
    const liveGame = game("g1", 1, "live");
    h.room = { ...room(), games: [liveGame], currentGame: liveGame };

    render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    expect(await screen.findByRole("grid", { name: "Question board" })).toBeVisible();
    expect(h.fetch.mock.calls.some(([url]) => url === "/api/nights/night-1/preflight")).toBe(false);
  });
});
