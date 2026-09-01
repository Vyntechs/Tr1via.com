import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.hoisted(() => ({ requireOwnedQuestion: vi.fn() }));
const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));

vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/supabase/admin", () => adminMock);

import { PATCH } from "@/app/api/questions/[id]/photo/route";

const QUESTION_ID = "11111111-1111-4111-8111-111111111111";
const NIGHT_ID = "22222222-2222-4222-8222-222222222222";
const SUPABASE_URL = "https://project-ref.supabase.co";

describe("PATCH /api/questions/[id]/photo clear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    authMock.requireOwnedQuestion.mockResolvedValue({
      ok: true,
      night: { id: NIGHT_ID },
      question: {
        id: QUESTION_ID,
        image_url: null,
        image_source: null,
      },
    });
  });

  it("removes an unshared owned upload only after no-image is saved", async () => {
    const versionId = "33333333-3333-4333-8333-333333333333";
    const path = `${NIGHT_ID}/${QUESTION_ID}/${versionId}.png`;
    const oldUrl = `${SUPABASE_URL}/storage/v1/object/public/question-images/${path}`;
    authMock.requireOwnedQuestion.mockResolvedValue({
      ok: true,
      night: { id: NIGHT_ID },
      question: {
        id: QUESTION_ID,
        image_url: oldUrl,
        image_source: "upload",
      },
    });
    const events: string[] = [];
    const cas = {
      eq: () => cas,
      is: () => cas,
      select: () => cas,
      maybeSingle: async () => {
        events.push("cas");
        return {
          data: {
            id: QUESTION_ID,
            image_url: null,
            image_attribution: null,
            image_source: "none",
          },
          error: null,
        };
      },
    };
    const references = {
      select: () => references,
      eq: () => references,
      neq: () => references,
      limit: () => references,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    const remove = vi.fn(async ([removedPath]: string[]) => {
      events.push(`remove:${removedPath}`);
      return { data: [], error: null };
    });
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: vi
        .fn()
        .mockReturnValueOnce({ update: () => cas })
        .mockReturnValueOnce(references),
      storage: { from: vi.fn(() => ({ remove })) },
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
    expect(remove).toHaveBeenCalledWith([path]);
    expect(events).toEqual(["cas", `remove:${path}`]);
  });

  it("persists and returns the deliberate no-image state", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const filters: Array<[string, string, unknown]> = [];
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: vi.fn(() => ({
        update(payload: Record<string, unknown>) {
          updates.push(payload);
          const builder = {
            eq(column: string, value: unknown) {
              filters.push(["eq", column, value]);
              return builder;
            },
            is(column: string, value: unknown) {
              filters.push(["is", column, value]);
              return builder;
            },
            select() {
              return builder;
            },
            maybeSingle: async () => ({
              data: { id: QUESTION_ID, ...payload },
              error: null,
            }),
          };
          return builder;
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
    expect(filters).toEqual([
      ["eq", "id", QUESTION_ID],
      ["is", "image_url", null],
      ["is", "image_source", null],
    ]);
    await expect(response.json()).resolves.toMatchObject({
      question: {
        id: QUESTION_ID,
        image_url: null,
        image_attribution: null,
        image_source: "none",
      },
    });
  });

  it("returns 409 when the predecessor no longer matches", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: vi.fn(() => ({
        update() {
          const builder = {
            eq: () => builder,
            is: () => builder,
            select: () => builder,
            maybeSingle: async () => ({ data: null, error: null }),
          };
          return builder;
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

    expect(response.status).toBe(409);
  });
});
