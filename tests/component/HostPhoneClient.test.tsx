import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HostPhoneClient } from "@/app/host/phone/[nightId]/HostPhoneClient";
import type { RoomSnapshot } from "@/lib/hooks/useRoom";
import type { CategoryRow, GameRow, NightRow, QuestionRow } from "@/lib/supabase/types";

const h = vi.hoisted(() => ({
  room: null as RoomSnapshot | null,
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
              eq: async () => ({ data: [pickedQuestion] }),
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
});
