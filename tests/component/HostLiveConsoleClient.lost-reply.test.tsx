import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostLiveConsoleClient } from "@/app/host/live/[nightId]/HostLiveConsoleClient";
import { ThemeProvider } from "@/components/system";
import type { RoomSnapshot } from "@/lib/hooks/useRoom";
import type { GameRow, NightRow, QuestionRow } from "@/lib/supabase/types";

// A host button whose reply goes missing. These drive the real handlers and the
// real poll loops in the laptop client. Only the room data and the network are
// stand-ins.

type ReadResult = { data: unknown; error: { message: string } | null };

const h = vi.hoisted(() => ({
  room: null as RoomSnapshot | null,
  fetch: vi.fn(),
  catchUp: vi.fn(async () => undefined),
  heldQuestionId: null as string | null | undefined,
  answersRead: null as null | ((signal: AbortSignal) => Promise<unknown>),
  changeHandlers: new Map<string, () => void>(),
}));

vi.mock("@/components/system/useMediaQuery", () => ({ useMediaQuery: () => false }));
vi.mock("@/lib/hooks/useRoom", () => ({ useRoom: () => h.room }));
vi.mock("@/lib/room/roomFallbackStore", () => ({
  useRoomFallback: () => ({ backupMode: false, payload: null }),
}));
vi.mock("@/lib/hooks/useAllLockedAutoReveal", () => ({
  useAllLockedAutoReveal: () => undefined,
}));
vi.mock("@/lib/host/roomToTVSnapshot", () => ({
  roomToTVSnapshot: (input: { heldQuestionId?: string | null }) => {
    h.heldQuestionId = input.heldQuestionId;
    return {};
  },
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
        <button type="button" onClick={() => props.onRevealCell("q-2")}>Reveal other</button>
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
      on: (_kind: string, filter: { table?: string }, handler: () => void) => {
        if (filter.table) h.changeHandlers.set(filter.table, handler);
        return channel;
      },
      subscribe: () => channel,
    };
    return {
      from: (table: string) => {
        let signal: AbortSignal;
        const query = {
          select: () => query,
          eq: () => query,
          in: () => query,
          order: () => query,
          abortSignal: (s: AbortSignal) => {
            signal = s;
            return query;
          },
          then: (done: (value: ReadResult) => unknown) => {
            const read =
              table === "answers" && h.answersRead
                ? (h.answersRead(signal) as Promise<ReadResult>)
                : Promise.resolve({ data: [], error: null });
            return read.then(done);
          },
        };
        return query;
      },
      channel: () => channel,
      removeChannel: () => undefined,
    };
  },
}));

const night = { id: "night-1", room_code: "ABC123", venue_name: "Soul Fire Pizza" } as NightRow;
const liveGame = { id: "game-1", night_id: night.id, game_no: 1, state: "live" } as GameRow;

function room(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    night,
    games: [liveGame],
    categories: [],
    players: [],
    currentGame: liveGame,
    currentQuestion: null,
    currentReveal: null,
    lastResolvedQuestion: null,
    lastBroadcast: null,
    lastFireworksBeat: null,
    lastRoomMagicReaction: null,
    roomMagicReactions: [],
    hostDefaultThemeKey: "house",
    requestLiveCatchUp: h.catchUp,
    isLoading: false,
    ...overrides,
  } as RoomSnapshot;
}

const liveRoom = () =>
  room({
    currentQuestion: {
      id: "q-1",
      played_at: new Date().toISOString(),
      finished_at: null,
    } as QuestionRow,
  });

const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
const refusal = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status });
const hung = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("Aborted", "AbortError")),
    );
  });

const sendsTo = (path: string) =>
  h.fetch.mock.calls.filter(([url]) => String(url) === path).length;

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function consoleTree() {
  return (
    <ThemeProvider themeKey="july">
      <HostLiveConsoleClient
        nightId={night.id}
        roomCode={night.room_code}
        venueName={night.venue_name}
        hostName="Heather"
        themeKey="july"
      />
    </ThemeProvider>
  );
}

async function tap(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
  await advance(0);
}

function setup() {
  vi.useFakeTimers();
  h.room = room();
  h.fetch.mockReset();
  h.catchUp.mockClear();
  h.heldQuestionId = undefined;
  h.answersRead = null;
  h.changeHandlers.clear();
  vi.stubGlobal("fetch", h.fetch);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
}

