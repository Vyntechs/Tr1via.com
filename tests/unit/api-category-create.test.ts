import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({ requireOwnedGame: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);

const GAME_ID = "11111111-1111-1111-1111-111111111111";
const EXISTING_ID = "22222222-2222-2222-2222-222222222222";
const NEW_ID = "33333333-3333-3333-3333-333333333333";

function createRequest(body: Record<string, unknown>) {
  return new NextRequest("http://test/api/categories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = { gameId: GAME_ID, name: "Marvel MCU", topic: "Marvel MCU", position: 1 };

// A dropped-then-retried "Pull questions" must not create a second category at
// the same slot. The create route is get-or-create on (game_id, position, topic).
function createAdmin({
  existing,
  selectError = false,
}: {
  existing: boolean;
  selectError?: boolean;
}) {
  const insert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn(async () => ({
        data: { id: NEW_ID, name: "Marvel MCU", topic: "Marvel MCU", position: 1, state: "draft" },
        error: null,
      })),
    })),
  }));

  const existingRows = existing
    ? [{ id: EXISTING_ID, name: "Marvel MCU", topic: "Marvel MCU", position: 1, state: "draft" }]
    : [];
  const lookupResult = selectError
    ? { data: null, error: { message: "db read failed" } }
    : { data: existingRows, error: null };

  const admin = {
    from: vi.fn((table: string) => {
      if (table !== "categories") throw new Error(`unexpected table: ${table}`);
      const lookup: Record<string, unknown> = {};
      for (const method of ["select", "eq", "limit"]) lookup[method] = vi.fn(() => lookup);
      lookup.then = (
        resolve: (value: typeof lookupResult) => unknown,
        reject: (reason: unknown) => unknown,
      ) => Promise.resolve(lookupResult).then(resolve, reject);
      return { ...lookup, insert };
    }),
  };
  return { admin, insert };
}

describe("POST /api/categories — idempotent get-or-create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.requireOwnedGame.mockResolvedValue({
      ok: true,
      host: { id: "host" },
      night: { id: "night" },
    });
  });

  it("returns the existing category on a retried create instead of duplicating the slot", async () => {
    const { admin, insert } = createAdmin({ existing: true });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/categories/route");
    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { category: { id: string } };
    expect(body.category.id).toBe(EXISTING_ID);
    expect(insert).not.toHaveBeenCalled();
  });

  it("fails closed (does not insert) when the idempotency lookup itself errors", async () => {
    // A transient DB/read failure on the get-or-create SELECT must NOT fall
    // through to a plain insert — that would duplicate the slot on a retry,
    // the exact thing the idempotency guard exists to prevent.
    const { admin, insert } = createAdmin({ existing: false, selectError: true });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/categories/route");
    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(500);
    expect(insert).not.toHaveBeenCalled();
  });

  it("inserts a new category when the slot is empty", async () => {
    const { admin, insert } = createAdmin({ existing: false });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/categories/route");
    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(201);
    const body = (await response.json()) as { category: { id: string } };
    expect(body.category.id).toBe(NEW_ID);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
