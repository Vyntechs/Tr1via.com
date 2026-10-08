import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    failing,
    client,
    broadcastHandlers,
    changeHandlers,
    joinCallbacks,
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
vi.mock("@/lib/hooks/useRoomRoutePoll", () => ({ useRoomRoutePoll: () => undefined }));

import { useRoom } from "@/lib/hooks/useRoom";

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
