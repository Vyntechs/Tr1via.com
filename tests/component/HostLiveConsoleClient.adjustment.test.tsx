import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostLiveConsoleClient } from "@/app/host/live/[nightId]/HostLiveConsoleClient";
import { ThemeProvider } from "@/components/system";
import type { RoomSnapshot } from "@/lib/hooks/useRoom";
import type { GameRow, NightRow, PlayerRow } from "@/lib/supabase/types";

const h = vi.hoisted(() => ({
  room: null as RoomSnapshot | null,
  fetch: vi.fn(),
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
    HostLiveConsole: ({ onAdjustPoints }: { onAdjustPoints: () => void }) => (
      <button type="button" onClick={onAdjustPoints}>Adjust points</button>
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

const player: PlayerRow = {
  id: "player-1",
  night_id: night.id,
  device_id: "device-1",
  display_name: "Jordan",
  joined_at: "2026-07-20T00:00:00Z",
  last_seen_at: "2026-07-20T00:02:00Z",
  removed_at: null,
  app_switch_total_seconds: 0,
  can_answer: true,
};

function room(): RoomSnapshot {
  return {
    night,
    games: [game],
    categories: [],
    players: [player],
    currentGame: game,
    currentQuestion: null,
    currentReveal: null,
    lastResolvedQuestion: null,
    lastBroadcast: null,
    lastFireworksBeat: null,
    lastRoomMagicReaction: null,
    roomMagicReactions: [],
    hostDefaultThemeKey: "house",
    requestRefresh: vi.fn(),
    isLoading: false,
  } as RoomSnapshot;
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

describe("HostLiveConsoleClient laptop point adjustments", () => {
  beforeEach(() => {
    h.room = room();
    h.fetch.mockReset();
    vi.stubGlobal("fetch", h.fetch);
  });

  it("keeps the modal open and submission disabled until the save finishes", async () => {
    let finishSave!: (response: Response) => void;
    h.fetch.mockImplementation(() => new Promise<Response>((resolve) => { finishSave = resolve; }));
    renderLaptopConsole();

    fireEvent.click(screen.getByRole("button", { name: "Adjust points" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply +100" }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole("dialog", { name: "Adjust points" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Applying…" })).toBeDisabled();
    expect(h.fetch).toHaveBeenCalledWith("/api/adjustments", expect.objectContaining({ method: "POST" }));

    finishSave(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Adjust points" })).not.toBeInTheDocument();
    });
  });

  it("keeps the modal open with its save error when the adjustment fails", async () => {
    h.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Connection interrupted" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderLaptopConsole();

    fireEvent.click(screen.getByRole("button", { name: "Adjust points" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply +100" }));

    const dialog = screen.getByRole("dialog", { name: "Adjust points" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Connection interrupted");
    expect(dialog).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Apply +100" })).toBeEnabled();
  });
});
