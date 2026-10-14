import { describe, it, expect, vi, beforeEach } from "vitest";

const call = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/auth", () => ({
  requireFounder: vi.fn(async () => ({ ok: true, host: { id: "h", display_name: "Brandon" } })),
}));
vi.mock("@/lib/api/internalFetch", () => ({ makeInternalFetch: () => call }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => ({ from }) }));

import { POST } from "@/app/api/founder/build-game/route";

// A tiny stand-in for the Supabase query builder: every step returns the same
// object, and awaiting it gives that table's rows.
function fakeTables(rows: { nightCreatedAt: string; categories: Array<{ id: string }> }) {
  from.mockImplementation((tableName: string) => {
    const result =
      tableName === "nights"
        ? { data: [{ created_at: rows.nightCreatedAt }], error: null }
        : tableName === "games"
          ? { data: [{ id: "g1", game_no: 1 }, { id: "g2", game_no: 2 }], error: null }
          : { data: rows.categories, error: null };
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit", "delete"]) q[m] = () => q;
    q.maybeSingle = async () => ({ data: result.data[0] ?? null, error: null });
    q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej);
    return q;
  });
}

function reusedNight() {
  call.mockImplementation(async (url: string) => {
    if (url === "/api/nights") {
      return new Response(JSON.stringify({ nightId: "n1", roomCode: "ABCDEF", reused: true }), { status: 200 });
    }
    if (url === "/api/categories") {
      return new Response(JSON.stringify({ category: { id: `c${call.mock.calls.length}` } }), { status: 201 });
    }
    return new Response("{}", { status: 202 });
  });
}

const req = {
  url: "https://app.test/api/founder/build-game",
  headers: { get: () => null },
} as unknown as import("next/server").NextRequest;
const categoryPosts = () => call.mock.calls.filter(([url]) => url === "/api/categories").length;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

beforeEach(() => {
  call.mockReset();
  from.mockReset();
});

describe("POST /api/founder/build-game when /api/nights hands back a night", () => {
  it("stops (409) if that night was made seconds ago and has no topics yet (a build may be about to add them)", async () => {
    reusedNight();
    fakeTables({ nightCreatedAt: ago(2_000), categories: [] });
    const res = await POST(req);
    expect(res.status).toBe(409);
    expect(categoryPosts()).toBe(0);
  });

  it("opens the night another build is filling, without adding a second set of topics", async () => {
    reusedNight();
    fakeTables({ nightCreatedAt: ago(4_000), categories: [{ id: "c-existing" }] });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { nightId: string }).nightId).toBe("n1");
    expect(categoryPosts()).toBe(0);
  });

  it("a retry is not stuck: a night left empty by a build that died is filled", async () => {
    reusedNight();
    fakeTables({ nightCreatedAt: ago(5 * 60_000), categories: [] });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(categoryPosts()).toBe(12);
  });
});
