import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({ requireOwnedNight: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);

const NIGHT_ID = "11111111-1111-1111-1111-111111111111";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://test/api/nights/${NIGHT_ID}/room-magic`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeCtx() {
  return { params: Promise.resolve({ id: NIGHT_ID }) };
}

function makeSupa(liveGame: { id: string } | null, roomMagicEnabled = true) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: liveGame, error: null });
  const single = vi.fn().mockResolvedValue({
    data: { room_magic_enabled: roomMagicEnabled },
    error: null,
  });
  const update = vi.fn().mockReturnThis();
  const supaClient = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    update,
    eq: vi.fn().mockReturnThis(),
    maybeSingle,
    single,
  };

  return { supaClient, update };
}

beforeEach(() => {
  vi.resetAllMocks();
  authMock.requireOwnedNight.mockResolvedValue({
    ok: true,
    host: { id: "host-1" },
    night: { id: NIGHT_ID, host_id: "host-1" },
  });
});

describe("Room Magic night toggle API", () => {
  it("returns 401 when the host is unauthenticated", async () => {
    authMock.requireOwnedNight.mockResolvedValue({
      ok: false,
      status: 401,
      error: "not signed in",
    });

    const { PATCH } = await import("@/app/api/nights/[id]/room-magic/route");
    const res = await PATCH(makeRequest({ enabled: true }), makeCtx());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "not signed in" });
  });

  it("returns 403 when the host does not own the night", async () => {
    authMock.requireOwnedNight.mockResolvedValue({
      ok: false,
      status: 403,
      error: "not your night",
    });

    const { PATCH } = await import("@/app/api/nights/[id]/room-magic/route");
    const res = await PATCH(makeRequest({ enabled: true }), makeCtx());

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not your night" });
  });

  it("returns 400 for an invalid body", async () => {
    const { PATCH } = await import("@/app/api/nights/[id]/room-magic/route");
    const res = await PATCH(makeRequest({ enabled: "yes" }), makeCtx());

    expect(res.status).toBe(400);
  });

  it("returns 409 when a game is live", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeSupa({ id: "game-1" }).supaClient);

    const { PATCH } = await import("@/app/api/nights/[id]/room-magic/route");
    const res = await PATCH(makeRequest({ enabled: true }), makeCtx());

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/live/i);
  });

  it("updates nights.room_magic_enabled for the owning host", async () => {
    const { supaClient, update } = makeSupa(null, true);
    adminMock.getSupabaseAdmin.mockReturnValue(supaClient);

    const { PATCH } = await import("@/app/api/nights/[id]/room-magic/route");
    const res = await PATCH(makeRequest({ enabled: true }), makeCtx());

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ room_magic_enabled: true });
    expect(await res.json()).toEqual({ roomMagicEnabled: true });
  });
});
