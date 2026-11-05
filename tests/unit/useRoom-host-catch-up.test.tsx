import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Host laptop lag fixes (2026-10-07):
//  A. The newest-reveal read is scoped by game_id instead of joining games on
//     night_id, so the per-row permission check no longer scans every night.
//  B. The host re-reads the room in place when its live channels (re)join and
//     on request (after its own button press), so a broadcast missed while the
//     laptop was rebuilding its connection no longer leaves it stale for 15s.

type Row = Record<string, unknown>;
type Op = [string, ...unknown[]];

const h = vi.hoisted(() => {
  const db: Record<string, Row[]> = {};
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const executed: Record<string, number> = {};
  const gates = new Map<string, Promise<void>>();
  // Milliseconds each read of a table takes (fake timers), to model a slow link.
  const delays = new Map<string, number>();
  const failing = new Set<string>();
  const broadcastHandlers = new Map<string, (message: { payload: unknown }) => void>();
  const changeHandlers = new Map<string, (payload: unknown) => void>();
  const joinCallbacks: Array<(status: string) => void> = [];
  let engine: "legacy" | "resilient_v1" = "legacy";

  const NIGHT = "night-a";
  const RUN = "11111111-1111-4111-8111-111111111111";

  function seed() {
    for (const key of Object.keys(db)) delete db[key];
    for (const key of Object.keys(executed)) delete executed[key];
    calls.length = 0;
    gates.clear();
    delays.clear();
    failing.clear();
    broadcastHandlers.clear();
    changeHandlers.clear();
    joinCallbacks.length = 0;
    engine = "legacy";
    db.nights = [{
      id: NIGHT,
      host_id: "host-1",
      venue_name: "Venue",
      room_code: "ABCDEF",
      theme_key: "may",
      room_magic_enabled: false,
      is_locked: false,
      scheduled_at: null,
      opened_at: "2026-10-07T00:00:00.000Z",
      closed_at: null,
      created_at: "2026-10-07T00:00:00.000Z",
      answer_engine: "legacy",
      current_run_id: null,
      control_revision: 0,
      room_revision: 0,
    }];
    db.games = [{
      id: "game-a",
      night_id: NIGHT,
      game_no: 1,
      state: "live",
      started_at: "2026-10-07T00:00:00.000Z",
      ended_at: null,
      category_count: 1,
      question_count: 3,
    }];
    db.categories = [{ id: "cat-a", game_id: "game-a", name: "Music", position: 0, state: "ready" }];
    db.players = [{
      id: "player-1",
      night_id: NIGHT,
      device_id: "device-1",
      display_name: "Alice",
      joined_at: "2026-10-07T00:00:00.000Z",
      removed_at: null,
    }];
    db.questions = [
      { id: "q1", category_id: "cat-a", played_at: null, finished_at: null, prompt: "One?" },
      { id: "q2", category_id: "cat-a", played_at: null, finished_at: null, prompt: "Two?" },
    ];
    db.reveals = [{
      id: "r1",
      game_id: "game-a",
      question_id: "q0",
      event: "reveal",
      occurred_at: "2026-10-07T00:10:00.000000+00:00",
      metadata: null,
    }];
  }

  function queryBuilder(table: string) {
    const ops: Op[] = [];
    calls.push({ table, ops });

    async function run(): Promise<{ data: Row[] | null; error: unknown }> {
      // "reveals:answer" is the lookup of a finished question's answer.
      const keys = ops.some(([name, column, value]) => name === "eq" && column === "event" && value === "resolve")
        ? [table, `${table}:answer`]
        : [table];
      for (const key of keys) executed[key] = (executed[key] ?? 0) + 1;
      const gate = keys.map((key) => gates.get(key)).find(Boolean);
      if (gate) await gate;
      const delay = keys.map((key) => delays.get(key)).find((ms) => ms !== undefined);
      if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
      if (keys.some((key) => failing.has(key))) return { data: null, error: { message: "boom" } };
      let rows = [...(db[table] ?? [])];
      for (const [name, ...args] of ops) {
        if (name === "eq" && !String(args[0]).includes(".")) {
          rows = rows.filter((row) => row[args[0] as string] === args[1]);
        } else if (name === "in") {
          rows = rows.filter((row) => (args[1] as unknown[]).includes(row[args[0] as string]));
        } else if (name === "is") {
          rows = rows.filter((row) => (row[args[0] as string] ?? null) === args[1]);
        } else if (name === "not") {
          rows = rows.filter((row) => (row[args[0] as string] ?? null) !== args[2]);
        } else if (name === "order") {
          const column = args[0] as string;
          const ascending = (args[1] as { ascending?: boolean } | undefined)?.ascending !== false;
          rows.sort((a, b) =>
            ascending
              ? String(a[column]).localeCompare(String(b[column]))
              : String(b[column]).localeCompare(String(a[column])),
          );
        } else if (name === "limit") {
          rows = rows.slice(0, args[0] as number);
        }
      }
      return { data: rows, error: null };
    }

    const builder = {
      select: vi.fn((...args: unknown[]) => { ops.push(["select", ...args]); return builder; }),
      eq: vi.fn((...args: unknown[]) => { ops.push(["eq", ...args]); return builder; }),
      in: vi.fn((...args: unknown[]) => { ops.push(["in", ...args]); return builder; }),
      is: vi.fn((...args: unknown[]) => { ops.push(["is", ...args]); return builder; }),
      not: vi.fn((...args: unknown[]) => { ops.push(["not", ...args]); return builder; }),
      order: vi.fn((...args: unknown[]) => { ops.push(["order", ...args]); return builder; }),
      limit: vi.fn((...args: unknown[]) => { ops.push(["limit", ...args]); return builder; }),
      single: vi.fn(async () => {
        const res = await run();
        return { data: res.data?.[0] ?? null, error: res.error };
      }),
      maybeSingle: vi.fn(async () => {
        const res = await run();
        return { data: res.data?.[0] ?? null, error: res.error };
      }),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        run().then(resolve, reject),
    };
    return builder;
  }

  const client = {
    realtime: { connect: vi.fn(), disconnect: vi.fn() },
    from: vi.fn((table: string) => queryBuilder(table)),
    channel: vi.fn(() => {
      const channel = {
        on: vi.fn((
          kind: string,
          filter: { event?: string; table?: string },
          handler: (message: { payload: unknown }) => void,
        ) => {
          if (kind === "broadcast" && filter.event) broadcastHandlers.set(filter.event, handler);
          if (kind === "postgres_changes" && filter.table) {
            changeHandlers.set(filter.table, handler as (payload: unknown) => void);
          }
          return channel;
        }),
        subscribe: vi.fn((callback?: (status: string) => void) => {
          if (callback) joinCallbacks.push(callback);
          return channel;
        }),
      };
      return channel;
    }),
    removeChannel: vi.fn(),
  };

  return {
    db,
    calls,
    executed,
    gates,
    delays,
    failing,
    client,
    broadcastHandlers,
    changeHandlers,
    joinCallbacks,
    realRoutePoll: false,
    NIGHT,
    RUN,
    seed,
    setResilient() {
      engine = "resilient_v1";
      (db.nights[0] as Row).answer_engine = "resilient_v1";
      (db.nights[0] as Row).current_run_id = RUN;
    },
    engine: () => engine,
  };
});

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => h.client,
}));

