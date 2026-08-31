import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.hoisted(() => ({ requireOwnedQuestion: vi.fn() }));
const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));

vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/supabase/admin", () => adminMock);

import { PATCH } from "@/app/api/questions/[id]/photo/route";

const QUESTION_ID = "11111111-1111-4111-8111-111111111111";

describe("PATCH /api/questions/[id]/photo clear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.requireOwnedQuestion.mockResolvedValue({
      ok: true,
      question: { id: QUESTION_ID },
    });
  });

  it("persists and returns the deliberate no-image state", async () => {
    const updates: Array<Record<string, unknown>> = [];
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: vi.fn(() => ({
        update(payload: Record<string, unknown>) {
          updates.push(payload);
          return {
            eq() {
              return {
                select() {
                  return {
                    single: async () => ({
                      data: { id: QUESTION_ID, ...payload },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        },
      })),
    });

    const response = await PATCH(
      new NextRequest(`http://test/api/questions/${QUESTION_ID}/photo`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ id: QUESTION_ID }) },
    );

    expect(response.status).toBe(200);
    expect(updates).toEqual([{
      image_url: null,
      image_attribution: null,
      image_source: "none",
    }]);
    await expect(response.json()).resolves.toMatchObject({
      question: {
        id: QUESTION_ID,
        image_url: null,
        image_attribution: null,
        image_source: "none",
      },
    });
  });
});
