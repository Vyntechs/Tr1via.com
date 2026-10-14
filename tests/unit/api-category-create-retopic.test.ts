import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// POST /api/categories when a filled slot gets a DIFFERENT topic: an empty row
// takes it in place (typo fix after question-writing failed); a row with
// questions keeps the protective "Slot N already has" answer. The in-place
// change itself (fencing, counts, guard) is tested on pglite in
// tests/integration/retopic-empty-category.test.ts.

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({ requireOwnedGame: vi.fn() }));
const retopicMock = vi.hoisted(() => ({ retopicEmptyCategory: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/host/retopicEmptyCategory", () => retopicMock);

const GAME_ID = "11111111-1111-1111-1111-111111111111";
const ROW_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_ID = "44444444-4444-4444-4444-444444444444";

const ROW = {
  id: ROW_ID,
  game_id: GAME_ID,
  name: "Ghost Storys",
  topic: "Ghost Storys",
  position: 3,
  state: "generating",
  created_at: "2026-10-14T18:00:00.000Z",
};

function adminWith(rows: Array<typeof ROW>) {
  const insert = vi.fn();
  const admin = {
    from: vi.fn((table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in"]) q[m] = vi.fn(() => q);
      const data = table === "categories" ? rows : [];
      q.then = (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) =>
        Promise.resolve({ data, error: null }).then(resolve, reject);
      return { ...q, insert };
    }),
  };
  return { admin, insert };
}

async function post(topic: string) {
  const { POST } = await import("@/app/api/categories/route");
  return POST(
    new NextRequest("http://test/api/categories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId: GAME_ID, name: topic, topic, position: 3 }),
    }),
  );
}

describe("POST /api/categories — a new topic for a slot whose row is empty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.requireOwnedGame.mockResolvedValue({ ok: true, host: { id: "h" }, night: { id: "n" } });
  });

  it("an empty row takes the new topic in place: same id, carries on to question-writing", async () => {
    const { admin, insert } = adminWith([ROW]);
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    retopicMock.retopicEmptyCategory.mockResolvedValue({
      kind: "retopicked",
      category: { id: ROW_ID, name: "Ghost Stories", topic: "Ghost Stories", position: 3, state: "draft" },
    });

    const res = await post("Ghost Stories");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      category: { id: ROW_ID, name: "Ghost Stories", topic: "Ghost Stories", position: 3, state: "draft" },
      reused: true,
      sameTopic: true,
      retopicked: true,
    });
    expect(retopicMock.retopicEmptyCategory).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ id: ROW_ID, topic: "Ghost Storys", state: "generating" }),
      { topic: "Ghost Stories", name: "Ghost Stories" },
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it("a row with questions keeps the protective answer", async () => {
    const { admin, insert } = adminWith([ROW]);
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    retopicMock.retopicEmptyCategory.mockResolvedValue({ kind: "keep" });

    const res = await post("Ghost Stories");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ category: { id: ROW_ID, name: "Ghost Storys" }, reused: true, sameTopic: false });
    expect(body.retopicked).toBeUndefined();
    expect(insert).not.toHaveBeenCalled();
  });

  it("a row changed at the same moment answers 409 with a plain try-again message", async () => {
    const { admin } = adminWith([ROW]);
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    retopicMock.retopicEmptyCategory.mockResolvedValue({ kind: "busy", message: "Tap again in a moment." });
    const res = await post("Ghost Stories");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Tap again in a moment." });
  });

  it("a failed read or write answers 500 and adds no row", async () => {
    const { admin, insert } = adminWith([ROW]);
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    retopicMock.retopicEmptyCategory.mockResolvedValue({ kind: "error", message: "db down" });
    const res = await post("Ghost Stories");
    expect(res.status).toBe(500);
    expect(insert).not.toHaveBeenCalled();
  });

  it("the same words in other capitals and spacing just reuse the row (no topic change)", async () => {
    const { admin } = adminWith([ROW]);
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const res = await post("  ghost   STORYS ");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ category: { id: ROW_ID }, reused: true, sameTopic: true });
    expect(retopicMock.retopicEmptyCategory).not.toHaveBeenCalled();
  });

  it("a slot that is already doubled is never re-topicked", async () => {
    const { admin } = adminWith([ROW, { ...ROW, id: OTHER_ID, created_at: "2026-10-14T18:01:00.000Z" }]);
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const res = await post("Ghost Stories");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reused: true, sameTopic: false });
    expect(retopicMock.retopicEmptyCategory).not.toHaveBeenCalled();
  });
});
