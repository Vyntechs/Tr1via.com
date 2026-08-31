import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.hoisted(() => ({ requireOwnedCategory: vi.fn() }));
const pickMock = vi.hoisted(() => ({ pickQuestionsForCategory: vi.fn() }));

vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/host/pickQuestions", () => pickMock);

import { POST } from "@/app/api/categories/[id]/pick/route";

const CATEGORY_ID = "44444444-4444-4444-8444-444444444444";
const ASSIGNMENTS = Array.from({ length: 7 }, (_, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`,
  pointValue: (index + 1) * 100,
}));

function request(body: unknown) {
  return new NextRequest(`http://test/api/categories/${CATEGORY_ID}/pick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/categories/[id]/pick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.requireOwnedCategory.mockResolvedValue({
      ok: true,
      category: { id: CATEGORY_ID, state: "review" },
    });
    pickMock.pickQuestionsForCategory.mockResolvedValue({
      ok: true,
      picked: ASSIGNMENTS,
    });
  });

  it("passes the exact host assignments to the atomic persistence helper", async () => {
    const response = await POST(request({ assignments: ASSIGNMENTS }), {
      params: Promise.resolve({ id: CATEGORY_ID }),
    });

    expect(response.status).toBe(200);
    expect(pickMock.pickQuestionsForCategory).toHaveBeenCalledWith(
      CATEGORY_ID,
      ASSIGNMENTS,
    );
  });

  it("rejects a repeated slot before persistence", async () => {
    const duplicateSlot = ASSIGNMENTS.map((assignment, index) => ({
      ...assignment,
      pointValue: index === 6 ? 600 : assignment.pointValue,
    }));
    const response = await POST(request({ assignments: duplicateSlot }), {
      params: Promise.resolve({ id: CATEGORY_ID }),
    });

    expect(response.status).toBe(400);
    expect(pickMock.pickQuestionsForCategory).not.toHaveBeenCalled();
  });
});
