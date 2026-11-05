import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostLiveConsoleClient } from "@/app/host/live/[nightId]/HostLiveConsoleClient";
import { ThemeProvider } from "@/components/system";
import type { RoomSnapshot } from "@/lib/hooks/useRoom";
import type { GameRow, NightRow, PlayerRow, QuestionRow } from "@/lib/supabase/types";

// Regression: handleEndEarly's catch returned true, which told the auto-end hook
// "done". One failed or hung try therefore ended auto-end for that question and
// the room sat waiting on the timer with everyone already locked in.
//
// This drives the REAL useAllLockedAutoReveal and the REAL all-locked decision
// through the real client. Only the room data and the network are stand-ins.

const h = vi.hoisted(() => ({
  room: null as RoomSnapshot | null,
  fetch: vi.fn(),
  catchUp: vi.fn(async () => undefined),
}));

vi.mock("@/components/system/useMediaQuery", () => ({ useMediaQuery: () => false }));
vi.mock("@/lib/hooks/useRoom", () => ({ useRoom: () => h.room }));
vi.mock("@/lib/room/roomFallbackStore", () => ({
  useRoomFallback: () => ({ backupMode: false, payload: null }),
}));
vi.mock("@/lib/host/roomToTVSnapshot", () => ({ roomToTVSnapshot: () => ({}) }));
vi.mock("@/components/host/HostConnectionBanner", () => ({
  HostConnectionBanner: () => null,
}));
vi.mock("@/components/host", async () => {
  const actual = await vi.importActual<typeof import("@/components/host")>("@/components/host");
  return { ...actual, HostLiveConsole: () => <div>console</div> };
});

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => {
    const channel = { on: () => channel, subscribe: () => channel };
    const reply = (table: string) => {
      if (table === "game_scores") {
        return { data: [{ player_id: "p-1" }, { player_id: "p-2" }], error: null };
      }
      if (table === "answers") {
        return {
          data: [
            { question_id: "q-1", player_id: "p-1" },
            { question_id: "q-1", player_id: "p-2" },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    };
    return {
      from: (table: string) => {
        const query = {
          select: () => query,
          eq: () => query,
          in: () => query,
          order: () => query,
          abortSignal: () => query,
          then: (done: (value: unknown) => unknown) => Promise.resolve(reply(table)).then(done),
        };
        return query;
      },
      channel: () => channel,
      removeChannel: () => undefined,
    };
  },
}));

const night = {
  id: "night-1",
  room_code: "ABC123",
  venue_name: "Soul Fire Pizza",
} as NightRow;
const game = { id: "game-1", night_id: night.id, game_no: 1, state: "live" } as GameRow;

function room(): RoomSnapshot {
  return {
    night,
    games: [game],
    categories: [],
    players: [
      { id: "p-1", display_name: "Ana", app_switch_total_seconds: 0 },
      { id: "p-2", display_name: "Bo", app_switch_total_seconds: 0 },
    ] as PlayerRow[],
    currentGame: game,
    currentQuestion: {
      id: "q-1",
      played_at: new Date().toISOString(),
      finished_at: null,
    } as QuestionRow,
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

const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
const refusal = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status });
/** Never answers. Rejects only if the caller aborts, as a real fetch does. */
const hung = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("Aborted", "AbortError")),
    );
  });

const sends = () => h.fetch.mock.calls.filter(([url]) => String(url).includes("/end-early")).length;

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mountWithEveryoneLocked() {
  render(
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
  await advance(0);
  // The reads landed, everyone is locked, and the 1.2s grace window is running.
  await advance(1_200);
}

describe("auto-end on the laptop survives a bad first try", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.room = room();
    h.fetch.mockReset();
    h.catchUp.mockClear();
    vi.stubGlobal("fetch", h.fetch);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a server error on the first try is tried again and the question closes", async () => {
    h.fetch.mockResolvedValueOnce(refusal(500, "boom")).mockResolvedValue(ok());

    await mountWithEveryoneLocked();
    expect(sends()).toBe(1);

    await advance(1_200);
    expect(sends()).toBe(2);
    expect(h.catchUp).toHaveBeenCalledTimes(1);

    await advance(30_000);
    expect(sends()).toBe(2);
  });

  it("a dropped connection on the first try is tried again", async () => {
    h.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(ok());

    await mountWithEveryoneLocked();
    await advance(1_200);

    expect(sends()).toBe(2);
  });

  it("a first try that never replies gives up at 8s and is tried again", async () => {
    h.fetch.mockImplementationOnce(hung).mockResolvedValue(ok());

    await mountWithEveryoneLocked();
    expect(sends()).toBe(1);

    await advance(7_999);
    expect(sends()).toBe(1);

    await advance(1 + 1_200);
    expect(sends()).toBe(2);
  });

  it("an already-resolved reply stops the tries and re-reads the room", async () => {
    h.fetch.mockResolvedValue(refusal(409, "question is already resolved"));

    await mountWithEveryoneLocked();
    expect(h.catchUp).toHaveBeenCalledTimes(1);

    await advance(30_000);
    expect(sends()).toBe(1);
  });

  it("stops after three retries at 1.2, 2.4 and 4.8s when the server keeps saying no", async () => {
    h.fetch.mockImplementation(async () =>
      refusal(409, "not all eligible players are locked"),
    );

    await mountWithEveryoneLocked();
    expect(sends()).toBe(1);

    await advance(1_199);
    expect(sends()).toBe(1);
    await advance(1);
    expect(sends()).toBe(2);

    await advance(2_399);
    expect(sends()).toBe(2);
    await advance(1);
    expect(sends()).toBe(3);

    await advance(4_799);
    expect(sends()).toBe(3);
    await advance(1);
    expect(sends()).toBe(4);

    await advance(60_000);
    expect(sends()).toBe(4);
  });

  it("nobody pressed anything, so a failed auto try shows no red alert", async () => {
    h.fetch.mockImplementation(async () => refusal(500, "boom"));

    await mountWithEveryoneLocked();
    await advance(10_000);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
