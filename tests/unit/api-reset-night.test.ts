// Route handler test — POST /api/nights/[id]/reset-to-setup.
//
// Mocks the admin client + auth helper at module boundaries. We pin the
// branches: unauth, forbidden, not-found, RPC success, RPC error.

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

function makeRequest() {
  return new NextRequest(`http://test/api/nights/${NIGHT_ID}/reset-to-setup`, {
    method: "POST",
  });
}

function makeCtx() {
  return { params: Promise.resolve({ id: NIGHT_ID }) };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/nights/[id]/reset-to-setup", () => {
  it("returns 401 when unauthenticated", async () => {
    authMock.requireOwnedNight.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: "not signed in",
    });
    const { POST } = await import("@/app/api/nights/[id]/reset-to-setup/route");
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(401);
  });

  it("returns 403 when night is not owned by caller", async () => {
    authMock.requireOwnedNight.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: "not your night",
    });
    const { POST } = await import("@/app/api/nights/[id]/reset-to-setup/route");
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(403);
  });

  it("returns 404 when night does not exist", async () => {
    authMock.requireOwnedNight.mockResolvedValueOnce({
      ok: false,
      status: 404,
      error: "not found",
    });
    const { POST } = await import("@/app/api/nights/[id]/reset-to-setup/route");
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(404);
  });

  it("calls the RPC and returns its jsonb payload on success", async () => {
    authMock.requireOwnedNight.mockResolvedValueOnce({
      ok: true,
      night: { id: NIGHT_ID, opened_at: "2026-05-26T00:31:00Z" },
      host: { id: "h1", is_first_night_complete: true },
    });
    const rpcMock = vi.fn().mockResolvedValueOnce({
      data: {
        wiped: { reveals: 18, answers: 25, finishedQuestions: 9, adjustments: 0 },
        kept: { categories: 6, pickedQuestions: 21, players: 4 },
      },
      error: null,
    });
    adminMock.getSupabaseAdmin.mockReturnValueOnce({ rpc: rpcMock });

    const { POST } = await import("@/app/api/nights/[id]/reset-to-setup/route");
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(200);

    expect(rpcMock).toHaveBeenCalledWith("reset_night_to_setup", {
      p_night_id: NIGHT_ID,
    });

    const body = await res.json();
    expect(body).toEqual({
      wiped: { reveals: 18, answers: 25, finishedQuestions: 9, adjustments: 0 },
      kept: { categories: 6, pickedQuestions: 21, players: 4 },
    });
  });

  it("returns 500 when the RPC errors", async () => {
    authMock.requireOwnedNight.mockResolvedValueOnce({
      ok: true,
      night: { id: NIGHT_ID, opened_at: "2026-05-26T00:31:00Z" },
      host: { id: "h1", is_first_night_complete: true },
    });
    const rpcMock = vi.fn().mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    });
    adminMock.getSupabaseAdmin.mockReturnValueOnce({ rpc: rpcMock });

    const { POST } = await import("@/app/api/nights/[id]/reset-to-setup/route");
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(500);
  });
});
