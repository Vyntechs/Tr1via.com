// The "after the response, and never in the way" plumbing for diagnostic rows.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const afterMock = vi.hoisted(() => vi.fn());
const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: afterMock,
}));
vi.mock("@/lib/supabase/admin", () => adminMock);

import { DiagLookupSlow } from "@/lib/diagnostics/deadline";
import {
  __clearDiagCacheForTests,
  __diagWriteCountersForTests,
  __resetDiagWriteForTests,
  __setDiagSchedulerForTests,
  insertDiagRows,
  lookupNightOwner,
  lookupPlayerId,
  lookupQuestionContext,
  lookupRoomNight,
  noteIgnored,
  recordDiagRows,
  runDiagCleanup,
  scheduleDiagWrite,
} from "@/lib/diagnostics/write";
import {
  DIAG_BUCKET_ROW_CAPS,
  DIAG_CLEANUP_MAX_BATCHES,
  DIAG_DEVICE_ROW_CAPS,
  DIAG_JOB_DEADLINE_MS,
  DIAG_MAX_WRITES_IN_FLIGHT,
  DIAG_QUEUE_WAIT_MS,
  DIAG_QUOTA_BUSY_BACKOFF_MS,
  DIAG_QUOTA_BUSY_RETRIES,
  DIAG_WRITE_QUEUE_MAX,
  DIAG_NIGHT_ROW_CAP,
  DIAG_NIGHT_SERVER_ROW_CAP,
  DIAG_QUOTA_FULL_MEMORY_MS,
  DIAG_QUOTA_LEASE_ROWS,
  DIAG_WRITE_TIMEOUT_MS,
} from "@/lib/diagnostics/config";

