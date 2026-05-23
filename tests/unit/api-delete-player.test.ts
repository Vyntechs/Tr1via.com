// Route handler test — DELETE /api/players/[id].
//
// The host soft-removes a player by setting `players.removed_at`. Auth is
// host-only via requireOwnedNight; the player's parent night must belong
// to the calling host. The route is mocked at module boundaries so we
// don't need a live Supabase to exercise the branches.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
}));
const authMock = vi.hoisted(() => ({
  requireOwnedNight: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);

const NIGHT_ID = "11111111-1111-1111-1111-111111111111";
const PLAYER_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_NIGHT_ID = "33333333-3333-3333-3333-333333333333";

function makeRequest() {
  return new NextRequest(`http://test/api/players/${PLAYER_ID}`, {
    method: "DELETE",
  });
}

function makeCtx(playerId = PLAYER_ID) {
  return { params: Promise.resolve({ id: playerId }) };
}

interface PlayerRowShape {
  id: string;
  night_id: string;
  removed_at: string | null;
}

function makePlayerLookup(player: PlayerRowShape | null) {
  return {
    from: vi.fn((table: string) => {
      if (table !== "players") throw new Error(`unexpected table ${table}`);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: player, error: null })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: { id: player?.id, removed_at: new Date().toISOString() },
                error: null,
              })),
            })),
          })),
        })),
      };
    }),
  };
}

describe("DELETE /api/players/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 when no host is signed in", async () => {
    authMock.requireOwnedNight.mockResolvedValue({
      ok: false,
      status: 401,
      error: "not signed in",
    });
    adminMock.getSupabaseAdmin.mockReturnValue(
      makePlayerLookup({ id: PLAYER_ID, night_id: NIGHT_ID, removed_at: null }),
    );

    const { DELETE } = await import("@/app/api/players/[id]/route");
    const res = await DELETE(makeRequest(), makeCtx());
    expect(res.status).toBe(401);
  });

  it("404 when the player does not exist", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makePlayerLookup(null));

    const { DELETE } = await import("@/app/api/players/[id]/route");
    const res = await DELETE(makeRequest(), makeCtx());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/player not found/i);
  });

  it("403 when the player belongs to a night the host does not own", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(
      makePlayerLookup({
        id: PLAYER_ID,
        night_id: OTHER_NIGHT_ID,
        removed_at: null,
      }),
    );
    authMock.requireOwnedNight.mockResolvedValue({
      ok: false,
      status: 403,
      error: "not your night",
    });

    const { DELETE } = await import("@/app/api/players/[id]/route");
    const res = await DELETE(makeRequest(), makeCtx());
    expect(res.status).toBe(403);
  });

  it("soft-deletes the player by stamping removed_at and returns 200", async () => {
    const lookup = makePlayerLookup({
      id: PLAYER_ID,
      night_id: NIGHT_ID,
      removed_at: null,
    });
    adminMock.getSupabaseAdmin.mockReturnValue(lookup);
    authMock.requireOwnedNight.mockResolvedValue({
      ok: true,
      host: { id: "host-1" },
      night: { id: NIGHT_ID },
    });

    const { DELETE } = await import("@/app/api/players/[id]/route");
    const res = await DELETE(makeRequest(), makeCtx());
    expect(res.status).toBe(200);
    expect(authMock.requireOwnedNight).toHaveBeenCalledWith(NIGHT_ID);
    // The route must have requested an update, not a hard delete.
    expect(lookup.from).toHaveBeenCalledWith("players");
    const body = await res.json();
    expect(body.playerId).toBe(PLAYER_ID);
    expect(body.removedAt).toBeTruthy();
  });

  it("is idempotent: already-removed player still returns 200", async () => {
    const already = new Date(Date.now() - 60_000).toISOString();
    adminMock.getSupabaseAdmin.mockReturnValue(
      makePlayerLookup({
        id: PLAYER_ID,
        night_id: NIGHT_ID,
        removed_at: already,
      }),
    );
    authMock.requireOwnedNight.mockResolvedValue({
      ok: true,
      host: { id: "host-1" },
      night: { id: NIGHT_ID },
    });

    const { DELETE } = await import("@/app/api/players/[id]/route");
    const res = await DELETE(makeRequest(), makeCtx());
    expect(res.status).toBe(200);
  });
});
