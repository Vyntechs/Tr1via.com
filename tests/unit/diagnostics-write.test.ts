// The "after the response, and never in the way" plumbing for diagnostic rows.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const afterMock = vi.hoisted(() => vi.fn());
const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: afterMock,
}));
vi.mock("@/lib/supabase/admin", () => adminMock);

import {
  __clearDiagCacheForTests,
  __diagWriteCountersForTests,
  __resetDiagWriteForTests,
  __setDiagSchedulerForTests,
  insertDiagRows,
  lookupPlayerId,
  lookupQuestionContext,
  lookupRoomNight,
  runDiagCleanup,
  scheduleDiagWrite,
} from "@/lib/diagnostics/write";
import { DIAG_MAX_WRITES_IN_FLIGHT, DIAG_WRITE_TIMEOUT_MS } from "@/lib/diagnostics/config";

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  __resetDiagWriteForTests();
});
afterEach(() => {
  vi.useRealTimers();
  warn.mockRestore();
  __setDiagSchedulerForTests(null);
});

describe("scheduleDiagWrite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setDiagSchedulerForTests(null);
  });

  it("hands the work to after() so it runs once the response is out", async () => {
    const task = vi.fn(async () => {});
    scheduleDiagWrite(task);
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(task).not.toHaveBeenCalled(); // not run inline
    await afterMock.mock.calls[0]![0]();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("swallows a task that fails", async () => {
    scheduleDiagWrite(async () => {
      throw new Error("insert blew up");
    });
    await expect(afterMock.mock.calls[0]![0]()).resolves.toBeUndefined();
  });

  it("still runs the task (quietly) when after() is unavailable", async () => {
    afterMock.mockImplementation(() => {
      throw new Error("after was called outside a request scope");
    });
    const task = vi.fn(async () => {});
    expect(() => scheduleDiagWrite(task)).not.toThrow();
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("never throws even if the scheduler itself breaks", () => {
    __setDiagSchedulerForTests(() => {
      throw new Error("scheduler exploded");
    });
    expect(() => scheduleDiagWrite(async () => {})).not.toThrow();
  });
});

describe("insertDiagRows", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts one batch with the service-role client", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ insert }));
    adminMock.getSupabaseAdmin.mockReturnValue({ from });
    await insertDiagRows("diag_device_events", [{ kind: "net" }]);
    expect(from).toHaveBeenCalledWith("diag_device_events");
    expect(insert).toHaveBeenCalledWith([{ kind: "net" }]);
  });

  it("does nothing for an empty batch", async () => {
    await insertDiagRows("diag_device_events", []);
    expect(adminMock.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it("ignores a missing table, a rejected insert and a broken client", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: () => ({
        insert: async () => {
          throw new Error('relation "diag_answer_events" does not exist');
        },
      }),
    });
    await expect(insertDiagRows("diag_answer_events", [{ a: 1 }])).resolves.toBeUndefined();

    adminMock.getSupabaseAdmin.mockImplementation(() => {
      throw new Error("Missing env");
    });
    await expect(insertDiagRows("diag_answer_events", [{ a: 1 }])).resolves.toBeUndefined();
  });
});

describe("cached lookups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearDiagCacheForTests();
  });

  function adminWith(tables: Record<string, Record<string, unknown> | null>) {
    const calls: string[] = [];
    return {
      calls,
      admin: {
        from: (table: string) => {
          calls.push(table);
          const chain = {
            select: () => chain,
            eq: () => chain,
            maybeSingle: async () => ({ data: tables[table] ?? null, error: null }),
          };
          return chain;
        },
      },
    };
  }

  it("finds the game and night for a question and remembers it", async () => {
    const { admin, calls } = adminWith({
      questions: { category_id: "c1" },
      categories: { game_id: "g1" },
      games: { night_id: "n1" },
    });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    expect(await lookupQuestionContext("q1")).toEqual({ gameId: "g1", nightId: "n1" });
    const first = calls.length;
    expect(await lookupQuestionContext("q1")).toEqual({ gameId: "g1", nightId: "n1" });
    expect(calls.length).toBe(first); // second call came from memory
  });

  it("shares one lookup between taps that ask at the same moment", async () => {
    const { admin, calls } = adminWith({ players: { id: "p1" } });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const answers = await Promise.all(Array.from({ length: 10 }, () => lookupPlayerId("n1", "d1")));
    expect(answers).toEqual(Array(10).fill("p1"));
    expect(calls).toEqual(["players"]);
  });

  it("does not remember a miss (the row may not exist yet)", async () => {
    const { admin, calls } = adminWith({ players: null });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    expect(await lookupPlayerId("n1", "d1")).toBeNull();
    expect(await lookupPlayerId("n1", "d1")).toBeNull();
    expect(calls).toEqual(["players", "players"]);
  });

  it("returns null instead of throwing when the database is down", async () => {
    adminMock.getSupabaseAdmin.mockImplementation(() => {
      throw new Error("down");
    });
    expect(await lookupPlayerId("n1", "d1")).toBeNull();
  });
});