vi.mock("@/lib/room/fetchRoomSnapshot", () => ({
  fetchRoomSnapshotPayload: vi.fn(async () => ({
    audience: "host",
    night: { id: "night-a" },
    tvPlayerKeys: {},
  })),
}));

vi.mock("@/lib/hooks/useRevalidateOnFocus", () => ({ useRevalidateOnFocus: () => 0 }));
vi.mock("@/lib/hooks/useFreshnessWatchdog", () => ({ useFreshnessWatchdog: () => undefined }));
vi.mock("@/lib/hooks/useUnreachableRetry", () => ({ useUnreachableRetry: () => undefined }));
vi.mock("@/lib/hooks/useRoomRoutePoll", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks/useRoomRoutePoll")>();
  return {
    useRoomRoutePoll: (args: Parameters<typeof actual.useRoomRoutePoll>[0]) => {
      if (h.realRoutePoll) actual.useRoomRoutePoll(args);
    },
  };
});

import { useRoom } from "@/lib/hooks/useRoom";
import { __resetReachabilityForTests, getReachability } from "@/lib/realtime/reachability";
import { __resetRoomFallbackForTests, getRoomFallback } from "@/lib/room/roomFallbackStore";
import { fetchRoomSnapshotPayload } from "@/lib/room/fetchRoomSnapshot";

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 60; index += 1) await Promise.resolve();
  });
}

/** Both live channels report joined (first join, or a rejoin after a drop). */
async function joinChannels() {
  act(() => {
    for (const callback of [...h.joinCallbacks]) callback("SUBSCRIBED");
  });
  await flush();
}

async function mountHost() {
  const hook = renderHook(() => useRoom({ roomCode: "ABCDEF", audience: "host" }));
  await flush();
  return hook;
}

const revealCalls = () =>
  h.calls.filter((call) => call.table === "reveals" && call.ops.some(([name]) => name === "in"));

describe("host laptop: newest-reveal read is scoped to this night's games", () => {
  beforeEach(() => {
    h.seed();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ nightId: h.NIGHT, hostDefaultThemeKey: "may" }),
    })));
  });

  it("filters reveals by game_id and never joins games on night_id", async () => {
    const { result } = await mountHost();

    const reads = revealCalls();
    expect(reads).toHaveLength(1);
    const ops = reads[0].ops;
    expect(ops).toContainEqual(["in", "game_id", ["game-a"]]);
    expect(ops).toContainEqual(["select", "*"]);
    expect(ops.some(([name, column]) => name === "eq" && String(column).includes("games."))).toBe(false);
    expect(ops).toContainEqual(["order", "occurred_at", { ascending: false }]);
    expect(ops).toContainEqual(["limit", 1]);
    // Identical result to the joined query: the plain newest row, no extra fields.
    expect(result.current.currentReveal).toEqual(h.db.reveals[0]);
  });

  it("returns the newest of several reveals", async () => {
    h.db.reveals.push({
      id: "r2",
      game_id: "game-a",
      question_id: "q1",
      event: "resolve",
      occurred_at: "2026-10-07T00:20:00.000000+00:00",
      metadata: { correct_index: 1 },
    });
    const { result } = await mountHost();
    expect(result.current.currentReveal?.id).toBe("r2");
  });

  it("sends the games request once and skips the reveals read when the night has no games", async () => {
    h.db.games = [];
    const { result } = await mountHost();

    // One bootstrap games read, shared with the reveals lookup (the channels
    // have not joined, so no catch-up read has run yet).
    expect(h.executed.games).toBe(1);
    expect(revealCalls()).toHaveLength(0);
    expect(result.current.currentReveal).toBeNull();
  });
});

