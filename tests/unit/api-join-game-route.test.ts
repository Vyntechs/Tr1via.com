import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({ requireOwnedPlayerReference: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);

const NIGHT_ID = "11111111-1111-1111-1111-111111111111";
const PLAYER_ID = "22222222-2222-2222-2222-222222222222";
const GAME2_ID = "33333333-3333-3333-3333-333333333333";

function ctx() {
  return { params: Promise.resolve({ id: PLAYER_ID }) };
}

function joinRequest(gameNo = 2) {
  return new NextRequest(`http://test/api/players/${PLAYER_ID}/join-game`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameNo }),
  });
}

// game_no:2 shells are auto-seeded empty; a player must not be able to opt into
// one with no ready content (they'd be stranded on a game that never starts).
function joinGameAdmin({ readyContent }: { readyContent: boolean }) {
  const insertParticipation = vi.fn(async () => ({ error: null }));
  const readyRows = readyContent ? [{ id: "c-ready" }] : [];

  const admin = {
    from: vi.fn((table: string) => {
      if (table === "games") {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => ({
            data: { id: GAME2_ID, state: "draft" },
            error: null,
          })),
        };
        return builder;
      }
      if (table === "categories") {
        const builder: Record<string, unknown> = {};
        for (const method of ["select", "eq", "limit"]) {
          builder[method] = vi.fn(() => builder);
        }
        builder.then = (
          resolve: (value: { data: Array<{ id: string }>; error: null }) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve({ data: readyRows, error: null }).then(resolve, reject);
        return builder;
      }
      if (table === "game_participations") {
        return { insert: insertParticipation };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
  return { admin, insertParticipation };
}

describe("join-game empty-shell guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.requireOwnedPlayerReference.mockResolvedValue({
      ok: true,
      player: { id: PLAYER_ID, night_id: NIGHT_ID },
    });
  });

  it("refuses to join a Game 2 shell that has no ready content", async () => {
    const { admin, insertParticipation } = joinGameAdmin({ readyContent: false });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/players/[id]/join-game/route");
    const response = await POST(joinRequest(2), ctx());

    expect(response.status).toBe(403);
    expect(insertParticipation).not.toHaveBeenCalled();
  });

  it("joins normally when the game has ready content", async () => {
    const { admin, insertParticipation } = joinGameAdmin({ readyContent: true });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/players/[id]/join-game/route");
    const response = await POST(joinRequest(2), ctx());

    expect(response.status).toBe(200);
    expect(insertParticipation).toHaveBeenCalledTimes(1);
  });
});
