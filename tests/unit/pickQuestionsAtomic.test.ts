import { beforeEach, describe, expect, it, vi } from "vitest";

const adminMock = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => adminMock);

const CATEGORY_ID = "44444444-4444-4444-4444-444444444444";
const ROWS = Array.from({ length: 7 }, (_, index) => ({
  id: `00000000-0000-0000-0000-00000000000${index}`,
  difficulty: index + 1,
  point_value: null,
}));

function makeAdmin() {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const writes: Array<Record<string, unknown>> = [];

  function builder() {
    let operation: "select" | "update" | null = null;
    const b = {
      select() {
        operation = "select";
        return b;
      },
      update(payload: Record<string, unknown>) {
        operation = "update";
        writes.push(payload);
        return b;
      },
      eq() {
        return b;
      },
      in() {
        return b;
      },
      then(
        resolve: (value: unknown) => unknown,
        reject?: (error: unknown) => unknown,
      ) {
        return Promise.resolve(
          operation === "select"
            ? { data: ROWS, error: null }
            : { data: null, error: null },
        ).then(resolve, reject);
      },
    };
    return b;
  }

  return {
    client: { from: vi.fn(() => builder()), rpc },
    rpc,
    writes,
  };
}

describe("pickQuestionsForCategory atomic persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("commits all seven picks and category readiness in one database call", async () => {
    const { client, rpc, writes } = makeAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(client);
    const { pickQuestionsForCategory } = await import(
      "@/lib/host/pickQuestions"
    );

    const result = await pickQuestionsForCategory(
      CATEGORY_ID,
      ROWS.map((row) => row.id),
    );

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("apply_category_picks", {
      p_category_id: CATEGORY_ID,
      p_assignments: ROWS.map((row, index) => ({
        id: row.id,
        pointValue: (index + 1) * 100,
      })),
    });
    expect(writes).toEqual([]);
  });
});