// ─── a failed or stuck insert is seen, never felt ─────────────────────
describe("a failing insert", () => {
  function adminInsert(insert: (rows: unknown, ...rest: unknown[]) => unknown) {
    adminMock.getSupabaseAdmin.mockReturnValue({ from: () => ({ insert }) });
  }
  const lines = () => warn.mock.calls.map((c) => String(c[0]));

  it("prints one short line when the database answers with an error (supabase-js does not throw)", async () => {
    adminInsert(async () => ({
      error: { code: "42P01", message: 'relation "diag_answer_events" does not exist', details: "Failing row contains (secret)" },
    }));
    await expect(insertDiagRows("diag_answer_events", [{ a: 1 }])).resolves.toBeUndefined();
    expect(lines()).toEqual(["[diag] insert failed table=diag_answer_events code=42P01"]);
    // Never the message or the details (Postgres can put row contents in them).
    expect(lines().join("\n")).not.toContain("secret");
    expect(lines().join("\n")).not.toContain("does not exist");
  });

  it("prints the same short line when the insert throws, and when the client is broken", async () => {
    adminInsert(async () => {
      throw new Error("socket hang up");
    });
    await insertDiagRows("diag_device_events", [{ a: 1 }]);
    adminMock.getSupabaseAdmin.mockImplementation(() => {
      throw new Error("Missing env");
    });
    await insertDiagRows("diag_server_actions", [{ a: 1 }]);
    expect(lines()).toEqual([
      "[diag] insert failed table=diag_device_events code=exception",
      "[diag] insert failed table=diag_server_actions code=exception",
    ]);
  });

  it("is quiet when the insert works", async () => {
    adminInsert(async () => ({ error: null }));
    await insertDiagRows("diag_device_events", [{ a: 1 }]);
    expect(warn).not.toHaveBeenCalled();
    expect(__diagWriteCountersForTests()).toMatchObject({ failed: 0, dropped: 0 });
  });

  it("says it at most once a minute per table and reason, and counts the rest", async () => {
    let now = 1_000_000;
    __resetDiagWriteForTests({ now: () => now });
    adminInsert(async () => ({ error: { code: "42P01" } }));
    for (let i = 0; i < 5; i++) await insertDiagRows("diag_answer_events", [{ a: i }]);
    expect(lines()).toHaveLength(1);
    now += 61_000;
    await insertDiagRows("diag_answer_events", [{ a: 9 }]);
    expect(lines()).toHaveLength(2);
    expect(lines()[1]).toBe("[diag] insert failed table=diag_answer_events code=42P01 (+4 more since the last line)");
    // another table or another reason is its own line
    await insertDiagRows("diag_device_events", [{ a: 1 }]);
    expect(lines()).toHaveLength(3);
  });

  it("gives up after the short deadline instead of waiting on a stuck database, and cancels the request", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: () => ({
        insert: () => {
          const pendingForever = new Promise(() => {}) as Promise<unknown> & { abortSignal: (s: AbortSignal) => unknown };
          pendingForever.abortSignal = (s) => {
            signal = s;
            return pendingForever;
          };
          return pendingForever;
        },
      }),
    });
    const done = insertDiagRows("diag_answer_events", [{ a: 1 }]);
    let finished = false;
    void done.then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(DIAG_WRITE_TIMEOUT_MS - 100);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(finished).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(lines()).toEqual(["[diag] insert failed table=diag_answer_events code=timeout"]);
    expect(__diagWriteCountersForTests().failed).toBe(1);
  });

  it("stops waiting on a client that ignores the cancel signal", async () => {
    vi.useFakeTimers();
    adminInsert(() => new Promise(() => {}));
    const done = insertDiagRows("diag_answer_events", [{ a: 1 }]);
    await vi.advanceTimersByTimeAsync(DIAG_WRITE_TIMEOUT_MS + 10);
    await expect(done).resolves.toBeUndefined();
  });
});

