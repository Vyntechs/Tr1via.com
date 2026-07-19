import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const h = vi.hoisted(() => ({
  room: null as RoomSnapshot | null,
  questions: [] as QuestionRow[],
  fetch: vi.fn(),
  fallback: { backupMode: false, payload: null as RoomFallbackPayload | null },
  autoRevealOptions: null as {
    decision: { complete: boolean; eligibleCount: number; lockedCount: number } | null;
    onAutoReveal: () => unknown;
  } | null,
}));

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
              order: async () => ({ data: [] }),
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
        on: () => channel,
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
    isLoading: false,
  };
}

describe("HostPhoneClient reveal flow", () => {
  beforeEach(() => {
    h.room = room();
    h.questions = [pickedQuestion, secondPickedQuestion];
    h.fetch.mockReset();
    h.fallback = { backupMode: false, payload: null };
    h.autoRevealOptions = null;
    h.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", h.fetch);
  });

  it("stages questions and lock counts from the shared backup payload", async () => {
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

    const lockedSection = (await screen.findByText("LOCKED IN")).parentElement;
    expect(lockedSection).toHaveTextContent(/1of 2/);
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

  it("starts a draft or ready game before revealing from the private host phone", async () => {
    render(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    const reveal = await screen.findByText("Reveal to the room");
    fireEvent.click(reveal);

    await waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2));
    expect(h.fetch.mock.calls[0][0]).toBe("/api/games/g1/start");
    expect(h.fetch.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(h.fetch.mock.calls[1][0]).toBe("/api/games/g1/reveal");
    expect(h.fetch.mock.calls[1][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ questionId: "q1" }),
    });
  });

  it("exposes explicit round controls on the same private phone surface", async () => {
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
      expect.objectContaining({ method: "POST" }),
    ));
  });

  it("advances from a completed Game 1 to the Game 2 start control", async () => {
    const game1 = game("g1", 1, "done");
    const game2 = game("g2", 2, "draft");
    h.room = {
      ...room(),
      games: [game1, game2],
      currentGame: game1,
    };

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
      expect.objectContaining({ method: "POST" }),
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

    fireEvent.click(await screen.findByRole("button", { name: "End the night" }));
    await waitFor(() => expect(h.fetch).toHaveBeenCalledWith(
      "/api/nights/night-1/close",
      expect.objectContaining({ method: "POST" }),
    ));
  });

  it("stages the next unplayed question after the live question resolves", async () => {
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
    view.rerender(
      <HostPhoneClient
        nightId="night-1"
        roomCode="ABC123"
        hostName="Heather Moore"
        themeKey="house"
      />,
    );

    expect(await screen.findByText(secondPickedQuestion.prompt)).toBeVisible();
  });

  it("returns an undone reveal to the staged-question controls", async () => {
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

    expect(await screen.findByText(pickedQuestion.prompt)).toBeVisible();
  });
});