// On a slow link the fix must behave like main: a read that finishes inside the
// 5 s budget never flips the host screen to "backup mode", and the reveal read
// must not add a round trip once this night's game ids are known.
describe("host laptop: slow connections behave as they did before the reveal-read change", () => {
  const TABLES = ["nights", "games", "categories", "players", "questions", "reveals"];
  const slowReads = (ms: number) => {
    for (const table of TABLES) h.delays.set(table, ms);
  };
  let random: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    h.seed();
    __resetRoomFallbackForTests();
    __resetReachabilityForTests();
    random = vi.spyOn(Math, "random").mockReturnValue(0);
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ nightId: h.NIGHT, hostDefaultThemeKey: "may" }),
    })));
  });

  afterEach(() => {
    random.mockRestore();
    vi.useRealTimers();
  });

  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
    await flush();
  };
  // Direct reads gave up. The screen then shows "backup" (the server route
  // served it) or "unreachable" (the route failed too, as this bare stub does).
  const backupBanner = () => getRoomFallback().backupMode || getReachability() === "unreachable";

  it("first load with every read taking 2.8 s loads normally, no backup banner", async () => {
    slowReads(2_800);
    const { result } = renderHook(() => useRoom({ roomCode: "ABCDEF", audience: "host" }));
    await advance(6_000);

    expect(backupBanner()).toBe(false);
    expect(getReachability()).toBe("ok");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.currentReveal?.id).toBe("r1");
  });

  it("a rebuild sends the reveal read together with the games read and loads in one round trip", async () => {
    const { result } = await mountHost();
    slowReads(2_800);
    h.db.players.push({
      id: "player-2",
      night_id: h.NIGHT,
      device_id: "device-2",
      display_name: "Bo",
      joined_at: "2026-10-07T00:11:30.000Z",
      removed_at: null,
    });
    const before = h.executed.reveals;

    // The 15 s heartbeat tears the connection down and re-reads everything.
    await advance(15_000);
    expect(h.executed.games).toBe(2);
    expect(h.executed.reveals).toBe(before + 1);

    await advance(3_000);
    expect(backupBanner()).toBe(false);
    expect(result.current.players.map((player) => player.id)).toEqual(["player-1", "player-2"]);
  });

  it("a catch-up with every read taking 2.8 s still lands", async () => {
    const { result } = await mountHost();
    slowReads(2_800);
    h.db.players.push({
      id: "player-2",
      night_id: h.NIGHT,
      device_id: "device-2",
      display_name: "Bo",
      joined_at: "2026-10-07T00:11:30.000Z",
      removed_at: null,
    });
    const before = h.executed.reveals;

    act(() => {
      void result.current.requestLiveCatchUp?.();
    });
    await flush();
    // Both lookups go out at once; the reveal read does not wait for the games read.
    expect(h.executed.reveals).toBe(before + 1);

    await advance(3_000);
    expect(result.current.players.map((player) => player.id)).toEqual(["player-1", "player-2"]);
  });

  it("still finds the newest reveal when a game was added since the last read", async () => {
    const { result } = await mountHost();
    h.db.games.push({
      id: "game-b",
      night_id: h.NIGHT,
      game_no: 2,
      state: "live",
      started_at: "2026-10-07T00:12:00.000Z",
      ended_at: null,
      category_count: 1,
      question_count: 3,
    });
    h.db.reveals.push({
      id: "r-b",
      game_id: "game-b",
      question_id: "q9",
      event: "reveal",
      occurred_at: "2026-10-07T00:13:00.000000+00:00",
      metadata: null,
    });
    const before = revealCalls().length;

    await act(async () => {
      await result.current.requestLiveCatchUp?.();
    });

    expect(result.current.games.map((game) => game.id)).toEqual(["game-a", "game-b"]);
    expect(result.current.currentReveal?.id).toBe("r-b");
    // The first guess used the old ids; one corrected read followed.
    expect(revealCalls().length).toBe(before + 2);
    expect(revealCalls().at(-1)?.ops).toContainEqual(["in", "game_id", ["game-a", "game-b"]]);
  });

  it("still goes to backup mode when reads take longer than the 5 s limit", async () => {
    slowReads(5_500);
    renderHook(() => useRoom({ roomCode: "ABCDEF", audience: "host" }));
    await advance(5_100);

    expect(backupBanner()).toBe(true);
  });

  it("still goes to backup mode when the reveal read never answers", async () => {
    h.gates.set("reveals", new Promise<void>(() => {}));
    renderHook(() => useRoom({ roomCode: "ABCDEF", audience: "host" }));
    await advance(5_100);

    expect(backupBanner()).toBe(true);
  });
});