describe("how many log writes may run at once", () => {
  function manualScheduler() {
    const queued: Array<() => Promise<void>> = [];
    __setDiagSchedulerForTests((task) => {
      queued.push(task);
    });
    return queued;
  }

  it("lets a normal burst through and drops the extra ones, counting them, instead of piling up", async () => {
    const queued = manualScheduler();
    const release: Array<() => void> = [];
    const started = vi.fn();
    for (let i = 0; i < DIAG_MAX_WRITES_IN_FLIGHT + 7; i++) {
      scheduleDiagWrite(
        () =>
          new Promise<void>((resolve) => {
            started();
            release.push(resolve);
          }),
      );
    }
    expect(queued).toHaveLength(DIAG_MAX_WRITES_IN_FLIGHT); // the 7 extra were never queued
    expect(__diagWriteCountersForTests()).toEqual({ dropped: 7, failed: 0, inFlight: DIAG_MAX_WRITES_IN_FLIGHT });
    expect(lines()).toEqual(["[diag] dropping log writes: too many in flight"]);

    const running = queued.map((task) => task());
    await Promise.resolve();
    expect(started).toHaveBeenCalledTimes(DIAG_MAX_WRITES_IN_FLIGHT);
    release.forEach((r) => r());
    await Promise.all(running);
    expect(__diagWriteCountersForTests().inFlight).toBe(0);
  });

  const lines = () => warn.mock.calls.map((c) => String(c[0]));

  it("frees the slot when a task fails, and when the scheduler itself breaks", async () => {
    const queued = manualScheduler();
    scheduleDiagWrite(async () => {
      throw new Error("boom");
    });
    await queued[0]!();
    expect(__diagWriteCountersForTests().inFlight).toBe(0);

    __setDiagSchedulerForTests(() => {
      throw new Error("scheduler exploded");
    });
    scheduleDiagWrite(async () => {});
    expect(__diagWriteCountersForTests().inFlight).toBe(0);
  });

  it("gives up on a task that never finishes, so one hung write cannot hold a slot for ever", async () => {
    vi.useFakeTimers();
    const queued = manualScheduler();
    scheduleDiagWrite(() => new Promise<void>(() => {}));
    const running = queued[0]!();
    expect(__diagWriteCountersForTests().inFlight).toBe(1);
    await vi.advanceTimersByTimeAsync(DIAG_WRITE_TIMEOUT_MS * 5 + 100);
    await running;
    expect(__diagWriteCountersForTests().inFlight).toBe(0);
  });

  it("records how many writes were dropped or failed as one system row, once the database takes writes again", async () => {
    let now = 5_000_000;
    __resetDiagWriteForTests({ now: () => now });
    const queued = manualScheduler();
    const hold: Array<() => void> = [];
    for (let i = 0; i < DIAG_MAX_WRITES_IN_FLIGHT + 3; i++) {
      scheduleDiagWrite(() => new Promise<void>((resolve) => hold.push(resolve)));
    }
    const running = queued.map((task) => task());
    const inserts: Array<{ table: string; rows: Record<string, unknown>[] }> = [];
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: (table: string) => ({
        insert: async (rows: Record<string, unknown>[]) => {
          inserts.push({ table, rows });
          return { error: null };
        },
      }),
    });
    hold.forEach((r) => r());
    await Promise.all(running);
    await vi.waitFor(() => expect(inserts).toHaveLength(1));
    expect(inserts[0]!.table).toBe("diag_server_actions");
    expect(inserts[0]!.rows[0]).toMatchObject({
      actor: "system",
      action: "diag_drops",
      http_status: 0,
      outcome: "gap",
      reason: "dropped=3 failed=0",
      steps: { dropped: 3, failed: 0 },
    });
    await vi.waitFor(() => expect(__diagWriteCountersForTests()).toMatchObject({ dropped: 0, failed: 0 }));
    now += 1;
  });

  it("keeps the counts if the row could not be written, and tries again later", async () => {
    let now = 9_000_000;
    __resetDiagWriteForTests({ now: () => now });
    const queued = manualScheduler();
    adminMock.getSupabaseAdmin.mockReturnValue({ from: () => ({ insert: async () => ({ error: { code: "57P01" } }) }) });
    // one failed write is counted
    await insertDiagRows("diag_answer_events", [{ a: 1 }]);
    scheduleDiagWrite(async () => {});
    await queued[0]!();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(__diagWriteCountersForTests().failed).toBe(1); // still owed

    const inserts: Array<Record<string, unknown>[]> = [];
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: () => ({
        insert: async (rows: Record<string, unknown>[]) => {
          inserts.push(rows);
          return { error: null };
        },
      }),
    });
    now += 11_000; // past the once-per-10-seconds limit
    scheduleDiagWrite(async () => {});
    await queued[1]!();
    await vi.waitFor(() => expect(inserts).toHaveLength(1));
    expect(inserts[0]![0]).toMatchObject({ reason: "dropped=0 failed=1" });
  });
});

