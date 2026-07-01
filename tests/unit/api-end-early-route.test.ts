import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
}));
const authMock = vi.hoisted(() => ({
  requireOwnedGame: vi.fn(),
}));
const broadcastMock = vi.hoisted(() => ({
  broadcastToRoom: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/api/broadcast", () => broadcastMock);

const GAME_ID = "11111111-1111-1111-1111-111111111111";
const QUESTION_ID = "22222222-2222-2222-2222-222222222222";
const CATEGORY_ID = "33333333-3333-3333-3333-333333333333";
const NIGHT_ID = "44444444-4444-4444-4444-444444444444";

function makeRequest(body: unknown) {
  return new NextRequest(`http://test/api/games/${GAME_ID}/end-early`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeCtx(gameId = GAME_ID) {
  return { params: Promise.resolve({ id: gameId }) };
}

// The guarded eligibility decision now lives in the DB (resolve_question_if_all_locked),
// not the app — so the admin stub only needs the sanity-check reads (questions,
// categories) plus a table-aware rpc() that returns per-function results.
function makeAdmin({
  allLockedResult,
}: {
  allLockedResult?: boolean | { error: { message: string } };
} = {}) {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "resolve_question_if_all_locked") {
      if (allLockedResult && typeof allLockedResult === "object") {
        return { data: null, error: allLockedResult.error };
      }
      return { data: allLockedResult ?? true, error: null };
    }
    return { data: null, error: null };
  });

  return {
    rpc,
    from: vi.fn((table: string) => {
      if (table === "questions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: {
                  id: QUESTION_ID,
                  category_id: CATEGORY_ID,
                  played_at: new Date().toISOString(),
                  finished_at: null,
                  correct_index: 1,
                },
                error: null,
              })),
            })),
          })),
        };
      }
      if (table === "categories") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { game_id: GAME_ID },
                error: null,
              })),
            })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

describe("POST /api/games/[id]/end-early", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.requireOwnedGame.mockResolvedValue({
      ok: true,
      night: { id: NIGHT_ID, room_code: "ABCDEF" },
    });
    broadcastMock.broadcastToRoom.mockResolvedValue(undefined);
  });

  it("returns 409 without resolving when resolve_question_if_all_locked reports not everyone locked", async () => {
    const admin = makeAdmin({ allLockedResult: false });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/games/[id]/end-early/route");
    const res = await POST(
      makeRequest({ questionId: QUESTION_ID, requireAllLocked: true }),
      makeCtx(),
    );

    expect(res.status).toBe(409);
    expect(admin.rpc).toHaveBeenCalledWith("resolve_question_if_all_locked", {
      p_question_id: QUESTION_ID,
    });
    expect(admin.rpc).not.toHaveBeenCalledWith(
      "resolve_question",
      expect.anything(),
    );
  });

  it("resolves guarded auto-reveal when resolve_question_if_all_locked reports everyone locked", async () => {
    const admin = makeAdmin({ allLockedResult: true });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/games/[id]/end-early/route");
    const res = await POST(
      makeRequest({ questionId: QUESTION_ID, requireAllLocked: true }),
      makeCtx(),
    );

    expect(res.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("resolve_question_if_all_locked", {
      p_question_id: QUESTION_ID,
    });
    expect(admin.rpc).not.toHaveBeenCalledWith(
      "resolve_question",
      expect.anything(),
    );
  });

  it("keeps manual end-early behavior intact when the guard flag is absent", async () => {
    const admin = makeAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/games/[id]/end-early/route");
    const res = await POST(makeRequest({ questionId: QUESTION_ID }), makeCtx());

    expect(res.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("resolve_question", {
      p_question_id: QUESTION_ID,
    });
    expect(admin.rpc).not.toHaveBeenCalledWith(
      "resolve_question_if_all_locked",
      expect.anything(),
    );
  });
});
