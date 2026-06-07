import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/api/auth", () => ({
  requireFounder: vi.fn(),
}));

import { requireFounder } from "@/lib/api/auth";
import { POST } from "@/app/api/founder/build-game/route";

function req() {
  return {
    url: "https://app.test/api/founder/build-game",
    headers: { get: () => null },
  } as unknown as import("next/server").NextRequest;
}

afterEach(() => vi.restoreAllMocks());

describe("POST /api/founder/build-game gate", () => {
  it("403s a non-founder host", async () => {
    vi.mocked(requireFounder).mockResolvedValue({
      ok: false,
      status: 403,
      error: "founder only",
    });
    const res = await POST(req());
    expect(res.status).toBe(403);
  });
  it("401s an unauthenticated request", async () => {
    vi.mocked(requireFounder).mockResolvedValue({
      ok: false,
      status: 401,
      error: "not signed in",
    });
    const res = await POST(req());
    expect(res.status).toBe(401);
  });
});