let warn: ReturnType<typeof vi.spyOn>;
let info: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  __resetDiagWriteForTests();
  __clearDiagCacheForTests();
});
afterEach(() => {
  vi.useRealTimers();
  warn.mockRestore();
  info.mockRestore();
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

  it("remembers a miss for a few seconds (a made-up id costs one read), then asks again (the row may exist by now)", async () => {
    vi.useFakeTimers();
    const { admin, calls } = adminWith({ players: null });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    expect(await lookupPlayerId("n1", "d1")).toBeNull();
    expect(await lookupPlayerId("n1", "d1")).toBeNull();
    expect(calls).toEqual(["players"]); // the second look came from memory
    await vi.advanceTimersByTimeAsync(11_000);
    expect(await lookupPlayerId("n1", "d1")).toBeNull();
    expect(calls).toEqual(["players", "players"]);
  });

  it("every kind of lookup remembers a miss, not just room codes", async () => {
    const { admin, calls } = adminWith({ games: null, questions: null, nights: null });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    for (let i = 0; i < 3; i++) {
      await lookupQuestionContext("q-junk");
      await lookupNightOwner("n-junk");
      await lookupRoomNight("ZZZZZZ");
    }
    expect(calls.sort()).toEqual(["nights", "nights", "questions"]);
  });

  it("a flood of made-up ids does not push the good entries out of memory", async () => {
    const tables: Record<string, Record<string, unknown> | null> = { players: { id: "p1" } };
    const { admin, calls } = adminWith(tables);
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    expect(await lookupPlayerId("n1", "real-device")).toBe("p1");
    tables.players = null;
    for (let i = 0; i < 1500; i++) await lookupPlayerId("n1", `made-up-${i}`);
    const before = calls.length;
    tables.players = { id: "p1" };
    expect(await lookupPlayerId("n1", "real-device")).toBe("p1");
    expect(calls.length).toBe(before); // still remembered
  });

  it("does not take a database error for 'no such row', so it is not remembered as a miss", async () => {
    const calls: string[] = [];
    let failing = true;
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: (table: string) => {
        calls.push(table);
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () =>
            failing ? { data: null, error: { code: "57014" } } : { data: { id: "p1" }, error: null },
        };
        return chain;
      },
    });
    // a failing database is "could not check" (it throws), never "no such player"
    await expect(lookupPlayerId("n1", "d1")).rejects.toBeInstanceOf(DiagLookupSlow);
    failing = false;
    expect(await lookupPlayerId("n1", "d1")).toBe("p1"); // asked again straight away
    expect(calls).toEqual(["players", "players"]);
  });

  it("says 'could not check' (not 'none') when the database is down, and never leaks the reason", async () => {
    adminMock.getSupabaseAdmin.mockImplementation(() => {
      throw new Error("down: secret row contents");
    });
    const failure = await lookupPlayerId("n1", "d1").catch((e) => e);
    expect(failure).toBeInstanceOf(DiagLookupSlow);
    expect(String(failure.message)).not.toContain("secret");
    await expect(lookupRoomNight("K9PR4M")).rejects.toBeInstanceOf(DiagLookupSlow);
    await expect(lookupNightOwner("n1")).rejects.toBeInstanceOf(DiagLookupSlow);
    await expect(lookupQuestionContext("q1")).rejects.toBeInstanceOf(DiagLookupSlow);
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

describe("how many log writes may touch the database at once", () => {
  function manualScheduler() {
    const queued: Array<() => Promise<void>> = [];
    __setDiagSchedulerForTests((task) => {
      queued.push(task);
    });
    return queued;
  }
  const lines = () => warn.mock.calls.map((c) => String(c[0]));
  const counters = () => __diagWriteCountersForTests();

  it("is a small number: 5 at a time", () => {
    expect(DIAG_MAX_WRITES_IN_FLIGHT).toBe(5);
  });

  it("runs 5 at a time, lets the rest wait their turn in a short queue, and drops what does not fit", async () => {
    const queued = manualScheduler();
    const release: Array<() => void> = [];
    const started = vi.fn();
    const total = DIAG_MAX_WRITES_IN_FLIGHT + DIAG_WRITE_QUEUE_MAX + 7;
    for (let i = 0; i < total; i++) {
      scheduleDiagWrite(
        () =>
          new Promise<void>((resolve) => {
            started();
            release.push(resolve);
          }),
      );
    }
    // 5 running + 200 waiting are accepted; the 7 beyond that are dropped and counted
    expect(queued).toHaveLength(DIAG_MAX_WRITES_IN_FLIGHT + DIAG_WRITE_QUEUE_MAX);
    expect(counters()).toMatchObject({ dropped: 7, failed: 0, capped: 0, ignored: 0 });
    expect(lines()).toEqual(["[diag] dropping log writes: too many waiting"]);

    const running = queued.map((job) => job());
    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(DIAG_MAX_WRITES_IN_FLIGHT));
    // never more than 5 at the database, however many are waiting
    expect(counters()).toMatchObject({ inFlight: DIAG_MAX_WRITES_IN_FLIGHT, queued: DIAG_WRITE_QUEUE_MAX });
    // each finished job hands its turn to the next one in line
    release[0]!();
    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(DIAG_MAX_WRITES_IN_FLIGHT + 1));
    expect(counters().inFlight).toBe(DIAG_MAX_WRITES_IN_FLIGHT);
    // drain everything
    for (let guard = 0; guard < total * 2 && started.mock.calls.length < DIAG_MAX_WRITES_IN_FLIGHT + DIAG_WRITE_QUEUE_MAX; guard++) {
      release.forEach((r) => r());
      await Promise.resolve();
    }
    release.forEach((r) => r());
    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(DIAG_MAX_WRITES_IN_FLIGHT + DIAG_WRITE_QUEUE_MAX));
    release.forEach((r) => r());
    await Promise.all(running);
    expect(counters()).toMatchObject({ inFlight: 0, queued: 0 });
  });

  it("never has more than 5 jobs at the database at the same moment, over a whole burst", async () => {
    vi.useFakeTimers();
    const queued = manualScheduler();
    let now = 0;
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      scheduleDiagWrite(async () => {
        now += 1;
        peak = Math.max(peak, counters().inFlight);
        await new Promise((resolve) => setTimeout(resolve, 40)); // a 40 ms database call
        now -= 1;
      });
    }
    const running = queued.map((job) => job());
    await vi.advanceTimersByTimeAsync(40 * 30);
    await Promise.all(running);
    expect(peak).toBe(DIAG_MAX_WRITES_IN_FLIGHT);
    expect(now).toBe(0);
    expect(counters().dropped).toBe(0); // all 120 got their turn within the wait limit
  });

  it("drops a job that waited too long for its turn (the database is busy; the evidence is stale) and counts it", async () => {
    vi.useFakeTimers();
    const queued = manualScheduler();
    // two rounds of slow jobs (4.9 s each, just under the job deadline) keep the turns busy for ~9.8 s
    const slow = () => new Promise<void>((resolve) => setTimeout(resolve, DIAG_JOB_DEADLINE_MS - 100));
    for (let i = 0; i < DIAG_MAX_WRITES_IN_FLIGHT * 2; i++) scheduleDiagWrite(slow);
    const late = vi.fn(async () => {});
    scheduleDiagWrite(late);
    const running = queued.map((job) => job());
    await vi.advanceTimersByTimeAsync(DIAG_QUEUE_WAIT_MS + 100);
    expect(late).not.toHaveBeenCalled();
    expect(counters()).toMatchObject({ dropped: 1 });
    expect(lines()).toContain("[diag] dropping log writes: waited too long for a turn");
    await vi.advanceTimersByTimeAsync(DIAG_JOB_DEADLINE_MS * 2);
    await Promise.all(running);
    expect(late).not.toHaveBeenCalled(); // it never runs late
    expect(counters()).toMatchObject({ inFlight: 0, queued: 0 });
  });

  it("a job that is waiting and then gets its turn runs normally", async () => {
    const queued = manualScheduler();
    const order: string[] = [];
    const holders: Array<() => void> = [];
    for (let i = 0; i < DIAG_MAX_WRITES_IN_FLIGHT; i++) {
      scheduleDiagWrite(() => new Promise<void>((resolve) => holders.push(resolve)));
    }
    scheduleDiagWrite(async () => {
      order.push("waiting job ran");
    });
    const running = queued.map((job) => job());
    await Promise.resolve();
    expect(order).toEqual([]);
    holders[0]!();
    await vi.waitFor(() => expect(order).toEqual(["waiting job ran"]));
    holders.forEach((h) => h());
    await Promise.all(running);
  });

  it("frees the turn when a task fails, and when the scheduler itself breaks", async () => {
    const queued = manualScheduler();
    scheduleDiagWrite(async () => {
      throw new Error("boom");
    });
    await queued[0]!();
    expect(counters().inFlight).toBe(0);

    __setDiagSchedulerForTests(() => {
      throw new Error("scheduler exploded");
    });
    scheduleDiagWrite(async () => {});
    expect(counters().inFlight).toBe(0);
    // ...and nothing is left counted as outstanding, so later jobs are still accepted
    const later = manualScheduler();
    for (let i = 0; i < DIAG_MAX_WRITES_IN_FLIGHT + DIAG_WRITE_QUEUE_MAX; i++) scheduleDiagWrite(async () => {});
    expect(later).toHaveLength(DIAG_MAX_WRITES_IN_FLIGHT + DIAG_WRITE_QUEUE_MAX);
  });

  it("gives up on a task that never finishes, so one hung write cannot hold a turn for ever", async () => {
    vi.useFakeTimers();
    const queued = manualScheduler();
    scheduleDiagWrite(() => new Promise<void>(() => {}));
    const running = queued[0]!();
    await vi.advanceTimersByTimeAsync(10);
    expect(counters().inFlight).toBe(1);
    // (the last-resort limit for work that hangs outside any database call: the
    // job deadline plus one call's time plus a second)
    await vi.advanceTimersByTimeAsync(DIAG_JOB_DEADLINE_MS + DIAG_WRITE_TIMEOUT_MS + 1_100);
    await running;
    expect(counters().inFlight).toBe(0);
  });

  it("counts a task that could not check someone in time as 'slow' in the minute summary, not as a stranger", async () => {
    const queued = manualScheduler();
    scheduleDiagWrite(async () => {
      throw new DiagLookupSlow();
    });
    scheduleDiagWrite(async () => {
      throw new Error("something else");
    });
    await queued[0]!();
    await queued[1]!();
    expect(info.mock.calls.map((c) => String(c[0]))).toEqual([
      "[diag] stored nothing for requests with no verified player or host (slow = could not be checked in time): slow=1",
    ]);
  });

  it("records how many writes were dropped or failed as one system row, once the database takes writes again", async () => {
    let now = 5_000_000;
    __resetDiagWriteForTests({ now: () => now });
    const queued = manualScheduler();
    const hold: Array<() => void> = [];
    for (let i = 0; i < DIAG_MAX_WRITES_IN_FLIGHT + DIAG_WRITE_QUEUE_MAX + 3; i++) {
      scheduleDiagWrite(() => new Promise<void>((resolve) => hold.push(resolve)));
    }
    const running = queued.map((job) => job());
    const inserts: Array<{ table: string; rows: Record<string, unknown>[] }> = [];
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: (table: string) => ({
        insert: async (rows: Record<string, unknown>[]) => {
          inserts.push({ table, rows });
          return { error: null };
        },
      }),
    });
    for (let guard = 0; guard < 2_000 && (hold.length < DIAG_MAX_WRITES_IN_FLIGHT + DIAG_WRITE_QUEUE_MAX || hold.some(Boolean)); guard++) {
      hold.splice(0).forEach((r) => r());
      await Promise.resolve();
      if (counters().inFlight === 0 && counters().queued === 0) break;
    }
    await Promise.all(running);
    await vi.waitFor(() => expect(inserts).toHaveLength(1));
    expect(inserts[0]!.table).toBe("diag_server_actions");
    expect(inserts[0]!.rows[0]).toMatchObject({
      actor: "system",
      action: "diag_drops",
      http_status: 0,
      outcome: "gap",
      reason: "dropped=3 failed=0 capped=0",
      steps: { dropped: 3, failed: 0, capped: 0 },
    });
    await vi.waitFor(() => expect(counters()).toMatchObject({ dropped: 0, failed: 0 }));
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
    expect(inserts[0]![0]).toMatchObject({ reason: "dropped=0 failed=1 capped=0" });
  });
});

