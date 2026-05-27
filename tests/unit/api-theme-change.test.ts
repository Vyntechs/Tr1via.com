// Route handler test — PATCH /api/nights/[id]/theme.
//
// Mocks the admin client + auth helper at module boundaries.
// Verifies that the route returns 409 when a game is live,
// and 200 when no game is live.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({ requireOwnedNight: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);

const NIGHT_ID = "11111111-1111-1111-1111-111111111111";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://test/api/nights/${NIGHT_ID}/theme`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeCtx() {
  return { params: Promise.resolve({ id: NIGHT_ID }) };
}

/**
 * Build a chainable mock for the Supabase client that handles:
 * 1. games.select().eq().eq().maybeSingle()  → liveGame check
 * 2. nights.update().eq().select().single()  → theme update
 *
 * Both chains terminate in mocked resolved values.
 */
function makeSupa(liveGame: { id: string } | null) {
  const maybeSingleFn = vi.fn().mockResolvedValue({ data: liveGame, error: null });
  const singleFn = vi.fn().mockResolvedValue({
    data: { theme_key: "june" },
    error: null,
  });

  // eq() is shared across both chains; we track call count to differentiate.
  let eqCallCount = 0;
  const eqFn = vi.fn().mockImplementation(() => {
    eqCallCount++;
    return supaClient;
  });

  const supaClient = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: eqFn,
    maybeSingle: maybeSingleFn,
    single: singleFn,
  };

  return supaClient;
}

beforeEach(() => {
  vi.resetAllMocks();
  authMock.requireOwnedNight.mockResolvedValue({
    ok: true,
    night: { id: NIGHT_ID },
  });
});

describe("Theme change API guard", () => {
  it("returns 409 when a game is live", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeSupa({ id: "g1" }));
    const { PATCH } = await import("@/app/api/nights/[id]/theme/route");
    const res = await PATCH(makeRequest({ themeKey: "june" }), makeCtx());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/can't change theme|live/i);
  });

  it("returns 200 when no game is live", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeSupa(null));
    const { PATCH } = await import("@/app/api/nights/[id]/theme/route");
    const res = await PATCH(makeRequest({ themeKey: "june" }), makeCtx());
    expect(res.status).toBe(200);
  });
});