describe("host laptop: re-reads the room in place when it may have missed something", () => {
  beforeEach(() => {
    h.seed();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ nightId: h.NIGHT, hostDefaultThemeKey: "may" }),
    })));
  });

  it("catches up on a press made while the laptop was rebuilding its connection", async () => {
    const { result } = await mountHost();
    expect(result.current.currentQuestion).toBeNull();

    // The press lands after the rebuild's reads but before the channels join:
    // its broadcast is missed, and nothing else would refresh for ~15s.
    h.db.questions[0].played_at = "2026-10-07T00:11:00.000Z";
    h.db.reveals.push({
      id: "r2",
      game_id: "game-a",
      question_id: "q1",
      event: "reveal",
      occurred_at: "2026-10-07T00:11:00.000000+00:00",
      metadata: null,
    });
    h.db.players.push({
      id: "player-2",
      night_id: h.NIGHT,
      device_id: "device-2",
      display_name: "Bo",
      joined_at: "2026-10-07T00:11:30.000Z",
      removed_at: null,
    });
    expect(result.current.currentQuestion).toBeNull();

    await joinChannels();

    expect(result.current.currentQuestion?.id).toBe("q1");
    expect(result.current.currentReveal?.id).toBe("r2");
    expect(result.current.players.map((player) => player.id)).toEqual(["player-1", "player-2"]);
  });

  it("catches up on a question that was answered while the laptop was deaf", async () => {
    h.db.questions[0].played_at = "2026-10-07T00:11:00.000Z";
    const { result } = await mountHost();
    expect(result.current.currentQuestion?.id).toBe("q1");

    h.db.questions[0].finished_at = "2026-10-07T00:11:25.000Z";
    h.db.reveals.push({
      id: "r2",
      game_id: "game-a",
      question_id: "q1",
      event: "resolve",
      occurred_at: "2026-10-07T00:11:25.000000+00:00",
      metadata: { correct_index: 2 },
    });
    await joinChannels();

    expect(result.current.currentQuestion).toBeNull();
    expect(result.current.lastResolvedQuestion?.id).toBe("q1");
    // The answer is merged back from the resolve reveal, as in the bootstrap.
    expect(result.current.lastResolvedQuestion?.correct_index).toBe(2);
  });

  it("waits for both live channels: one joining alone does not trigger a re-read", async () => {
    await mountHost();
    expect(h.joinCallbacks).toHaveLength(2);
    expect(h.executed.players).toBe(1);

    act(() => h.joinCallbacks[0]("SUBSCRIBED"));
    await flush();
    expect(h.executed.players).toBe(1);

    act(() => h.joinCallbacks[1]("SUBSCRIBED"));
    await flush();
    expect(h.executed.players).toBe(2);

    // A later status callback from either one changes nothing.
    act(() => h.joinCallbacks[0]("SUBSCRIBED"));
    await flush();
    expect(h.executed.players).toBe(2);
  });

  it("re-reads only when the channels become live, not on repeat status callbacks", async () => {
    await mountHost();
    expect(h.executed.players).toBe(1);

    await joinChannels();
    expect(h.executed.players).toBe(2);

    await joinChannels();
    await joinChannels();
    expect(h.executed.players).toBe(2);
  });

  it("re-reads on request and coalesces overlapping requests into one trailing read", async () => {
    const { result } = await mountHost();
    expect(h.executed.players).toBe(1);

    const hold = deferred();
    h.gates.set("players", hold.promise);
    let done = 0;
    act(() => {
      for (let i = 0; i < 3; i += 1) {
        void result.current.requestLiveCatchUp?.().then(() => { done += 1; });
      }
    });
    await flush();
    expect(h.executed.players).toBe(2);
    expect(done).toBe(0);

    h.gates.delete("players");
    hold.release();
    await flush();

    // One read that was in flight + exactly one trailing read for the other two.
    expect(h.executed.players).toBe(3);
    expect(done).toBe(3);
  });

  it("applies the press right away: a request after a successful press shows the new state", async () => {
    const { result } = await mountHost();
    h.db.questions[1].played_at = "2026-10-07T00:12:00.000Z";

    await act(async () => {
      await result.current.requestLiveCatchUp?.();
    });

    expect(result.current.currentQuestion?.id).toBe("q2");
  });

  it("makes an in-flight catch-up read once more when a broadcast lands during it", async () => {
    const { result } = await mountHost();
    const hold = deferred();
    h.gates.set("players", hold.promise);
    act(() => {
      void result.current.requestLiveCatchUp?.();
    });
    await flush();
    expect(h.executed.players).toBe(2);

    // The in-flight read started before this reveal was saved...
    h.db.questions[0].played_at = "2026-10-07T00:13:00.000Z";
    act(() => {
      h.broadcastHandlers.get("reveal")?.({
        payload: { questionId: "q1", serverNow: "2026-10-07T00:13:00.100Z" },
      });
    });
    h.gates.delete("players");
    hold.release();
    await flush();

    // ...so it runs again, and the screen ends on the newest state.
    expect(h.executed.players).toBe(3);
    expect(result.current.currentQuestion?.id).toBe("q1");
  });

  it("does not put the board back when a read that started before a reveal finishes after it", async () => {
    const shown: Array<string | null> = [];
    const { result } = renderHook(() => {
      const room = useRoom({ roomCode: "ABCDEF", audience: "host" });
      shown.push(room.currentQuestion?.id ?? null);
      return room;
    });
    await flush();

    // A catch-up read starts: it reads the questions (no live one yet), then waits
    // on the slow players read.
    const hold = deferred();
    h.gates.set("players", hold.promise);
    act(() => {
      void result.current.requestLiveCatchUp?.();
    });
    await flush();
    expect(h.executed.players).toBe(2);
    h.gates.delete("players");

    // The reveal lands and its own refresh shows the question first...
    h.db.questions[0].played_at = "2026-10-07T00:13:00.000Z";
    act(() => {
      h.broadcastHandlers.get("reveal")?.({
        payload: { questionId: "q1", serverNow: "2026-10-07T00:13:00.100Z" },
      });
    });
    await flush();
    expect(result.current.currentQuestion?.id).toBe("q1");

    // ...then the older read finishes (the queued follow-up read is still on its
    // way). The screen must not go back to the board in between.
    const followUp = deferred();
    h.gates.set("players", followUp.promise);
    hold.release();
    await flush();
    expect(result.current.currentQuestion?.id).toBe("q1");

    followUp.release();
    h.gates.delete("players");
    await flush();
    expect(shown.slice(shown.indexOf("q1"))).not.toContain(null);
    expect(result.current.currentQuestion?.id).toBe("q1");
    // The follow-up that was already queued is the only extra read.
    expect(h.executed.players).toBe(3);
  });

  describe("a read that started before a roster or question change", () => {
    const player2 = {
      id: "player-2",
      night_id: "night-a",
      device_id: "device-2",
      display_name: "Bo",
      joined_at: "2026-10-07T00:11:30.000Z",
      removed_at: null,
    };
    const ids = (result: { current: { players: Array<{ id: string }> } }) =>
      result.current.players.map((player) => player.id);

    /** A catch-up read is in flight: its player/question reads have already been
     *  answered (from the rows as they are now) and it waits on the games read. */
    async function holdCatchUp(result: { current: { requestLiveCatchUp?: () => Promise<void> } }) {
      const hold = deferred();
      h.gates.set("games", hold.promise);
      act(() => {
        void result.current.requestLiveCatchUp?.();
      });
      await flush();
      h.gates.delete("games");
      return hold;
    }

    /** Let the held read finish while its queued follow-up read is still waiting,
     *  so a wrongly applied older result would be visible on screen. */
    async function finishWhileFollowUpWaits(hold: ReturnType<typeof deferred>) {
      const followUp = deferred();
      h.gates.set("games", followUp.promise);
      hold.release();
      await flush();
      return async () => {
        followUp.release();
        h.gates.delete("games");
        await flush();
      };
    }

    it("keeps a player who joined (row change) while the read was in flight", async () => {
      const { result } = await mountHost();
      const hold = await holdCatchUp(result);

      h.db.players.push(player2);
      act(() => {
        h.changeHandlers.get("players")?.({ eventType: "INSERT", new: player2, old: {} });
      });
      expect(ids(result)).toEqual(["player-1", "player-2"]);

      const done = await finishWhileFollowUpWaits(hold);
      expect(ids(result)).toEqual(["player-1", "player-2"]);
      await done();
      expect(ids(result)).toEqual(["player-1", "player-2"]);
    });

    it("keeps a player who joined (roster message) while the read was in flight", async () => {
      const { result } = await mountHost();
      const hold = await holdCatchUp(result);

      h.db.players.push(player2);
      act(() => {
        h.broadcastHandlers.get("roster-changed")?.({
          payload: { serverNow: "2026-10-07T00:11:30.100Z", displayName: "Bo" },
        });
      });
      await flush();
      expect(ids(result)).toEqual(["player-1", "player-2"]);

      const done = await finishWhileFollowUpWaits(hold);
      expect(ids(result)).toEqual(["player-1", "player-2"]);
      await done();
      expect(ids(result)).toEqual(["player-1", "player-2"]);
    });

    it("does not bring back a player who was removed while the read was in flight", async () => {
      h.db.players.push(player2);
      const { result } = await mountHost();
      expect(ids(result)).toEqual(["player-1", "player-2"]);
      const hold = await holdCatchUp(result);

      const removed = { ...player2, removed_at: "2026-10-07T00:12:00.000Z" };
      h.db.players[1] = removed;
      act(() => {
        h.changeHandlers.get("players")?.({ eventType: "UPDATE", new: removed, old: {} });
      });
      expect(ids(result)).toEqual(["player-1"]);

      const done = await finishWhileFollowUpWaits(hold);
      expect(ids(result)).toEqual(["player-1"]);
      await done();
      expect(ids(result)).toEqual(["player-1"]);
    });

    it("phone heartbeats do not throw a read away: 60 phones updating during one read = one read, applied", async () => {
      for (let n = 3; n <= 60; n += 1) {
        h.db.players.push({ ...player2, id: `player-${n}`, device_id: `device-${n}`, display_name: `P${n}` });
      }
      h.db.players.push({ ...player2, id: "player-2" });
      const { result } = await mountHost();
      expect(result.current.players).toHaveLength(60);
      // Sixty-one by the time the read goes out.
      h.db.players.push({ ...player2, id: "player-61", device_id: "device-61", display_name: "P61" });
      const hold = await holdCatchUp(result);
      const before = h.executed.players;

      // Every phone the host knows sends its heartbeat once while the read is in
      // flight; some also report seconds spent outside the app.
      for (const player of h.db.players.slice(0, 60)) {
        act(() => {
          h.changeHandlers.get("players")?.({
            eventType: "UPDATE",
            new: {
              ...player,
              last_seen_at: "2026-10-07T00:12:00.000Z",
              app_switch_total_seconds: String(player.id).endsWith("7") ? 12 : 0,
            },
            old: {},
          });
        });
      }
      hold.release();
      await flush();

      // The read was applied (player 61 is on screen) and nothing re-ran.
      expect(h.executed.players).toBe(before);
      expect(result.current.players).toHaveLength(61);
    });

    it("a rename during the read does throw it away, and the follow-up read shows the new name", async () => {
      const { result } = await mountHost();
      const hold = await holdCatchUp(result);
      const before = h.executed.players;

      const renamed = { ...h.db.players[0], display_name: "Alicia" };
      h.db.players[0] = renamed;
      act(() => {
        h.changeHandlers.get("players")?.({ eventType: "UPDATE", new: renamed, old: {} });
      });
      const done = await finishWhileFollowUpWaits(hold);
      expect(result.current.players[0].display_name).toBe("Alicia");
      await done();
      expect(h.executed.players).toBe(before + 1);
      expect(result.current.players[0].display_name).toBe("Alicia");
    });

    it("a can_answer change during the read throws it away too", async () => {
      const { result } = await mountHost();
      const hold = await holdCatchUp(result);
      const before = h.executed.players;

      const scoreOnly = { ...h.db.players[0], can_answer: false };
      h.db.players[0] = scoreOnly;
      act(() => {
        h.changeHandlers.get("players")?.({ eventType: "UPDATE", new: scoreOnly, old: {} });
      });
      const done = await finishWhileFollowUpWaits(hold);
      expect(result.current.players[0].can_answer).toBe(false);
      await done();
      expect(h.executed.players).toBe(before + 1);
    });

    it("a live row that lists its columns in another order does not cause a redraw on the next read", async () => {
      const { result } = await mountHost();
      const reordered = Object.fromEntries(Object.entries(h.db.players[0]).reverse());
      act(() => {
        h.changeHandlers.get("players")?.({ eventType: "UPDATE", new: reordered, old: {} });
      });
      const shown = result.current.players;

      await act(async () => {
        await result.current.requestLiveCatchUp?.();
      });

      expect(result.current.players).toBe(shown);
    });

    it("drops the older result for a question change in this night's categories", async () => {
      const { result } = await mountHost();
      h.db.players.push(player2);
      const hold = await holdCatchUp(result);
      const before = h.executed.players;

      act(() => {
        h.changeHandlers.get("questions")?.({
          eventType: "UPDATE",
          new: { id: "q2", category_id: "cat-a", played_at: null, finished_at: null },
          old: {},
        });
      });
      hold.release();
      await flush();

      // Dropped, and the follow-up read (queued by that change) ran instead.
      expect(h.executed.players).toBe(before + 1);
      expect(ids(result)).toEqual(["player-1", "player-2"]);
    });

    it("is not held up by question changes from other nights", async () => {
      const { result } = await mountHost();
      h.db.players.push(player2);
      const hold = await holdCatchUp(result);
      const before = h.executed.players;

      for (let count = 0; count < 5; count += 1) {
        act(() => {
          h.changeHandlers.get("questions")?.({
            eventType: "UPDATE",
            new: { id: `other-${count}`, category_id: "cat-other", played_at: null, finished_at: null },
            old: {},
          });
        });
      }
      hold.release();
      await flush();

      // The read applied as normal and nothing re-ran.
      expect(h.executed.players).toBe(before);
      expect(ids(result)).toEqual(["player-1", "player-2"]);
    });
  });

  describe("when the games read fails", () => {
    it("on first load still finds the newest reveal, the way the old joined read did", async () => {
      h.failing.add("games");
      const { result } = await mountHost();

      expect(result.current.games).toEqual([]);
      expect(result.current.currentReveal?.id).toBe("r1");
      const joined = h.calls.filter((call) =>
        call.table === "reveals" && call.ops.some(([name, column]) => name === "eq" && column === "games.night_id"));
      expect(joined).toHaveLength(1);
      expect(joined[0].ops).toContainEqual(["select", "*, games!inner(night_id)"]);
    });

    it("on a later read keeps using the game ids it already knows, with no extra read", async () => {
      const { result } = await mountHost();
      h.db.reveals.push({
        id: "r2",
        game_id: "game-a",
        question_id: "q1",
        event: "reveal",
        occurred_at: "2026-10-07T00:11:00.000000+00:00",
        metadata: null,
      });
      h.failing.add("games");
      const before = h.executed.reveals;

      await act(async () => {
        await result.current.requestLiveCatchUp?.();
      });

      expect(h.executed.reveals).toBe(before + 1);
      expect(result.current.currentReveal?.id).toBe("r2");
    });
  });

  it("keeps broadcast tags and the same row objects when nothing changed", async () => {
    h.db.questions[0].played_at = "2026-10-07T00:11:00.000Z";
    const { result } = await mountHost();
    act(() => {
      h.broadcastHandlers.get("reveal")?.({
        payload: { questionId: "q1", serverNow: "2026-10-07T00:13:00.100Z" },
      });
    });
    await flush();
    const before = result.current;
    expect(before.lastBroadcast?.event).toBe("reveal");

    await act(async () => {
      await result.current.requestLiveCatchUp?.();
    });

    expect(result.current.lastBroadcast).toBe(before.lastBroadcast);
    expect(result.current.games).toBe(before.games);
    expect(result.current.players).toBe(before.players);
    expect(result.current.currentQuestion).toBe(before.currentQuestion);
    expect(result.current.currentReveal).toBe(before.currentReveal);
  });

  it("never moves the newest reveal or the last answer backwards", async () => {
    h.db.questions[0].played_at = "2026-10-07T00:10:00.000Z";
    h.db.questions[0].finished_at = "2026-10-07T00:10:30.000Z";
    h.db.reveals.push({
      id: "r-resolve",
      game_id: "game-a",
      question_id: "q1",
      event: "resolve",
      occurred_at: "2026-10-07T00:10:30.000000+00:00",
      metadata: { correct_index: 0 },
    });
    const { result } = await mountHost();
    expect(result.current.lastResolvedQuestion?.id).toBe("q1");

    // A newer reveal arrives live; the database read below is older than it.
    act(() => {
      h.changeHandlers.get("reveals")?.({
        eventType: "INSERT",
        new: {
          id: "r-newer",
          game_id: "game-a",
          question_id: "q2",
          event: "advance",
          occurred_at: "2026-10-07T00:30:00.000000+00:00",
          metadata: null,
        },
        old: {},
      });
    });
    expect(result.current.currentReveal?.id).toBe("r-newer");

    // q2 resolved later on, but this read still shows only the earlier state.
    h.db.questions[1].played_at = "2026-10-07T00:20:00.000Z";
    h.db.questions[1].finished_at = "2026-10-07T00:20:30.000Z";
    h.db.questions[0].finished_at = "2026-10-07T00:09:00.000Z";
    await act(async () => {
      await result.current.requestLiveCatchUp?.();
    });

    expect(result.current.currentReveal?.id).toBe("r-newer");
    expect(result.current.lastResolvedQuestion?.id).toBe("q2");

    // A read that shows only the older finished question can't win it back.
    h.db.questions[1].played_at = null;
    h.db.questions[1].finished_at = null;
    await act(async () => {
      await result.current.requestLiveCatchUp?.();
    });
    expect(result.current.lastResolvedQuestion?.id).toBe("q2");
  });

  it("leaves a piece alone when its read fails", async () => {
    const { result } = await mountHost();
    h.failing.add("players");
    h.db.players.push({
      id: "player-2",
      night_id: h.NIGHT,
      device_id: "device-2",
      display_name: "Bo",
      joined_at: "2026-10-07T00:11:30.000Z",
      removed_at: null,
    });
    h.db.questions[0].played_at = "2026-10-07T00:11:00.000Z";

    await act(async () => {
      await result.current.requestLiveCatchUp?.();
    });

    expect(result.current.players.map((player) => player.id)).toEqual(["player-1"]);
    expect(result.current.currentQuestion?.id).toBe("q1");
  });

  it("keeps the last good screen when the whole read times out or throws", async () => {
    const { result } = await mountHost();
    const before = result.current;
    h.client.from.mockImplementationOnce(() => {
      throw new Error("network down");
    });

    await act(async () => {
      await result.current.requestLiveCatchUp?.();
    });

    expect(result.current.games).toBe(before.games);
    expect(result.current.currentQuestion).toBe(before.currentQuestion);
  });

  it("keeps a reveal's answer when the answer lookup comes back empty", async () => {
    h.db.questions[0].played_at = "2026-10-07T00:11:00.000Z";
    h.db.questions[0].finished_at = "2026-10-07T00:11:25.000Z";
    h.db.reveals.push({
      id: "r2",
      game_id: "game-a",
      question_id: "q1",
      event: "resolve",
      occurred_at: "2026-10-07T00:11:25.000000+00:00",
      metadata: { correct_index: 2 },
    });
    const { result } = await mountHost();
    expect(result.current.lastResolvedQuestion?.correct_index).toBe(2);

    h.failing.add("reveals:answer");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await act(async () => {
      await result.current.requestLiveCatchUp?.();
    });
    warn.mockRestore();

    expect(result.current.lastResolvedQuestion?.id).toBe("q1");
    expect(result.current.lastResolvedQuestion?.correct_index).toBe(2);
  });

  it("gives up on a hung read after the timeout and still serves the next request", async () => {
    vi.useFakeTimers();
    try {
      h.db.questions[0].played_at = "2026-10-07T00:11:00.000Z";
      h.db.questions[0].finished_at = "2026-10-07T00:11:25.000Z";
      h.db.reveals.push({
        id: "r2",
        game_id: "game-a",
        question_id: "q1",
        event: "resolve",
        occurred_at: "2026-10-07T00:11:25.000000+00:00",
        metadata: { correct_index: 2 },
      });
      const { result } = await mountHost();

      const hold = deferred();
      h.gates.set("reveals:answer", hold.promise);
      h.db.players.push({
        id: "player-2",
        night_id: h.NIGHT,
        device_id: "device-2",
        display_name: "Bo",
        joined_at: "2026-10-07T00:11:30.000Z",
        removed_at: null,
      });
      let settled = false;
      act(() => {
        void result.current.requestLiveCatchUp?.().then(() => { settled = true; });
      });
      await flush();
      expect(settled).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      await flush();
      // Timed out: nothing was applied, and the lock is released.
      expect(settled).toBe(true);
      expect(result.current.players.map((player) => player.id)).toEqual(["player-1"]);

      h.gates.delete("reveals:answer");
      hold.release();
      await act(async () => {
        await result.current.requestLiveCatchUp?.();
      });
      expect(result.current.players.map((player) => player.id)).toEqual(["player-1", "player-2"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves resilient nights to their server projection", async () => {
    h.setResilient();
    const { result } = await mountHost();
    expect(h.executed.players).toBe(1);

    await joinChannels();
    await act(async () => {
      await result.current.requestLiveCatchUp?.();
    });

    expect(h.executed.players).toBe(1);
  });
});

describe("host laptop: route poll judges an outage (real useRoomRoutePoll)", () => {
  const routeRead = vi.mocked(fetchRoomSnapshotPayload);
  const goodPayload = {
    audience: "host",
    night: { id: "night-a" },
    hostDefaultThemeKey: "may",
    games: [],
    categories: [],
    players: [],
    currentQuestion: null,
    lastResolvedQuestion: null,
    currentReveal: null,
    allQuestions: [],
    liveAnswers: [],
    scores: [],
    allScores: [],
    tvPlayerKeys: {},
    roomMagicReactions: [],
  } as unknown as Awaited<ReturnType<typeof fetchRoomSnapshotPayload>>;
  const noRoute = () => Promise.reject(new Error("route down"));

  // Small steps: React holds re-renders until an act() ends, so one long advance
  // would run a heartbeat's rebuild at the end of it instead of when it fired.
  async function advance(ms: number) {
    for (let left = ms; left >= 0; left -= 250) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(Math.min(left, 250));
      });
      if (left <= 250) break;
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    // rand 0: no first-fetch spread, and route polls land every 3.75s.
    vi.spyOn(Math, "random").mockReturnValue(0);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    h.realRoutePoll = true;
    h.seed();
    __resetReachabilityForTests();
    __resetRoomFallbackForTests();
    routeRead.mockReset();
    routeRead.mockImplementation(noRoute);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ nightId: h.NIGHT, hostDefaultThemeKey: "may" }),
    })));
  });

  afterEach(() => {
    h.realRoutePoll = false;
    h.gates.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, "visibilityState");
  });

  /** Route reads since the outage began. The host also reads it once at mount for TV keys. */
  let routeReadsAtMount = 0;
  const routeReads = () => routeRead.mock.calls.length - routeReadsAtMount;

  /** t=15s the heartbeat re-reads, t=20s those direct reads time out: the first miss. */
  async function loseDirectReads() {
    await advance(0);
    routeReadsAtMount = routeRead.mock.calls.length;
    h.gates.set("games", new Promise<void>(() => undefined));
    await advance(20_500);
  }

  it("polls from the first missed read, and only the second failed poll marks unreachable", async () => {
    await mountHost();
    expect(getReachability()).toBe("ok");

    await loseDirectReads();
    // The one-off route read also failed. A room is on screen, so no verdict yet.
    expect(routeReads()).toBe(1);
    expect(getReachability()).toBe("ok");

    await advance(3_750);
    expect(routeReads()).toBe(2);
    expect(getReachability()).toBe("ok");

    await advance(3_750);
    expect(routeReads()).toBe(3);
    expect(getReachability()).toBe("unreachable");
  });

  it("the amber state waits for a real reply from the route", async () => {
    await mountHost();
    await loseDirectReads();
    expect(getRoomFallback().backupMode).toBe(false);

    routeRead.mockImplementation(async () => goodPayload);
    await advance(3_750);

    expect(routeReads()).toBe(2);
    expect(getRoomFallback().backupMode).toBe(true);
  });

  it("a good poll between two bad ones resets the count", async () => {
    await mountHost();
    await loseDirectReads();

    await advance(3_750); // miss
    routeRead.mockImplementationOnce(async () => goodPayload);
    await advance(3_750); // reply: t=27.5s
    await advance(3_750); // miss: t=31.25s, the t=30s heartbeat has also run

    expect(getReachability()).toBe("ok");
  });

  it("a connection rebuild cannot kill a poll that is running", async () => {
    await mountHost();
    await loseDirectReads();
    const pollSignals: AbortSignal[] = [];
    routeRead.mockImplementation((_code, options) => {
      if (options?.signal) pollSignals.push(options.signal);
      return new Promise(() => undefined);
    });
    await advance(3_750);
    expect(pollSignals).toHaveLength(1);

    act(() => {
      for (const callback of [...h.joinCallbacks]) callback("CHANNEL_ERROR");
    });
    await advance(100);

    expect(pollSignals[0].aborted).toBe(false);
  });

  it("direct reads coming back stop the poll", async () => {
    await mountHost();
    await loseDirectReads();
    await advance(3_750);

    h.gates.clear();
    await advance(6_500); // the t=30s heartbeat's direct reads work again
    const reads = routeReads();
    await advance(10_000); // two poll slots, and still short of the t=45s heartbeat

    expect(routeReads()).toBe(reads);
    expect(getReachability()).toBe("ok");
    expect(getRoomFallback().backupMode).toBe(false);
  });

  it("a host with nothing on screen still gets the verdict straight away", async () => {
    h.gates.set("games", new Promise<void>(() => undefined));
    renderHook(() => useRoom({ roomCode: "ABCDEF", audience: "host" }));

    await advance(5_001);

    expect(getReachability()).toBe("unreachable");
  });
});