describe("lookups give up quickly too", () => {
  beforeEach(() => __clearDiagCacheForTests());

  it("says 'could not check' (it throws) when the database does not answer in time", async () => {
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
    const answer = lookupPlayerId("n1", "d1").catch((e) => e);
    await vi.advanceTimersByTimeAsync(DIAG_WRITE_TIMEOUT_MS + 10);
    expect(await answer).toBeInstanceOf(DiagLookupSlow);
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

  it("calls the cleanup function with a fixed day count and a fixed batch size, until nothing is left", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: 12, error: null })
      .mockResolvedValueOnce({ data: 3, error: null })
      .mockResolvedValueOnce({ data: 0, error: null });
    adminMock.getSupabaseAdmin.mockReturnValue({ rpc });
    await expect(runDiagCleanup()).resolves.toEqual({ ok: true, removed: 15, batches: 3, more: false });
    expect(rpc).toHaveBeenCalledTimes(3);
    for (const call of rpc.mock.calls) {
      expect(call).toEqual(["cleanup_diagnostic_logs", { p_days: 45, p_batch: 5000 }]);
    }
  });

  it("is one quick call on empty tables", async () => {
    const rpc = vi.fn(async () => ({ data: 0, error: null }));
    adminMock.getSupabaseAdmin.mockReturnValue({ rpc });
    await expect(runDiagCleanup()).resolves.toEqual({ ok: true, removed: 0, batches: 1, more: false });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("stops after a fixed number of batches per run and says there is more (the next run carries on)", async () => {
    const rpc = vi.fn(async () => ({ data: 20_000, error: null }));
    adminMock.getSupabaseAdmin.mockReturnValue({ rpc });
    const result = await runDiagCleanup();
    expect(result).toEqual({
      ok: true,
      removed: 20_000 * DIAG_CLEANUP_MAX_BATCHES,
      batches: DIAG_CLEANUP_MAX_BATCHES,
      more: true,
    });
    expect(rpc).toHaveBeenCalledTimes(DIAG_CLEANUP_MAX_BATCHES);
  });

  it("stops when its time is up, keeping what it already removed", async () => {
    vi.useFakeTimers();
    const rpc = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      return { data: 5_000, error: null };
    });
    adminMock.getSupabaseAdmin.mockReturnValue({ rpc });
    const result = runDiagCleanup();
    await vi.advanceTimersByTimeAsync(60_000);
    const done = await result;
    expect(done).toMatchObject({ ok: true, more: true });
    expect(done.ok && done.batches).toBeLessThan(DIAG_CLEANUP_MAX_BATCHES);
    expect(done.ok && done.removed).toBeGreaterThan(0);
  });

  it("reports a database error as one short line and a result, never a throw (with what was already removed)", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue({
      rpc: vi
        .fn()
        .mockResolvedValueOnce({ data: 7, error: null })
        .mockResolvedValueOnce({ data: null, error: { code: "42883", message: "function does not exist" } }),
    });
    await expect(runDiagCleanup()).resolves.toEqual({ ok: false, code: "42883", removed: 7, batches: 1 });
    expect(lines()).toEqual(["[diag] cleanup failed code=42883"]);
  });

  it("gives up on a stuck database", async () => {
    vi.useFakeTimers();
    adminMock.getSupabaseAdmin.mockReturnValue({ rpc: () => new Promise(() => {}) });
    const result = runDiagCleanup();
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(result).resolves.toEqual({ ok: false, code: "timeout", removed: 0, batches: 0 });
  });
});

