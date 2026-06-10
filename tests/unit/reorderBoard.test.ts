// Unit test for lib/host/reorderBoard — the board-reorder write path.
//
// The critical guarantee: it NEVER lets two picked questions transiently hold
// the same (category_id, point_value), which would trip the deferrable unique
// index because supabase-js auto-commits each .update(). We prove the
// clear-first sequence (null all target slots, THEN set each) by recording the
// order of DB operations against a mocked admin client.

import { describe, it, expect, vi, beforeEach } from "vitest";

const adminMock = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => adminMock);

const CATEGORY_ID = "44444444-4444-4444-4444-444444444444";

interface AdminOpts {
  // The full set of picked rows the belonging query returns (select id where
  // category_id=X and is_picked=true).
  rows?: Array<{ id: string }> | null;
  selError?: { message: string } | null;
  clearError?: { message: string } | null;
  /** Return an error for the per-row set of a given point value, else null. */
  setErrorForValue?: (v: number) => { message: string } | null;
}

function makeAdmin(opts: AdminOpts = {}) {
  const sequence: string[] = [];
  const calls = { clears: 0, sets: [] as number[] };

  function builder() {
    const state: {
      op: "select" | "update" | null;
      payload: Record<string, unknown> | null;
    } = { op: null, payload: null };
    const b = {
      select() {
        state.op = "select";
        return b;
      },
      update(payload: Record<string, unknown>) {
        state.op = "update";
        state.payload = payload;
        return b;
      },
      eq() {
        return b;
      },
      in() {
        return b;
      },
      then(
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) {
        return Promise.resolve(resultFor()).then(resolve, reject);
      },
    };
    function resultFor() {
      if (state.op === "select") {
        sequence.push("select");
        return { data: opts.rows ?? [], error: opts.selError ?? null };
      }
      // update
      const pv = state.payload?.point_value;
      if (pv === null) {
        sequence.push("clear");
        calls.clears += 1;
        return { error: opts.clearError ?? null };
      }
      sequence.push(`set:${pv}`);
      calls.sets.push(pv as number);
      return { error: opts.setErrorForValue?.(pv as number) ?? null };
    }
    return b;
  }

  const client = { from: vi.fn(() => builder()) };
  return { client, sequence, calls };
}

const ASSIGN = [
  { id: "a", pointValue: 100 },
  { id: "b", pointValue: 200 },
  { id: "c", pointValue: 300 },
];
const PICKED_ROWS = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("reorderBoardQuestions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears all target slots BEFORE setting any (collision-safe order)", async () => {
    const { client, sequence } = makeAdmin({ rows: PICKED_ROWS });
    adminMock.getSupabaseAdmin.mockReturnValue(client);

    const { reorderBoardQuestions } = await import("@/lib/host/reorderBoard");
    const result = await reorderBoardQuestions(CATEGORY_ID, ASSIGN);

    expect(result.ok).toBe(true);
    // select → single clear → then every per-row set. No set precedes the clear.
    expect(sequence).toEqual(["select", "clear", "set:100", "set:200", "set:300"]);
  });

  it("returns the assignments on success", async () => {
    const { client } = makeAdmin({ rows: PICKED_ROWS });
    adminMock.getSupabaseAdmin.mockReturnValue(client);
    const { reorderBoardQuestions } = await import("@/lib/host/reorderBoard");
    const result = await reorderBoardQuestions(CATEGORY_ID, ASSIGN);
    expect(result).toEqual({ ok: true, picked: ASSIGN });
  });

  it("rejects when an assignment id is not a picked question (foreign/unpicked id)", async () => {
    // The picked set is {a, b} — but the request also names c.
    const { client, sequence } = makeAdmin({ rows: [{ id: "a" }, { id: "b" }] });
    adminMock.getSupabaseAdmin.mockReturnValue(client);
    const { reorderBoardQuestions } = await import("@/lib/host/reorderBoard");
    const result = await reorderBoardQuestions(CATEGORY_ID, ASSIGN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("isn't picked");
    // No writes — we bailed before the clear.
    expect(sequence).toEqual(["select"]);
  });

  it("rejects a partial set that omits a picked card (would orphan a slot)", async () => {
    // Four questions are picked, but the request only reorders three.
    const { client, sequence } = makeAdmin({
      rows: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
    });
    adminMock.getSupabaseAdmin.mockReturnValue(client);
    const { reorderBoardQuestions } = await import("@/lib/host/reorderBoard");
    const result = await reorderBoardQuestions(CATEGORY_ID, ASSIGN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("must cover all 4");
    // No writes — we bailed before the clear.
    expect(sequence).toEqual(["select"]);
  });

  it("surfaces a select error", async () => {
    const { client } = makeAdmin({ rows: null, selError: { message: "db down" } });
    adminMock.getSupabaseAdmin.mockReturnValue(client);
    const { reorderBoardQuestions } = await import("@/lib/host/reorderBoard");
    const result = await reorderBoardQuestions(CATEGORY_ID, ASSIGN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("db down");
  });

  it("surfaces a clear error before any set runs", async () => {
    const { client, sequence } = makeAdmin({
      rows: PICKED_ROWS,
      clearError: { message: "clear boom" },
    });
    adminMock.getSupabaseAdmin.mockReturnValue(client);
    const { reorderBoardQuestions } = await import("@/lib/host/reorderBoard");
    const result = await reorderBoardQuestions(CATEGORY_ID, ASSIGN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("clear boom");
    expect(sequence).toEqual(["select", "clear"]);
  });

  it("rolls back (re-clears) when a per-row set fails", async () => {
    const { client, sequence, calls } = makeAdmin({
      rows: PICKED_ROWS,
      setErrorForValue: (v) => (v === 200 ? { message: "set boom" } : null),
    });
    adminMock.getSupabaseAdmin.mockReturnValue(client);
    const { reorderBoardQuestions } = await import("@/lib/host/reorderBoard");
    const result = await reorderBoardQuestions(CATEGORY_ID, ASSIGN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("slot 200");
    // Initial clear + the rollback clear = 2 clears; the failing set aborts
    // the loop before set:300 runs.
    expect(calls.clears).toBe(2);
    expect(sequence).toEqual(["select", "clear", "set:100", "set:200", "clear"]);
  });
});
