// Route handler test — POST /api/categories/[id]/manual.
//
// The manual-entry fallback: when Claude generation fails or the host
// just wants to type questions by hand. The route accepts exactly 7
// questions (prompt, options, correctIndex, optional imageUrl), inserts
// each with source='host-edit', assigns point values 100..700 in the
// ORDER ENTERED (not sorted by difficulty — the host's typing order IS
// the difficulty order), wipes any existing rows in the category, and
// flips the category state to 'ready'.
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

function makeRequest(body: unknown) {
  return new NextRequest(
    `http://test/api/categories/${CATEGORY_ID}/manual`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function makeCtx(categoryId = CATEGORY_ID) {
  return { params: Promise.resolve({ id: categoryId }) };
}

interface QuestionPayload {
  prompt: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  imageUrl: string | null;
}

function validQuestion(label: string): QuestionPayload {
  return {
    prompt: `What is ${label}?`,
    options: [`${label} A`, `${label} B`, `${label} C`, `${label} D`],
    correctIndex: 0,
    imageUrl: null,
  };
}

function seven() {
  return [
    validQuestion("one"),
    validQuestion("two"),
    validQuestion("three"),
    validQuestion("four"),
    validQuestion("five"),
    validQuestion("six"),
    validQuestion("seven"),
  ];
}

/**
 * Build a stub Supabase admin client that:
 *  - deletes all existing questions for the category
 *  - inserts the new questions array
 *  - updates the category state
 * Records every call for assertions.
 */
function makeAdmin() {
  const calls = {
    rpc: vi.fn(),
  };
  calls.rpc.mockImplementation(
    async (
      _name: string,
      args: { p_questions: Array<Record<string, unknown>> },
    ) => ({
      data: {
        questions: args.p_questions.map((row, i) => ({
      id: `new-q-${i}`,
      ...row,
        })),
      },
      error: null,
    }),
  );
  const client = {
    from: vi.fn(),
    rpc: calls.rpc,
  };
  return { client, calls };
}

describe("POST /api/categories/[id]/manual", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 when no host is signed in", async () => {
    authMock.requireOwnedCategory.mockResolvedValue({
      ok: false,
      status: 401,
      error: "not signed in",
    });
    const { POST } = await import(
      "@/app/api/categories/[id]/manual/route"
    );
    const res = await POST(makeRequest({ questions: seven() }), makeCtx());
    expect(res.status).toBe(401);
  });

  it("403 when the host does not own the category", async () => {
    authMock.requireOwnedCategory.mockResolvedValue({
      ok: false,
      status: 403,
      error: "not yours",
    });
    const { POST } = await import(
      "@/app/api/categories/[id]/manual/route"
    );
    const res = await POST(makeRequest({ questions: seven() }), makeCtx());
    expect(res.status).toBe(403);
  });

  it("404 when the category does not exist", async () => {
    authMock.requireOwnedCategory.mockResolvedValue({
      ok: false,
      status: 404,
      error: "category not found",
    });
    const { POST } = await import(
      "@/app/api/categories/[id]/manual/route"
    );
    const res = await POST(makeRequest({ questions: seven() }), makeCtx());
    expect(res.status).toBe(404);
  });

  it("400 when fewer than 7 questions are supplied", async () => {
    authMock.requireOwnedCategory.mockResolvedValue({
      ok: true,
      host: { id: "h1" },
      night: { id: NIGHT_ID },
      category: { id: CATEGORY_ID, state: "draft" },
    });
    const { client } = makeAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(client);
    const { POST } = await import(
      "@/app/api/categories/[id]/manual/route"
    );
    const res = await POST(
      makeRequest({ questions: seven().slice(0, 5) }),
      makeCtx(),
    );
    expect(res.status).toBe(400);
  });

  it("400 when a question has fewer than 4 options", async () => {
    authMock.requireOwnedCategory.mockResolvedValue({
      ok: true,
      host: { id: "h1" },
      night: { id: NIGHT_ID },
      category: { id: CATEGORY_ID, state: "draft" },
    });
    const { client } = makeAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(client);
    const qs = seven();
    qs[0]!.options = ["only", "three", "options"] as unknown as [
      string,
      string,
      string,
      string,
    ];
    const { POST } = await import(
      "@/app/api/categories/[id]/manual/route"
    );
    const res = await POST(makeRequest({ questions: qs }), makeCtx());
    expect(res.status).toBe(400);
  });

  it("400 when correctIndex is out of range", async () => {
    authMock.requireOwnedCategory.mockResolvedValue({
      ok: true,
      host: { id: "h1" },
      night: { id: NIGHT_ID },
      category: { id: CATEGORY_ID, state: "draft" },
    });
    const { client } = makeAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(client);
    const qs = seven();
    qs[0]!.correctIndex = 4 as unknown as 0;
    const { POST } = await import(
      "@/app/api/categories/[id]/manual/route"
    );
    const res = await POST(makeRequest({ questions: qs }), makeCtx());
    expect(res.status).toBe(400);
  });

  it("409 when the category is already locked (state = ready)", async () => {
    authMock.requireOwnedCategory.mockResolvedValue({
      ok: true,
      host: { id: "h1" },
      night: { id: NIGHT_ID },
      category: { id: CATEGORY_ID, state: "ready" },
    });
    const { client } = makeAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(client);
    const { POST } = await import(
      "@/app/api/categories/[id]/manual/route"
    );
    const res = await POST(makeRequest({ questions: seven() }), makeCtx());
    expect(res.status).toBe(409);
  });

  it("creates 7 questions with source='host-edit' and point values 100..700 in order", async () => {
    authMock.requireOwnedCategory.mockResolvedValue({
      ok: true,
      host: { id: "h1" },
      night: { id: NIGHT_ID },
      category: { id: CATEGORY_ID, state: "draft" },
    });
    const { client, calls } = makeAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(client);

    const { POST } = await import(
      "@/app/api/categories/[id]/manual/route"
    );
    const res = await POST(makeRequest({ questions: seven() }), makeCtx());
    expect(res.status).toBe(200);

    expect(client.from).not.toHaveBeenCalled();
    expect(calls.rpc).toHaveBeenCalledTimes(1);
    expect(calls.rpc).toHaveBeenCalledWith(
      "replace_category_with_manual_questions",
      expect.objectContaining({ p_category_id: CATEGORY_ID }),
    );
    const insertRows = calls.rpc.mock.calls[0]?.[1]
      .p_questions as Array<Record<string, unknown>>;
    expect(insertRows).toHaveLength(7);

    // Each row carries the expected canonical fields, in the entered order.
    const points = [100, 200, 300, 400, 500, 600, 700];
    insertRows.forEach((row, idx) => {
      expect(row.category_id).toBe(CATEGORY_ID);
      expect(row.source).toBe("host-edit");
      expect(row.is_picked).toBe(true);
      expect(row.point_value).toBe(points[idx]);
      // Difficulty is derived from the position too — easy at the top,
      // hard at the bottom — so the difficulty meter reads sensibly.
      expect(row.difficulty).toBe(idx + 1);
      expect(row.options).toHaveLength(4);
      expect(typeof row.prompt).toBe("string");
      expect(row.correct_index).toBe(0);
    });
  });

  it("propagates the optional imageUrl when present", async () => {
    authMock.requireOwnedCategory.mockResolvedValue({
      ok: true,
      host: { id: "h1" },
      night: { id: NIGHT_ID },
      category: { id: CATEGORY_ID, state: "review" },
    });
    const { client, calls } = makeAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(client);

    const qs = seven();
    qs[0]!.imageUrl = "https://example.com/p.jpg";
    qs[3]!.imageUrl = "https://example.com/p2.png";

    const { POST } = await import(
      "@/app/api/categories/[id]/manual/route"
    );
    const res = await POST(makeRequest({ questions: qs }), makeCtx());
    expect(res.status).toBe(200);
    const insertRows = calls.rpc.mock.calls[0]?.[1]
      .p_questions as Array<Record<string, unknown>>;
    expect(insertRows[0]?.image_url).toBe("https://example.com/p.jpg");
    expect(insertRows[0]?.image_source).toBe("upload");
    expect(insertRows[3]?.image_url).toBe("https://example.com/p2.png");
    // Rows without an image stay null.
    expect(insertRows[1]?.image_url).toBeNull();
  });
});
