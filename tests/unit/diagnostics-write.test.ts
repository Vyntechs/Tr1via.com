// The "after the response, and never in the way" plumbing for diagnostic rows.

import { beforeEach, describe, expect, it, vi } from "vitest";

const afterMock = vi.hoisted(() => vi.fn());
const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: afterMock,
}));
vi.mock("@/lib/supabase/admin", () => adminMock);

import {
  __clearDiagCacheForTests,
  __setDiagSchedulerForTests,
  insertDiagRows,
  lookupPlayerId,
  lookupQuestionContext,
  scheduleDiagWrite,
} from "@/lib/diagnostics/write";

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