// ─── row caps (kept in the database) ──────────────────────────────────
describe("recordDiagRows: the night and each source have a row cap", () => {
  const NIGHT = "44444444-4444-4444-4444-444444444444";
  const DEVICE = "66666666-6666-6666-6666-666666666666";
  const player = { kind: "player", deviceId: DEVICE } as const;
  const lines = () => warn.mock.calls.map((c) => String(c[0]));

  /** A fake database: diag_take_rows grants up to `room`, inserts are recorded. */
  function fakeDb(room: number | (() => number)) {
    const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const inserted: Array<{ table: string; rows: Record<string, unknown>[] }> = [];
    let left = typeof room === "number" ? room : room();
    adminMock.getSupabaseAdmin.mockReturnValue({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcs.push({ fn, args });
        const grant = Math.min(Number(args.p_want), left);
        left -= grant;
        return { data: grant, error: null };
      },
      from: (table: string) => ({
        insert: async (rows: Record<string, unknown>[]) => {
          inserted.push({ table, rows });
          return { error: null };
        },
      }),
    });
    return { rpcs, inserted };
  }
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

  it("asks the database for room, with the caps for this kind of source, and stores what it was given", async () => {
    const { rpcs, inserted } = fakeDb(1000);
    await recordDiagRows("diag_device_events", rows(3), NIGHT, player);
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0]).toEqual({
      fn: "diag_take_rows",
      args: {
        p_night_id: NIGHT,
        p_bucket: "phones", // one counter for every phone's reports, not one per phone
        p_want: DIAG_QUOTA_LEASE_ROWS.player,
        p_bucket_cap: DIAG_BUCKET_ROW_CAPS.player,
        p_night_cap: DIAG_NIGHT_ROW_CAP,
      },
    });
    expect(inserted).toEqual([{ table: "diag_device_events", rows: rows(3) }]);
  });

  it("uses the TV and host caps and their own buckets, and gives the server's own rows theirs", async () => {
    const { rpcs } = fakeDb(1000);
    await recordDiagRows("diag_device_events", rows(1), NIGHT, { kind: "tv" });
    await recordDiagRows("diag_device_events", rows(1), NIGHT, { kind: "host" });
    await recordDiagRows("diag_answer_events", rows(1), NIGHT, { kind: "tap", deviceId: DEVICE });
    await recordDiagRows("diag_server_actions", rows(1), NIGHT, { kind: "press" });
    expect(rpcs.map((r) => [r.args.p_bucket, r.args.p_bucket_cap, r.args.p_night_cap])).toEqual([
      ["tv", DIAG_BUCKET_ROW_CAPS.tv, DIAG_NIGHT_ROW_CAP],
      ["host", DIAG_BUCKET_ROW_CAPS.host, DIAG_NIGHT_ROW_CAP],
      ["taps", DIAG_BUCKET_ROW_CAPS.tap, DIAG_NIGHT_SERVER_ROW_CAP],
      ["press", DIAG_BUCKET_ROW_CAPS.press, DIAG_NIGHT_SERVER_ROW_CAP],
    ]);
    // the server's own rows have room above the cap on reports
    expect(DIAG_NIGHT_SERVER_ROW_CAP).toBeGreaterThan(DIAG_NIGHT_ROW_CAP);
  });

  it("a night whose reports have used up their share still stores a late tap and a host press", async () => {
    // A fake database that applies the same two caps as diag_take_rows.
    const taken = new Map<string, number>();
    const inserted: string[] = [];
    adminMock.getSupabaseAdmin.mockReturnValue({
      rpc: async (_fn: string, a: Record<string, unknown>) => {
        const night = taken.get("_night") ?? 0;
        const bucket = taken.get(String(a.p_bucket)) ?? 0;
        const grant = Math.max(0, Math.min(Number(a.p_want), Number(a.p_night_cap) - night, Number(a.p_bucket_cap) - bucket));
        taken.set("_night", night + grant);
        taken.set(String(a.p_bucket), bucket + grant);
        return { data: grant, error: null };
      },
      from: (table: string) => ({
        insert: async (batch: unknown[]) => {
          for (let i = 0; i < batch.length; i++) inserted.push(table);
          return { error: null };
        },
      }),
    });
    // Many phones, the TV and the host screens fill the night with reports...
    for (let phone = 0; phone < 40; phone++) {
      const source = { kind: "player", deviceId: `phone-${phone}` } as const;
      for (let i = 0; i < 200; i++) await recordDiagRows("diag_device_events", rows(10), NIGHT, source);
    }
    for (let i = 0; i < 4_000; i++) {
      await recordDiagRows("diag_device_events", rows(10), NIGHT, { kind: "tv" });
      await recordDiagRows("diag_device_events", rows(10), NIGHT, { kind: "host" });
    }
    expect(taken.get("_night")).toBe(DIAG_NIGHT_ROW_CAP);
    const reportsBefore = inserted.length;
    await recordDiagRows("diag_device_events", rows(1), NIGHT, { kind: "tv" }); // ...so more reports are refused...
    expect(inserted.length).toBe(reportsBefore);
    // ...but a real player's late tap and the host's press still get through.
    await recordDiagRows("diag_answer_events", rows(1), NIGHT, { kind: "tap", deviceId: DEVICE });
    await recordDiagRows("diag_server_actions", rows(1), NIGHT, { kind: "press" });
    expect(inserted.slice(reportsBefore)).toEqual(["diag_answer_events", "diag_server_actions"]);
  });

  it("asks for a block of rows at a time, so a busy night is not one extra call per row", async () => {
    const { rpcs, inserted } = fakeDb(1000);
    const block = DIAG_QUOTA_LEASE_ROWS.player;
    for (let i = 0; i < block; i++) await recordDiagRows("diag_answer_events", rows(1), NIGHT, player);
    expect(rpcs).toHaveLength(1);
    expect(inserted).toHaveLength(block);
    await recordDiagRows("diag_answer_events", rows(1), NIGHT, player); // the block is spent: ask again
    expect(rpcs).toHaveLength(2);
  });

  it("many different phones share one block: 60 phones' first rows are ONE call, not 60 (nothing to queue on the night's counter)", async () => {
    const { rpcs, inserted } = fakeDb(10_000);
    for (let phone = 0; phone < 60; phone++) {
      await recordDiagRows("diag_answer_events", rows(1), NIGHT, { kind: "tap", deviceId: `phone-${phone}` });
      await recordDiagRows("diag_server_actions", rows(1), NIGHT, { kind: "tap", deviceId: `phone-${phone}` }); // + its timer-end call
    }
    expect(inserted).toHaveLength(120);
    expect(rpcs).toHaveLength(2); // 120 rows from blocks of 100
    expect(new Set(rpcs.map((r) => r.args.p_bucket))).toEqual(new Set(["taps"]));
  });

  it("one phone's share is counted in this server's memory: a flooding phone is cut at its own cap with no extra database call, and other phones are untouched", async () => {
    const { rpcs, inserted } = fakeDb(1_000_000);
    const flood = { kind: "tap", deviceId: "flooding-phone" } as const;
    for (let i = 0; i < DIAG_DEVICE_ROW_CAPS.tap + 500; i++) await recordDiagRows("diag_answer_events", rows(1), NIGHT, flood);
    expect(inserted).toHaveLength(DIAG_DEVICE_ROW_CAPS.tap);
    expect(__diagWriteCountersForTests().capped).toBe(500);
    // blocks of 100, not one call per row, and none at all for the refused rows
    expect(rpcs).toHaveLength(Math.ceil(DIAG_DEVICE_ROW_CAPS.tap / DIAG_QUOTA_LEASE_ROWS.tap));
    await recordDiagRows("diag_answer_events", rows(1), NIGHT, { kind: "tap", deviceId: "honest-phone" });
    expect(inserted).toHaveLength(DIAG_DEVICE_ROW_CAPS.tap + 1);
    // the same phone on a different night starts afresh
    await recordDiagRows("diag_answer_events", rows(1), "55555555-5555-5555-5555-555555555555", flood);
    expect(inserted).toHaveLength(DIAG_DEVICE_ROW_CAPS.tap + 2);
  });

  it("a batch is cut to what is left of its phone's share", async () => {
    const { inserted } = fakeDb(1_000_000);
    const phone = { kind: "player", deviceId: "chatty-phone" } as const;
    await recordDiagRows("diag_device_events", rows(DIAG_DEVICE_ROW_CAPS.player - 5), NIGHT, phone);
    await recordDiagRows("diag_device_events", rows(60), NIGHT, phone);
    expect(inserted.reduce((n, b) => n + b.rows.length, 0)).toBe(DIAG_DEVICE_ROW_CAPS.player);
    expect(__diagWriteCountersForTests().capped).toBe(55);
  });

  it("stores only as many rows as the cap allows, drops the rest and counts them", async () => {
    const { inserted } = fakeDb(2);
    await recordDiagRows("diag_device_events", rows(5), NIGHT, player);
    expect(inserted).toEqual([{ table: "diag_device_events", rows: rows(2) }]);
    expect(__diagWriteCountersForTests().capped).toBe(3);
    expect(lines()).toEqual(["[diag] row cap reached: not storing more log rows for a night or source"]);
  });

  it("once a source is full it stores nothing and does not ask the database again for a minute", async () => {
    let now = 1_000_000;
    __resetDiagWriteForTests({ now: () => now });
    const { rpcs, inserted } = fakeDb(0);
    for (let i = 0; i < 20; i++) await recordDiagRows("diag_device_events", rows(4), NIGHT, player);
    expect(inserted).toHaveLength(0);
    expect(rpcs).toHaveLength(1); // one question, then silence
    expect(__diagWriteCountersForTests().capped).toBe(80);
    now += DIAG_QUOTA_FULL_MEMORY_MS + 1;
    await recordDiagRows("diag_device_events", rows(4), NIGHT, player);
    expect(rpcs).toHaveLength(2); // asks again after the minute
  });

  it("a source being full does not stop another source of the same night from asking", async () => {
    const { rpcs } = fakeDb(0);
    await recordDiagRows("diag_device_events", rows(1), NIGHT, player);
    await recordDiagRows("diag_device_events", rows(1), NIGHT, { kind: "tv" });
    await recordDiagRows("diag_device_events", rows(1), "55555555-5555-5555-5555-555555555555", player);
    expect(rpcs).toHaveLength(3);
  });

  it("stores nothing when the database cannot say how much room there is, and counts it as a failure", async () => {
    const inserts = vi.fn(async () => ({ error: null }));
    adminMock.getSupabaseAdmin.mockReturnValue({
      rpc: async () => ({ data: null, error: { code: "42883", message: "function diag_take_rows does not exist" } }),
      from: () => ({ insert: inserts }),
    });
    await expect(recordDiagRows("diag_device_events", rows(2), NIGHT, player)).resolves.toBeUndefined();
    expect(inserts).not.toHaveBeenCalled();
    expect(__diagWriteCountersForTests().failed).toBe(1);
    expect(lines()).toEqual(["[diag] row-cap check failed code=42883"]);
    expect(lines().join("\n")).not.toContain("does not exist");
  });

  it("gives up on a stuck row-cap check and never throws", async () => {
    vi.useFakeTimers();
    const inserts = vi.fn();
    adminMock.getSupabaseAdmin.mockReturnValue({ rpc: () => new Promise(() => {}), from: () => ({ insert: inserts }) });
    const done = recordDiagRows("diag_device_events", rows(1), NIGHT, player);
    await vi.advanceTimersByTimeAsync(DIAG_WRITE_TIMEOUT_MS + 10);
    await expect(done).resolves.toBeUndefined();
    expect(inserts).not.toHaveBeenCalled();
    expect(lines()).toEqual(["[diag] row-cap check failed code=timeout"]);
  });

  describe("never waits for a database lock: a busy answer means back off briefly, ask again, then drop", () => {
    function busyDb(answers: Array<number | "error">) {
      const calls: number[] = [];
      const inserted: unknown[][] = [];
      adminMock.getSupabaseAdmin.mockReturnValue({
        rpc: async () => {
          const next = answers[Math.min(calls.length, answers.length - 1)]!;
          calls.push(Date.now());
          return next === "error" ? { data: null, error: { code: "55P03" } } : { data: next, error: null };
        },
        from: () => ({
          insert: async (batch: unknown[]) => {
            inserted.push(batch);
            return { error: null };
          },
        }),
      });
      return { calls, inserted };
    }

    it("on 'busy' it waits a few milliseconds (holding no connection), asks again, and then stores the rows", async () => {
      vi.useFakeTimers();
      const { calls, inserted } = busyDb([-1, -1, 25]);
      const done = recordDiagRows("diag_device_events", rows(3), NIGHT, player);
      await vi.advanceTimersByTimeAsync(500);
      await done;
      expect(calls).toHaveLength(3); // two busy answers, then the grant
      // the backoff is a few tens of milliseconds, not a wait on the database
      expect(calls[1]! - calls[0]!).toBeGreaterThanOrEqual(DIAG_QUOTA_BUSY_BACKOFF_MS);
      expect(calls[1]! - calls[0]!).toBeLessThan(DIAG_QUOTA_BUSY_BACKOFF_MS * 3);
      expect(inserted).toEqual([rows(3)]);
      expect(__diagWriteCountersForTests()).toMatchObject({ dropped: 0, failed: 0, capped: 0 });
    });

    it("if it is still busy after the retries it DROPS the rows and counts them, instead of waiting on", async () => {
      vi.useFakeTimers();
      const { calls, inserted } = busyDb([-1]);
      const done = recordDiagRows("diag_device_events", rows(3), NIGHT, player);
      await vi.advanceTimersByTimeAsync(2_000);
      await done;
      expect(calls).toHaveLength(DIAG_QUOTA_BUSY_RETRIES + 1);
      expect(inserted).toHaveLength(0);
      expect(__diagWriteCountersForTests()).toMatchObject({ dropped: 1, failed: 0 });
      expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
        "[diag] row-cap check busy: dropping log rows instead of waiting",
      ]);
    });

    it("a busy answer does not mark the source as full: the next rows try again", async () => {
      vi.useFakeTimers();
      const { calls, inserted } = busyDb([-1, -1, -1, 25]);
      const first = recordDiagRows("diag_device_events", rows(1), NIGHT, player);
      await vi.advanceTimersByTimeAsync(2_000);
      await first;
      expect(inserted).toHaveLength(0);
      const second = recordDiagRows("diag_device_events", rows(1), NIGHT, player);
      await vi.advanceTimersByTimeAsync(2_000);
      await second;
      expect(calls).toHaveLength(4);
      expect(inserted).toEqual([rows(1)]);
    });

    it("a lock timeout reported by the database is not a stuck connection either: it is an error answer, counted, nothing stored", async () => {
      const { inserted } = busyDb(["error"]);
      await recordDiagRows("diag_device_events", rows(1), NIGHT, player);
      expect(inserted).toHaveLength(0);
      expect(__diagWriteCountersForTests().failed).toBe(1);
    });
  });

  it("does nothing at all for an empty list", async () => {
    adminMock.getSupabaseAdmin.mockClear();
    await recordDiagRows("diag_device_events", [], NIGHT, player);
    expect(adminMock.getSupabaseAdmin).not.toHaveBeenCalled();
  });
});

