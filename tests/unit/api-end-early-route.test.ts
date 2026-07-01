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

function makeAdmin({
  players,
  scores,
  answers,
}: {
  players: Array<{ id: string }>;
  scores: Array<{ player_id: string | null }>;
  answers: Array<{ question_id: string | null; player_id: string | null }>;
}) {
  const rpc = vi.fn(async () => ({ error: null }));

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
      if (table === "players") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(async () => ({
                data: players,
                error: null,
              })),
            })),
          })),
        };
      }
      if (table === "game_scores") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({
              data: scores,
              error: null,
            })),
          })),
        };
      }
      if (table === "answers") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({
              data: answers,
              error: null,
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

  it("rejects guarded auto-reveal when a newly eligible participant has not locked", async () => {
    const admin = makeAdmin({
      players: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
      scores: [{ player_id: "p1" }, { player_id: "p2" }, { player_id: "p3" }],
      answers: [
        { question_id: QUESTION_ID, player_id: "p1" },
        { question_id: QUESTION_ID, player_id: "p2" },
      ],
    });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/games/[id]/end-early/route");
    const res = await POST(
      makeRequest({ questionId: QUESTION_ID, requireAllLocked: true }),
      makeCtx(),
    );

    expect(res.status).toBe(409);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("keeps manual end-early behavior intact when the guard flag is absent", async () => {
    const admin = makeAdmin({
      players: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
      scores: [{ player_id: "p1" }, { player_id: "p2" }, { player_id: "p3" }],
      answers: [
        { question_id: QUESTION_ID, player_id: "p1" },
        { question_id: QUESTION_ID, player_id: "p2" },
      ],
    });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/games/[id]/end-early/route");
    const res = await POST(makeRequest({ questionId: QUESTION_ID }), makeCtx());

    expect(res.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("resolve_question", {
      p_question_id: QUESTION_ID,
    });
  });
});
