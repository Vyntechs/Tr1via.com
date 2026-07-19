import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HostPhoneClient } from "@/app/host/phone/[nightId]/HostPhoneClient";
import type { RoomSnapshot } from "@/lib/hooks/useRoom";
import type { CategoryRow, GameRow, NightRow, QuestionRow } from "@/lib/supabase/types";

const h = vi.hoisted(() => ({
  room: null as RoomSnapshot | null,
  questions: [] as QuestionRow[],
  fetch: vi.fn(),
}));

vi.mock("@/lib/hooks/useRoom", () => ({
  useRoom: () => h.room,
}));

vi.mock("@/lib/hooks/useTimer", () => ({
  useTimer: () => ({ secondsRemaining: 14 }),
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
      return {
        select: () => ({
          eq: async () => ({ data: [] }),
        }),
      };
    },
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
    }),
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
    h.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", h.fetch);
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
