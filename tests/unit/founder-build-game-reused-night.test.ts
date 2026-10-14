import { describe, it, expect, vi } from "vitest";

const call = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/auth", () => ({
  requireFounder: vi.fn(async () => ({ ok: true, host: { id: "h", display_name: "Brandon" } })),
}));
vi.mock("@/lib/api/internalFetch", () => ({ makeInternalFetch: () => call }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => ({ from }) }));

import { POST } from "@/app/api/founder/build-game/route";

describe("POST /api/founder/build-game on a double tap", () => {
  it("stops (409) instead of adding a second set of categories to a night another build is filling", async () => {
    call.mockResolvedValueOnce(
      new Response(JSON.stringify({ nightId: "n1", roomCode: "ABCDEF", reused: true }), { status: 200 }),
    );
    const res = await POST({
      url: "https://app.test/api/founder/build-game",
      headers: { get: () => null },
    } as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(409);
    expect(call).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });
});