describe("lookups give up quickly too", () => {
  beforeEach(() => __clearDiagCacheForTests());

  it("returns null when the database does not answer in time", async () => {
    vi.useFakeTimers();
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: () => {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          abortSignal: () => chain,
          maybeSingle: () => new Promise(() => {}),
        };
        return chain;
      },
    });
    const answer = lookupPlayerId("n1", "d1");
    await vi.advanceTimersByTimeAsync(DIAG_WRITE_TIMEOUT_MS + 10);
    await expect(answer).resolves.toBeNull();
  });

  it("remembers that a room code does not exist for a short while, so made-up codes cannot hammer the database", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: (table: string) => {
        calls.push(table);
        const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) };
        return chain;
      },
    });
    expect(await lookupRoomNight("ZZZZZZ")).toBeNull();
    expect(await lookupRoomNight("ZZZZZZ")).toBeNull();
    expect(calls).toEqual(["nights"]); // second time came from memory
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await lookupRoomNight("ZZZZZZ")).toBeNull();
    expect(calls).toEqual(["nights", "nights"]);
  });

  it("still finds a room that exists, and remembers it", async () => {
    const calls: string[] = [];
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: (table: string) => {
        calls.push(table);
        const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { id: "n1" }, error: null }) };
        return chain;
      },
    });
    expect(await lookupRoomNight("K9PR4M")).toBe("n1");
    expect(await lookupRoomNight("K9PR4M")).toBe("n1");
    expect(calls).toEqual(["nights"]);
  });
});

describe("runDiagCleanup", () => {
  const lines = () => warn.mock.calls.map((c) => String(c[0]));

  it("calls the 45-day cleanup function with a fixed day count", async () => {
    const rpc = vi.fn(async () => ({ data: 12, error: null }));
    adminMock.getSupabaseAdmin.mockReturnValue({ rpc });
    await expect(runDiagCleanup()).resolves.toEqual({ ok: true, removed: 12 });
    expect(rpc).toHaveBeenCalledWith("cleanup_diagnostic_logs", { p_days: 45 });
  });

  it("reports a database error as one short line and a result, never a throw", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue({
      rpc: async () => ({ data: null, error: { code: "42883", message: "function does not exist" } }),
    });
    await expect(runDiagCleanup()).resolves.toEqual({ ok: false, code: "42883" });
    expect(lines()).toEqual(["[diag] cleanup failed code=42883"]);
  });

  it("gives up on a stuck database", async () => {
    vi.useFakeTimers();
    adminMock.getSupabaseAdmin.mockReturnValue({ rpc: () => new Promise(() => {}) });
    const result = runDiagCleanup();
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(result).resolves.toEqual({ ok: false, code: "timeout" });
  });
});
