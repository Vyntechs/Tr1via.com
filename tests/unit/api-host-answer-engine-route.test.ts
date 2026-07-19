import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({ getAuthedHost: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);

function request(body: unknown) {
  return new NextRequest("http://test/api/host/answer-engine", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeAdmin(setting: { release_enabled: boolean; preferred_engine: string } | null) {
  const updated = { preferred_engine: "resilient_v1" };
  const updateEq = vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: updated, error: null }) })) }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const maybeSingle = vi.fn().mockResolvedValue({ data: setting, error: null });
  const selectEq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq: selectEq }));
  const from = vi.fn((table: string) => {
    if (table === "nights") throw new Error("preference route must not mutate nights");
    return { select, update };
  });
  return { from, update };
}

describe("POST /api/host/answer-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.getAuthedHost.mockResolvedValue({ ok: true, host: { id: "host-id" } });
  });

  it("requires the server-controlled release gate", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin({
      release_enabled: false,
      preferred_engine: "legacy",
    }));
    const { POST } = await import("@/app/api/host/answer-engine/route");
    const response = await POST(request({ preferredEngine: "resilient_v1" }));
    expect(response.status).toBe(403);
  });

  it("requires an authenticated host", async () => {
    authMock.getAuthedHost.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: "not signed in",
    });
    const { POST } = await import("@/app/api/host/answer-engine/route");
    const response = await POST(request({ preferredEngine: "legacy" }));
    expect(response.status).toBe(401);
    expect(adminMock.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it("updates only the authenticated host's future-night preference", async () => {
    const admin = makeAdmin({ release_enabled: true, preferred_engine: "legacy" });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const { POST } = await import("@/app/api/host/answer-engine/route");
    const response = await POST(request({ preferredEngine: "resilient_v1" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ preferredEngine: "resilient_v1" });
    expect(admin.update).toHaveBeenCalledWith({
      preferred_engine: "resilient_v1",
      updated_at: expect.any(String),
    });
    expect(admin.from).not.toHaveBeenCalledWith("nights");
  });

  it("rejects attempts to change the release gate", async () => {
    const admin = makeAdmin({ release_enabled: true, preferred_engine: "legacy" });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const { POST } = await import("@/app/api/host/answer-engine/route");
    const response = await POST(request({
      preferredEngine: "resilient_v1",
      releaseEnabled: true,
    }));
    expect(response.status).toBe(400);
    expect(admin.update).not.toHaveBeenCalled();
  });
});

describe("GET /api/host/answer-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.getAuthedHost.mockResolvedValue({ ok: true, host: { id: "host-id" } });
  });

  it("returns the authenticated host's future-night preference when released", async () => {
    const admin = makeAdmin({
      release_enabled: true,
      preferred_engine: "resilient_v1",
    });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const { GET } = await import("@/app/api/host/answer-engine/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ preferredEngine: "resilient_v1" });
    expect(admin.update).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalledWith("nights");
  });

  it("does not expose the preference when the release is disabled", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin({
      release_enabled: false,
      preferred_engine: "legacy",
    }));
    const { GET } = await import("@/app/api/host/answer-engine/route");
    const response = await GET();
    expect(response.status).toBe(403);
  });
});
