import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostLiveConsoleClient } from "@/app/host/live/[nightId]/HostLiveConsoleClient";
import { ThemeProvider } from "@/components/system";
import type { RoomSnapshot } from "@/lib/hooks/useRoom";
import type { GameRow, NightRow, QuestionRow } from "@/lib/supabase/types";

// The laptop must re-read the room as soon as one of its own buttons succeeds,
// instead of waiting for a broadcast it may have missed (it waited up to 15s).

const h = vi.hoisted(() => ({
  room: null as RoomSnapshot | null,
  fetch: vi.fn(),
  catchUp: vi.fn(async () => undefined),
}));

vi.mock("@/components/system/useMediaQuery", () => ({
  useMediaQuery: () => false,
}));

vi.mock("@/lib/hooks/useRoom", () => ({
  useRoom: () => h.room,
}));

vi.mock("@/lib/room/roomFallbackStore", () => ({
  useRoomFallback: () => ({ backupMode: false, payload: null }),
}));

vi.mock("@/lib/hooks/useAllLockedAutoReveal", () => ({
  useAllLockedAutoReveal: () => undefined,
}));

vi.mock("@/lib/host/roomToTVSnapshot", () => ({
  roomToTVSnapshot: () => ({}),
}));

vi.mock("@/components/host/HostConnectionBanner", () => ({
  HostConnectionBanner: () => null,
}));

vi.mock("@/components/host", async () => {
  const actual = await vi.importActual<typeof import("@/components/host")>("@/components/host");
  return {
    ...actual,
    HostLiveConsole: (props: {
      onRevealCell: (id: string) => void;
      onUndo: () => void;
      onEndEarly: () => void;
      onAdvance: (id: string) => Promise<boolean>;
      onStartGame1?: () => void;
      onEndGame: () => void;
    }) => (
      <div>
        <button type="button" onClick={() => props.onRevealCell("q-1")}>Reveal</button>
        <button type="button" onClick={props.onUndo}>Undo</button>
        <button type="button" onClick={props.onEndEarly}>End early</button>
        <button type="button" onClick={() => void props.onAdvance("q-1")}>Advance</button>
        <button type="button" onClick={props.onStartGame1}>Start game 1</button>
        <button type="button" onClick={props.onEndGame}>End game</button>
      </div>
    ),
  };
});

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => {
    const channel = {
      on: () => channel,
      subscribe: () => channel,
    };
    return {
      from: (table: string) => {
        if (table === "categories") {
          return { select: () => ({ in: async () => ({ data: [] }) }) };
        }
        if (table === "game_scores") {
          return {
            select: () => ({
              eq: () => ({ order: async () => ({ data: [], error: null }) }),
            }),
          };
        }
        return { select: () => ({ eq: async () => ({ data: [] }) }) };
      },
      channel: () => channel,
      removeChannel: () => undefined,
    };
  },
}));

const night: NightRow = {
  id: "night-1",
  host_id: "host-1",
  venue_name: "Soul Fire Pizza",
  room_code: "ABC123",
  scheduled_at: "2026-07-20T00:00:00Z",
  opened_at: "2026-07-20T00:00:00Z",
  closed_at: null,
  theme_key: "july",
  is_locked: false,
  room_magic_enabled: false,
  created_at: "2026-07-20T00:00:00Z",
};

const game: GameRow = {
  id: "game-1",
  night_id: night.id,
  game_no: 1,
  state: "live",
  started_at: "2026-07-20T00:01:00Z",
  ended_at: null,
  category_count: 0,
  question_count: 0,
};

const liveQuestion = { id: "q-1", played_at: "2026-07-20T00:02:00Z", finished_at: null } as QuestionRow;

function room(): RoomSnapshot {
  return {
    night,
    games: [game],
    categories: [],
    players: [],
    currentGame: game,
    currentQuestion: liveQuestion,
    currentReveal: null,
    lastResolvedQuestion: null,
    lastBroadcast: null,
    lastFireworksBeat: null,
    lastRoomMagicReaction: null,
    roomMagicReactions: [],
    hostDefaultThemeKey: "house",
    requestLiveCatchUp: h.catchUp,
    isLoading: false,
  } as RoomSnapshot;
}

function ok() {
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

function failure(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderLaptopConsole() {
  return render(
    <ThemeProvider themeKey="july">
      <HostLiveConsoleClient
        nightId={night.id}
        roomCode={night.room_code}
        venueName={night.venue_name}
        hostName="Heather"
        themeKey="july"
      />
    </ThemeProvider>,
  );
}

describe("HostLiveConsoleClient re-reads the room after its own button presses", () => {
  beforeEach(() => {
    h.room = room();
    h.fetch.mockReset();
    h.catchUp.mockClear();
    vi.stubGlobal("fetch", h.fetch);
  });

  it.each([
    ["Reveal", "/api/games/game-1/reveal"],
    ["Undo", "/api/games/game-1/undo"],
    ["End early", "/api/games/game-1/end-early"],
    ["Advance", "/api/games/game-1/advance"],
    ["Start game 1", "/api/games/game-1/start"],
    ["End game", "/api/games/game-1/end"],
  ])("%s: re-reads once, only after the server says it worked", async (label, path) => {
    let reply!: (response: Response) => void;
    h.fetch.mockImplementation(() => new Promise<Response>((resolve) => { reply = resolve; }));
    renderLaptopConsole();

    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(h.fetch).toHaveBeenCalledWith(path, expect.anything()));
    // Still waiting on the server: nothing to re-read yet.
    expect(h.catchUp).not.toHaveBeenCalled();

    reply(ok());
    await waitFor(() => expect(h.catchUp).toHaveBeenCalledTimes(1));
  });

  it.each([
    ["Reveal"],
    ["Undo"],
    ["End early"],
    ["Advance"],
    ["Start game 1"],
    ["End game"],
  ])("%s: does not re-read when the press fails", async (label) => {
    h.fetch.mockResolvedValue(failure(500, "boom"));
    renderLaptopConsole();

    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(h.catchUp).not.toHaveBeenCalled();
  });

  it("End early: also re-reads when the timer had already shown the answer", async () => {
    h.fetch.mockResolvedValue(failure(409, "question is already resolved"));
    renderLaptopConsole();

    fireEvent.click(screen.getByRole("button", { name: "End early" }));
    await waitFor(() => expect(h.catchUp).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
