import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({ requireOwnedGame: vi.fn() }));
const broadcastMock = vi.hoisted(() => ({ broadcastToRoom: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/api/broadcast", () => broadcastMock);

const GAME_ID = "11111111-1111-1111-1111-111111111111";
const QUESTION_ID = "22222222-2222-2222-2222-222222222222";
const CATEGORY_ID = "33333333-3333-3333-3333-333333333333";

function request() {
  return new NextRequest(`http://test/api/games/${GAME_ID}/advance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ questionId: QUESTION_ID }),
  });
}

function adminFor(
  question: { finished_at: string | null } | null,
  advanceApplied = true,
) {
  const rpc = vi.fn(async () => ({ data: advanceApplied, error: null }));
  return {
    rpc,
    from: vi.fn((table: string) => {
      if (table === "questions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: question ? { id: QUESTION_ID, category_id: CATEGORY_ID, ...question } : null,
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
              maybeSingle: vi.fn(async () => ({ data: { game_id: GAME_ID }, error: null })),
            })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

describe("POST /api/games/[id]/advance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.requireOwnedGame.mockResolvedValue({
      ok: true,
      night: { id: "night-1", room_code: "ABCDEF" },
    });
    broadcastMock.broadcastToRoom.mockResolvedValue(undefined);
  });

  it("durably records the shared standings transition and wakes the TV", async () => {
    const admin = adminFor({ finished_at: "2026-07-23T01:00:00.000Z" });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const { POST } = await import("@/app/api/games/[id]/advance/route");

    const response = await POST(request(), { params: Promise.resolve({ id: GAME_ID }) });

    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("record_standings_advance", {
      p_game_id: GAME_ID,
      p_occurred_at: expect.any(String),
      p_question_id: QUESTION_ID,
      p_resolved_at: "2026-07-23T01:00:00.000Z",
    });
    expect(broadcastMock.broadcastToRoom).toHaveBeenCalledWith(
      "ABCDEF",
      "advance",
      expect.objectContaining({ questionId: QUESTION_ID }),
    );
  });

  it("does not rebroadcast an already-applied advance tap", async () => {
    const admin = adminFor({ finished_at: "2026-07-23T01:00:00.000Z" }, false);
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const { POST } = await import("@/app/api/games/[id]/advance/route");

    const response = await POST(request(), { params: Promise.resolve({ id: GAME_ID }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: "standings-board", repeated: true });
    expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
  });

  it("refuses to advance before the answer is resolved", async () => {
    const admin = adminFor({ finished_at: null });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const { POST } = await import("@/app/api/games/[id]/advance/route");

    const response = await POST(request(), { params: Promise.resolve({ id: GAME_ID }) });

    expect(response.status).toBe(409);
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
  });
});
