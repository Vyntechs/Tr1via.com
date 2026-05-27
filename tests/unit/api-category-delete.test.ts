// Route handler test — DELETE /api/categories/[id].
//
// Heather lost an entire game-1 setup turn because she had no way to
// remove a category she'd accidentally created (typo in the topic). The
// DELETE endpoint removes the categories row; FK cascade in 0001_init.sql
// nukes the dependent questions + plays + answers in one shot. We don't
// gate on category.state — the host can delete a 'draft', 'generating',
// 'review', or 'ready' row during setup. Deleting from a live night is
// out of scope (use the existing reset-night path).
//
// Module boundaries are mocked so no live Supabase is needed.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
}));
const authMock = vi.hoisted(() => ({
  requireOwnedCategory: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);

const CATEGORY_ID = "44444444-4444-4444-4444-444444444444";
const NIGHT_ID = "11111111-1111-1111-1111-111111111111";

function makeRequest() {
  return new NextRequest(
    `http://test/api/categories/${CATEGORY_ID}`,
    { method: "DELETE" },
  );
}

function makeCtx(categoryId = CATEGORY_ID) {
  return { params: Promise.resolve({ id: categoryId }) };
}

function makeAdmin(deleteError: { message: string } | null = null) {
  const calls = {
    deletedIds: [] as string[],
  };
  const client = {
    from: vi.fn((table: string) => {
      if (table === "categories") {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn((_col: string, value: string) => {
              calls.deletedIds.push(value);
              return Promise.resolve({ error: deleteError });
            }),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { client, calls };
}

describe("DELETE /api/categories/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 when no host is signed in", async () => {
    authMock.requireOwnedCategory.mockResolvedValue({
      ok: false,
      status: 401,
      error: "not signed in",
    });
    const { DELETE } = await import("@/app/api/categories/[id]/route");
    const res = await DELETE(makeRequest(), makeCtx());
    expect(res.status).toBe(401);
  });

  it("403 when the host does not own the category", async () => {
    authMock.requireOwnedCategory.mockResolvedValue({
      ok: false,
      status: 403,
      error: "not yours",
    });
    const { DELETE } = await import("@/app/api/categories/[id]/route");
    const res = await DELETE(makeRequest(), makeCtx());
    expect(res.status).toBe(403);
  });

  it("404 when the category does not exist", async () => {
    authMock.requireOwnedCategory.mockResolvedValue({
      ok: false,
      status: 404,
      error: "category not found",
    });
    const { DELETE } = await import("@/app/api/categories/[id]/route");
    const res = await DELETE(makeRequest(), makeCtx());
    expect(res.status).toBe(404);
  });

  it("204 + deletes the row when the host owns the draft category", async () => {
    authMock.requireOwnedCategory.mockResolvedValue({
      ok: true,
      host: { id: "h1" },
      night: { id: NIGHT_ID },
      category: { id: CATEGORY_ID, state: "draft" },
    });
    const { client, calls } = makeAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(client);

    const { DELETE } = await import("@/app/api/categories/[id]/route");
    const res = await DELETE(makeRequest(), makeCtx());

    expect(res.status).toBe(204);
    expect(calls.deletedIds).toEqual([CATEGORY_ID]);
  });

  it("204 even when the category is in 'review' (mid-pick)", async () => {
    authMock.requireOwnedCategory.mockResolvedValue({
      ok: true,
      host: { id: "h1" },
      night: { id: NIGHT_ID },
      category: { id: CATEGORY_ID, state: "review" },
    });
    const { client, calls } = makeAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(client);

    const { DELETE } = await import("@/app/api/categories/[id]/route");
    const res = await DELETE(makeRequest(), makeCtx());

    expect(res.status).toBe(204);
    expect(calls.deletedIds).toEqual([CATEGORY_ID]);
  });

  it("204 even when the category is 'ready' (locked, pre-game)", async () => {
    // Heather can change her mind about a locked category before opening
    // the room. The delete here is fine; if the night is live she has to
    // go through the existing reset-night flow instead.
    authMock.requireOwnedCategory.mockResolvedValue({
      ok: true,
      host: { id: "h1" },
      night: { id: NIGHT_ID },
      category: { id: CATEGORY_ID, state: "ready" },
    });
    const { client, calls } = makeAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(client);

    const { DELETE } = await import("@/app/api/categories/[id]/route");
    const res = await DELETE(makeRequest(), makeCtx());

    expect(res.status).toBe(204);
    expect(calls.deletedIds).toEqual([CATEGORY_ID]);
  });

  it("500 when the database delete errors", async () => {
    authMock.requireOwnedCategory.mockResolvedValue({
      ok: true,
      host: { id: "h1" },
      night: { id: NIGHT_ID },
      category: { id: CATEGORY_ID, state: "draft" },
    });
    const { client } = makeAdmin({ message: "boom" });
    adminMock.getSupabaseAdmin.mockReturnValue(client);

    const { DELETE } = await import("@/app/api/categories/[id]/route");
    const res = await DELETE(makeRequest(), makeCtx());

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("boom");
  });
});
