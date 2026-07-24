import { beforeEach, describe, expect, it, vi } from "vitest";

const adminMock = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => adminMock);

const CATEGORY_ID = "44444444-4444-4444-4444-444444444444";
const ASSIGNMENTS = [
  { id: "a", pointValue: 100 },
  { id: "b", pointValue: 200 },
  { id: "c", pointValue: 300 },
];

function makeAdmin(error: { message?: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error });
  return {
    client: { rpc, from: vi.fn() },
    rpc,
  };
}

describe("reorderBoardQuestions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists the complete reorder through one atomic database call", async () => {
    const { client, rpc } = makeAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(client);

    const { reorderBoardQuestions } = await import("@/lib/host/reorderBoard");
    const result = await reorderBoardQuestions(CATEGORY_ID, ASSIGNMENTS);

    expect(result).toEqual({ ok: true, picked: ASSIGNMENTS });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("reorder_category_board", {
      p_category_id: CATEGORY_ID,
      p_assignments: ASSIGNMENTS,
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns the database validation failure without attempting a fallback write", async () => {
    const { client, rpc } = makeAdmin({
      message: "reorder must cover every picked question in this category",
    });
    adminMock.getSupabaseAdmin.mockReturnValue(client);

    const { reorderBoardQuestions } = await import("@/lib/host/reorderBoard");
    const result = await reorderBoardQuestions(CATEGORY_ID, ASSIGNMENTS);

    expect(result).toEqual({
      ok: false,
      error: "reorder must cover every picked question in this category",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(client.from).not.toHaveBeenCalled();
  });
});
