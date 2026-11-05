import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostLiveConsoleClient } from "@/app/host/live/[nightId]/HostLiveConsoleClient";
import { ThemeProvider } from "@/components/system";
import type { RoomSnapshot } from "@/lib/hooks/useRoom";
import type { CategoryRow, GameRow, NightRow, QuestionRow } from "@/lib/supabase/types";

// The real console and its real TV panel, on a legacy night, with only the room
// data standing in. The end of the panel's timer-zero ladder is the recovery when
// the close landed but this laptop missed the message. On a legacy night only
// catch-up can move the screen: requestRefresh updates TV keys and nothing else.

const h = vi.hoisted(() => ({
  room: null as RoomSnapshot | null,
  catchUp: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined),
}));

vi.mock("@/components/system/useMediaQuery", () => ({ useMediaQuery: () => false }));
vi.mock("@/lib/hooks/useRoom", () => ({ useRoom: () => h.room }));
vi.mock("@/lib/room/roomFallbackStore", () => ({
  useRoomFallback: () => ({ backupMode: false, payload: null }),
}));
vi.mock("@/lib/hooks/useAllLockedAutoReveal", () => ({
  useAllLockedAutoReveal: () => undefined,
}));
vi.mock("@/components/host/HostConnectionBanner", () => ({ HostConnectionBanner: () => null }));
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => {
    const channel = { on: () => channel, subscribe: () => channel };
    const rows = async () => ({ data: [], error: null });
    const query: Record<string, unknown> = {};
    for (const step of ["select", "eq", "in", "order"]) query[step] = () => query;
    query.abortSignal = rows;
    query.then = (done: (value: unknown) => void) => void rows().then(done);
    return { from: () => query, channel: () => channel, removeChannel: () => undefined };
  },
}));

const START = Date.parse("2026-07-20T02:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

const night = {
  id: "night-1",
  host_id: "host-1",
  venue_name: "Soul Fire Pizza",
  room_code: "ABC123",
  scheduled_at: iso(START - 3_600_000),
  opened_at: iso(START - 3_600_000),
  closed_at: null,
  theme_key: "house",
  is_locked: false,
  room_magic_enabled: false,
  created_at: iso(START - 3_600_000),
} as NightRow;

const game = {
  id: "game-1",
  night_id: night.id,
  game_no: 1,
  state: "live",
  started_at: iso(START - 600_000),
  ended_at: null,
  category_count: 1,
  question_count: 1,
} as GameRow;

const category = {
  id: "cat-1",
  game_id: game.id,
  position: 0,
  name: "Music",
  topic: "Music",
  state: "ready",
} as unknown as CategoryRow;

const question = {
  id: "q-1",
  category_id: category.id,
  point_value: 100,
  prompt: "Which one?",
  options: ["A", "B", "C", "D"],
  correct_index: 0,
  is_picked: true,
  played_at: iso(START - 24_000),
  finished_at: null,
} as unknown as QuestionRow;

function liveRoom(): RoomSnapshot {
  return {
    night,
    games: [game],
    categories: [category],
    players: [],
    currentGame: game,
    currentQuestion: question,
    currentReveal: null,
    lastResolvedQuestion: null,
    allQuestions: [question],
    lastBroadcast: null,
    lastFireworksBeat: null,
    lastRoomMagicReaction: null,
    roomMagicReactions: [],
    hostDefaultThemeKey: "house",
    requestLiveCatchUp: h.catchUp,
    requestRefresh: h.refresh,
    isLoading: false,
  } as unknown as RoomSnapshot;
}

function closedRoom(): RoomSnapshot {
  const closed = { ...question, finished_at: iso(Date.now()) } as QuestionRow;
  return { ...liveRoom(), currentQuestion: null, lastResolvedQuestion: closed, allQuestions: [closed] } as RoomSnapshot;
}

const tree = () => (
  <ThemeProvider themeKey="house">
    <HostLiveConsoleClient
      nightId={night.id}
      roomCode={night.room_code}
      venueName={night.venue_name}
      hostName="Heather"
      themeKey="house"
    />
  </ThemeProvider>
);

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const resolveSends = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/resolve")).length;

describe("laptop console: end of the TV panel's timer-zero ladder", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let closeLanded: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    closeLanded = false;
    h.room = liveRoom();
    h.refresh.mockClear();
    h.catchUp.mockReset();
    // A read on a legacy night sees the close only once it has landed.
    h.catchUp.mockImplementation(async () => {
      if (closeLanded) h.room = closedRoom();
    });
    // The first two close attempts fail, so the close lands after the one-off
    // recheck at zero+3s has already found nothing.
    let sends = 0;
    fetchMock = vi.fn(async (url: string) => {
      if (!String(url).endsWith("/resolve")) return new Response("{}", { status: 200 });
      sends += 1;
      if (sends < 3) return new Response("{}", { status: 503 });
      closeLanded = true;
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a close seen only through the ladder's last read moves a legacy night on", async () => {
    const view = render(tree());
    expect(screen.getByTestId("host-end-early-btn")).toHaveTextContent("Show answer now");

    // Zero at +1s, the laptop's own recheck at +4s, third send by about +6s.
    await advance(4_100);
    expect(closeLanded).toBe(false);
    expect(h.catchUp).toHaveBeenCalledTimes(1);
    view.rerender(tree());
    expect(screen.queryByTestId("host-end-early-btn")).not.toBeNull();

    await advance(3_000);
    expect(resolveSends(fetchMock)).toBe(3);
    expect(closeLanded).toBe(true);
    expect(h.catchUp).toHaveBeenCalledTimes(2);
    expect(h.refresh).toHaveBeenCalledTimes(1);

    view.rerender(tree());
    expect(screen.queryByTestId("host-end-early-btn")).toBeNull();
  });

  it("the TV panel ignores a reveal message from another question", async () => {
    const stale = START - 60_000;
    h.room = {
      ...liveRoom(),
      currentQuestion: { ...question, played_at: iso(START) } as QuestionRow,
      allQuestions: [{ ...question, played_at: iso(START) } as QuestionRow],
      lastBroadcast: { event: "reveal", questionId: "q-0", serverNow: iso(stale), revealedAt: iso(stale), receivedAtMs: stale },
    } as RoomSnapshot;
    render(tree());

    await advance(4_000);
    expect(screen.queryByText("TIME'S UP")).toBeNull();
    expect(resolveSends(fetchMock)).toBe(0);
  });

  it("the TV panel still uses a reveal message for the question on screen", async () => {
    const earlier = START - 20_000;
    h.room = {
      ...liveRoom(),
      currentQuestion: { ...question, played_at: iso(START) } as QuestionRow,
      allQuestions: [{ ...question, played_at: iso(START) } as QuestionRow],
      lastBroadcast: { event: "reveal", questionId: "q-1", serverNow: iso(earlier), revealedAt: iso(earlier), receivedAtMs: earlier },
    } as RoomSnapshot;
    render(tree());

    await advance(5_100);
    expect(resolveSends(fetchMock)).toBe(1);
  });
});
