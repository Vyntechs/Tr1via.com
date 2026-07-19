import { beforeEach, describe, expect, it, vi } from "vitest";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => adminMock);

const NIGHT_ID = "11111111-1111-4111-8111-111111111111";
const PLAYER_ID = "22222222-2222-4222-8222-222222222222";

function query(rows: Record<string, unknown>[]) {
  let data = [...rows];
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      if (!column.includes(".")) data = data.filter((row) => row[column] === value);
      return builder;
    },
    not: () => builder,
    is: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: data[0] ?? null, error: null }),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  };
  return builder;
}

function admin() {
  return {
    from: vi.fn((table: string) => {
      if (table === "games") return query([{ id: "game-1", night_id: NIGHT_ID }]);
      if (table === "questions") return query([{ id: "question-1" }]);
      if (table === "answers") {
        return query([{
          question_id: "question-1",
          player_id: PLAYER_ID,
          ms_to_lock: 1200,
          locked_at: "2026-07-19T00:00:01.200Z",
        }]);
      }
      return query([]);
    }),
  };
}

async function call(audience: "player" | "tv") {
  const { GET } = await import("@/app/api/games/[id]/locks/route");
  return GET(new Request(`http://test/api/games/game-1/locks?audience=${audience}`), {
    params: Promise.resolve({ id: "game-1" }),
  });
}

describe("GET /api/games/:id/locks presentation boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "snapshot-test-secret";
    adminMock.getSupabaseAdmin.mockReturnValue(admin());
  });

  it("replaces raw player ids and separates player/TV correlation keys", async () => {
    const playerBody = await (await call("player")).json();
    const tvBody = await (await call("tv")).json();

    expect(JSON.stringify(playerBody)).not.toContain(PLAYER_ID);
    expect(JSON.stringify(tvBody)).not.toContain(PLAYER_ID);
    expect(playerBody.locks[0].playerId).toEqual(expect.any(String));
    expect(playerBody.locks[0].playerId).not.toBe(tvBody.locks[0].playerId);
  });
});
