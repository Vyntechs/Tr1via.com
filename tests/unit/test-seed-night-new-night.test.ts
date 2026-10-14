// The e2e seeding route must hand every caller its OWN night. Since
// POST /api/nights now returns a host's fresh empty night instead of making a
// twin, host-mobile-full-parity.spec.ts (seeds "empty-night" then
// "two-games-ready" for one host seconds apart) would otherwise get the same
// night twice. Seeding asks for a new night and refuses a reused one.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => adminMock);

const NIGHT = "0993af1d-8571-4929-94e4-62d3392d44fc";

function gamesLookup() {
  const result = {
    data: [
      { id: "g1", game_no: 1, state: "draft" },
      { id: "g2", game_no: 2, state: "draft" },
    ],
    error: null,
  };
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "update"]) b[m] = vi.fn(() => b);
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return b;
}

function seedRequest() {
  return new NextRequest("http://test/api/_test/seed-night", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-secret": "seed-secret" },
    body: JSON.stringify({ scenario: "empty-night" }),
  });
}

function mockCreateNight(body: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("POST /api/_test/seed-night always seeds a new night", () => {
  beforeEach(() => {
    vi.stubEnv("TEST_AUTH_ENABLED", "1");
    vi.stubEnv("TEST_SECRET", "seed-secret");
    adminMock.getSupabaseAdmin.mockReturnValue({ from: vi.fn(() => gamesLookup()) });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("asks /api/nights for a brand-new night and forwards the test secret", async () => {
    const fetchMock = mockCreateNight({ nightId: NIGHT, roomCode: "EYBRKT", reused: false });
    const { POST } = await import("@/app/api/%5Ftest/seed-night/route");
    const res = await POST(seedRequest());
    expect(res.status).toBe(200);
    expect((await res.json()).nightId).toBe(NIGHT);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://test/api/nights");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-test-new-night"]).toBe("1");
    expect(headers["x-test-secret"]).toBe("seed-secret");
  });

  it("fails loudly instead of handing back a night another seed already got", async () => {
    mockCreateNight({ nightId: NIGHT, roomCode: "EYBRKT", reused: true });
    const { POST } = await import("@/app/api/%5Ftest/seed-night/route");
    const res = await POST(seedRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/reused/);
  });
});