describe("noteIgnored: a request with no verified player or host stores nothing and costs no database call", () => {
  const lines = () => info.mock.calls.map((c) => String(c[0]));

  it("only counts, and prints one summary line a minute", () => {
    let now = 10_000_000;
    __resetDiagWriteForTests({ now: () => now });
    adminMock.getSupabaseAdmin.mockClear();
    for (let i = 0; i < 5; i++) noteIgnored("report");
    noteIgnored("answer");
    expect(adminMock.getSupabaseAdmin).not.toHaveBeenCalled();
    // The very first one speaks at once; the rest are held for the minute.
    expect(lines()).toEqual([
      "[diag] stored nothing for requests with no verified player or host (slow = could not be checked in time): report=1",
    ]);
    now += 61_000;
    noteIgnored("action");
    expect(lines()).toHaveLength(2);
    expect(lines()[1]).toBe(
      "[diag] stored nothing for requests with no verified player or host (slow = could not be checked in time): report=4 answer=1 action=1",
    );
    expect(__diagWriteCountersForTests().ignored).toBe(0);
  });

  it("never throws, even with a broken console", () => {
    info.mockImplementation(() => {
      throw new Error("console broke");
    });
    expect(() => noteIgnored("answer")).not.toThrow();
  });
});

// ─── the whole thing under load, with a database that behaves like a database ─
describe("under load: logging never takes more than its small share of the database and does not lose the timer-end taps", () => {
  const NIGHT = "44444444-4444-4444-4444-444444444444";

  /** A fake database whose calls take time, can be cancelled, and are counted while they are in flight. */
  function timedDb(options: {
    callMs: number | ((kind: string) => number);
    onRpc?: (args: Record<string, unknown>) => { data: number } | null;
  }) {
    const stats = {
      active: 0,
      peak: 0,
      calls: 0,
      rpcs: 0,
      busy: 0,
      inserted: 0,
      insertedBy: {} as Record<string, number>,
      systemRows: [] as Array<Record<string, unknown>>,
      started: [] as number[],
    };
    function call<T>(kind: string, result: () => T, signal?: AbortSignal): Promise<T | { data: null; error: { code: string } }> {
      return new Promise((resolve) => {
        stats.calls += 1;
        stats.active += 1;
        stats.peak = Math.max(stats.peak, stats.active);
        stats.started.push(Date.now());
        let finished = false;
        const finish = (value: T | { data: null; error: { code: string } }) => {
          if (finished) return;
          finished = true;
          stats.active -= 1;
          clearTimeout(timer);
          resolve(value);
        };
        const ms = typeof options.callMs === "function" ? options.callMs(kind) : options.callMs;
        const timer = setTimeout(() => finish(result()), ms);
        // like supabase-js: a cancelled request ends at once
        signal?.addEventListener("abort", () => finish({ data: null, error: { code: "ABORT" } }));
      });
    }
    function thenable<T>(kind: string, result: () => T, firstSignal?: AbortSignal) {
      let signal: AbortSignal | undefined = firstSignal;
      const builder = {
        abortSignal(s: AbortSignal) {
          signal = s;
          return builder;
        },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => call(kind, result, signal).then(resolve, reject),
      };
      return builder;
    }
    const db = {
      rpc: (_fn: string, args: Record<string, unknown>) => {
        stats.rpcs += 1;
        return thenable("rpc", () => {
          const custom = options.onRpc?.(args);
          if (custom) {
            if (custom.data === -1) stats.busy += 1;
            return { data: custom.data, error: null };
          }
          return { data: Number(args.p_want), error: null };
        });
      },
      from: (table: string) => {
        let signal: AbortSignal | undefined;
        const chain = {
          select: () => chain,
          eq: () => chain,
          insert: (batch: unknown[]) => {
            stats.inserted += batch.length;
            stats.insertedBy[table] = (stats.insertedBy[table] ?? 0) + batch.length;
            for (const row of batch as Array<Record<string, unknown>>) if (row.action === "diag_drops") stats.systemRows.push(row);
            return thenable("insert", () => ({ data: null, error: null }));
          },
          maybeSingle: () => thenable("lookup", () => ({ data: { id: "found-row" }, error: null }), signal),
          abortSignal: (s: AbortSignal) => {
            signal = s;
            return chain;
          },
        };
        return chain;
      },
    };
    adminMock.getSupabaseAdmin.mockReturnValue(db);
    return stats;
  }

  /** Same pseudo-random numbers every run, so the simulation cannot be flaky. */
  function seededRandom(seed: number) {
    let a = seed;
    vi.spyOn(Math, "random").mockImplementation(() => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    __setDiagSchedulerForTests((job) => void job());
  });
  afterEach(() => vi.restoreAllMocks());

  it("a slow database never sees more than 5 log calls at once, because a job keeps its turn until it has really stopped", async () => {
    // Every call takes just under its 2 s limit. A job is 4 calls in a row (check the room, check the
    // player, check the game, store the row): 7.6 s of work, more than the 5 s a job is allowed.
    const stats = timedDb({ callMs: 1_900 });
    for (let i = 0; i < 40; i++) {
      scheduleDiagWrite(async () => {
        await lookupRoomNight(`ROOM${i}`);
        await lookupPlayerId(NIGHT, `device-${i}`);
        await lookupQuestionContext(`question-${i}`);
        await insertDiagRows("diag_answer_events", [{ i }]);
      });
    }
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    // what the DATABASE saw, not what the scheduler thinks it let through
    expect(stats.peak).toBeLessThanOrEqual(DIAG_MAX_WRITES_IN_FLIGHT);
    expect(stats.active).toBe(0);
    expect(__diagWriteCountersForTests()).toMatchObject({ inFlight: 0, queued: 0 });
  });

  it("a job stops at its deadline: no call starts after it and none runs past it", async () => {
    const stats = timedDb({ callMs: 1_900 });
    const startedAt = Date.now();
    let finishedAt = 0;
    scheduleDiagWrite(async () => {
      try {
        for (let i = 0; i < 10; i++) await lookupPlayerId(NIGHT, `device-${i}`);
      } finally {
        finishedAt = Date.now();
      }
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(finishedAt - startedAt).toBeLessThanOrEqual(DIAG_JOB_DEADLINE_MS + 50);
    expect(stats.started.every((t) => t - startedAt < DIAG_JOB_DEADLINE_MS)).toBe(true);
    expect(stats.calls).toBeLessThan(10);
    expect(stats.active).toBe(0);
  });

  it("60 phones' first taps and timer-end calls at once, with other servers asking about the same night, lose no row to 'busy'", async () => {
    seededRandom(20261007);
    // The row-cap function is "inside" for 3 ms per call and answers 'busy' to anyone arriving meanwhile.
    let insideUntil = 0;
    const stats = timedDb({
      callMs: (kind) => (kind === "rpc" ? 3 : 25),
      onRpc: (args) => {
        const now = Date.now();
        if (now < insideUntil) return { data: -1 };
        insideUntil = now + 3;
        return { data: Number(args.p_want) };
      },
    });
    // five other servers each ask for a block twice during the same half second
    const others = adminMock.getSupabaseAdmin();
    for (let server = 0; server < 5; server++) {
      for (let k = 0; k < 2; k++) {
        setTimeout(() => void others.rpc("diag_take_rows", { p_want: 100 }), Math.floor(Math.random() * 500));
      }
    }
    for (let phone = 0; phone < 60; phone++) {
      const deviceId = `phone-${phone}`;
      // the first tap of the night from this phone, and its timer-end call
      scheduleDiagWrite(() =>
        recordDiagRows("diag_answer_events", [{ phone }], NIGHT, { kind: "tap", deviceId }),
      );
      scheduleDiagWrite(() =>
        recordDiagRows("diag_server_actions", [{ phone }], NIGHT, { kind: "tap", deviceId }),
      );
    }
    await vi.advanceTimersByTimeAsync(30_000);
    const counters = __diagWriteCountersForTests();
    expect(counters.dropped).toBe(0); // nothing dropped as busy, nothing dropped for waiting
    expect(counters.failed).toBe(0);
    // every tap and every timer-end call was stored
    expect(stats.insertedBy["diag_answer_events"]).toBe(60);
    expect(stats.insertedBy["diag_server_actions"]).toBe(60);
    // ...with a handful of row-cap calls for the whole burst (not 60): the five jobs that
    // found the block spent at the same moment shared one call
    expect(stats.rpcs - 10).toBeLessThanOrEqual(4);
    expect(stats.peak).toBeLessThanOrEqual(DIAG_MAX_WRITES_IN_FLIGHT);
  });

  it("even if the night's counter is busy for a long time, answers are never waited on: the rows are dropped and counted", async () => {
    const stats = timedDb({ callMs: 3, onRpc: () => ({ data: -1 }) });
    for (let phone = 0; phone < 60; phone++) {
      scheduleDiagWrite(() =>
        recordDiagRows("diag_answer_events", [{ phone }], NIGHT, { kind: "tap", deviceId: `phone-${phone}` }),
      );
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(stats.insertedBy["diag_answer_events"] ?? 0).toBe(0);
    expect(stats.peak).toBeLessThanOrEqual(DIAG_MAX_WRITES_IN_FLIGHT);
    // every one of the 60 is accounted for: still counted, or already written to the "gap" row
    const reported = stats.systemRows.reduce((n, row) => n + Number((row.steps as { dropped: number }).dropped), 0);
    expect(__diagWriteCountersForTests().dropped + reported).toBe(60);
    expect(__diagWriteCountersForTests()).toMatchObject({ inFlight: 0, queued: 0 });
  });
});