function teardown() {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

describe("laptop host buttons when the reply goes missing", () => {
  beforeEach(setup);
  afterEach(teardown);

  it.each([
    ["Reveal", "/api/games/game-1/reveal"],
    ["Undo", "/api/games/game-1/undo"],
    ["End early", "/api/games/game-1/end-early"],
    ["Advance", "/api/games/game-1/advance"],
    ["Start game 1", "/api/games/game-1/start"],
    ["End game", "/api/games/game-1/end"],
  ])("%s: after 8s says 'Sent, checking', re-reads once, and never re-sends", async (label, path) => {
    h.room = liveRoom();
    h.fetch.mockImplementation(hung);
    render(consoleTree());
    await advance(0);

    await tap(label);
    await advance(7_999);
    expect(screen.queryByTestId("host-sent-checking")).toBeNull();
    expect(h.catchUp).not.toHaveBeenCalled();

    await advance(1);
    expect(screen.getByTestId("host-sent-checking")).toHaveTextContent("Sent, checking");
    expect(h.catchUp).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();

    await advance(60_000);
    expect(sendsTo(path)).toBe(1);
  });

  it("a dropped connection reads the same way, with no red alert", async () => {
    h.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(consoleTree());
    await advance(0);

    await tap("Reveal");

    expect(screen.getByTestId("host-sent-checking")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(h.catchUp).toHaveBeenCalledTimes(1);
  });

  it("the note clears on its own after 4s, even if the re-read never finishes", async () => {
    h.catchUp.mockImplementation(() => new Promise<undefined>(() => undefined));
    h.fetch.mockImplementation(hung);
    render(consoleTree());
    await advance(0);
    await tap("Reveal");
    await advance(8_000);

    await advance(3_999);
    expect(screen.getByTestId("host-sent-checking")).toBeInTheDocument();
    await advance(1);
    expect(screen.queryByTestId("host-sent-checking")).toBeNull();
    h.catchUp.mockImplementation(async () => undefined);
  });

  it("the next press clears the note", async () => {
    h.fetch.mockImplementationOnce(hung).mockImplementation(async () => ok());
    render(consoleTree());
    await advance(0);
    await tap("Reveal");
    await advance(8_000);
    expect(screen.getByTestId("host-sent-checking")).toBeInTheDocument();

    await tap("End game");

    expect(screen.queryByTestId("host-sent-checking")).toBeNull();
  });

  it("a timed-out start on a first reveal stops there: the reveal is not sent", async () => {
    const draft = { ...liveGame, state: "draft" } as GameRow;
    h.room = room({ games: [draft], currentGame: draft });
    h.fetch.mockImplementation(hung);
    render(consoleTree());
    await advance(0);

    await tap("Reveal");
    await advance(60_000);

    expect(sendsTo("/api/games/game-1/start")).toBe(1);
    expect(sendsTo("/api/games/game-1/reveal")).toBe(0);
  });
});

describe("laptop reveal refusals that only mean the board is behind", () => {
  beforeEach(setup);
  afterEach(teardown);

  it.each([
    ["question already revealed"],
    ["another question is already live in this game"],
  ])("%s: re-reads with no red alert and no note", async (message) => {
    h.fetch.mockImplementation(async () => refusal(409, message));
    render(consoleTree());
    await advance(0);

    await tap("Reveal");

    expect(h.catchUp).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByTestId("host-sent-checking")).toBeNull();
  });

  it("a real refusal is still a red alert and does not re-read", async () => {
    h.fetch.mockImplementation(async () => refusal(409, "question is not on the board"));
    render(consoleTree());
    await advance(0);

    await tap("Reveal");

    expect(screen.getByRole("alert")).toHaveTextContent("question is not on the board");
    expect(h.catchUp).not.toHaveBeenCalled();
  });
});

describe("the laptop tile while a reveal is out", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("marks the tile from the tap, and a second tap on any tile sends nothing", async () => {
    h.fetch.mockImplementation(hung);
    render(consoleTree());
    await advance(0);

    await tap("Reveal");
    expect(h.heldQuestionId).toBe("q-1");

    await tap("Reveal");
    await tap("Reveal other");

    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it("gives the tile back at once on a real failure", async () => {
    h.fetch.mockImplementation(async () => refusal(500, "boom"));
    render(consoleTree());
    await advance(0);

    await tap("Reveal");

    expect(h.heldQuestionId).toBeNull();
  });

  it("gives the tile back after a lost reply, so the host can try again by hand", async () => {
    h.fetch.mockImplementationOnce(hung).mockImplementation(async () => ok());
    render(consoleTree());
    await advance(0);
    await tap("Reveal");
    await advance(8_000);
    expect(h.heldQuestionId).toBe("q-1");

    await advance(4_000);
    expect(h.heldQuestionId).toBeNull();

    await tap("Reveal");
    expect(sendsTo("/api/games/game-1/reveal")).toBe(2);
  });

  it("drops the mark as soon as the room shows the question", async () => {
    h.fetch.mockImplementation(async () => ok());
    const view = render(consoleTree());
    await advance(0);
    await tap("Reveal");
    expect(h.heldQuestionId).toBe("q-1");

    h.room = liveRoom();
    view.rerender(consoleTree());
    await advance(0);

    expect(h.heldQuestionId).toBeNull();
  });
});

describe("the laptop's answers poll", () => {
  beforeEach(() => {
    setup();
    h.room = liveRoom();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(teardown);

  it("has one read out at a time, aborts it at 4s, and starts the next 2s later", async () => {
    const signals: AbortSignal[] = [];
    h.answersRead = (signal) => {
      signals.push(signal);
      return new Promise(() => undefined);
    };
    render(consoleTree());
    await advance(0);
    expect(signals).toHaveLength(1);

    await advance(3_999);
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    await advance(1);
    expect(signals[0].aborted).toBe(true);

    await advance(1_999);
    expect(signals).toHaveLength(1);
    await advance(1);
    expect(signals).toHaveLength(2);
  });

  it("a burst of realtime changes during a read makes one more read, not forty", async () => {
    let finish!: (value: ReadResult) => void;
    let reads = 0;
    h.answersRead = () => {
      reads += 1;
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    render(consoleTree());
    await advance(0);
    expect(reads).toBe(1);

    for (let index = 0; index < 40; index += 1) h.changeHandlers.get("answers")?.();
    await advance(0);
    expect(reads).toBe(1);

    finish({ data: [], error: null });
    await advance(0);
    expect(reads).toBe(2);
  });

  it("stops the poll when the console closes", async () => {
    let reads = 0;
    h.answersRead = async () => {
      reads += 1;
      return { data: [], error: null };
    };
    const view = render(consoleTree());
    await advance(0);

    view.unmount();
    await advance(30_000);

    expect(reads).toBe(1);
  });
});
