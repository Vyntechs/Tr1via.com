import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ requireOwnedQuestion: vi.fn() }));
const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));

vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/supabase/admin", () => adminMock);

import { POST } from "@/app/api/images/upload/route";

const QUESTION_ID = "11111111-1111-4111-8111-111111111111";
const NIGHT_ID = "22222222-2222-4222-8222-222222222222";
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
]);

function requestWithPng() {
  const form = new FormData();
  form.set("questionId", QUESTION_ID);
  const file = new File([PNG_BYTES], "question.png", { type: "image/png" });
  // jsdom's File omits Blob.arrayBuffer even though production multipart
  // Files provide it.
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => PNG_BYTES.buffer,
  });
  form.set("file", file);
  return { formData: async () => form };
}

describe("POST /api/images/upload immutable replacements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.requireOwnedQuestion.mockResolvedValue({
      ok: true,
      night: { id: NIGHT_ID },
      question: { id: QUESTION_ID },
    });
  });

  it("uses a distinct object URL for every replacement and stores the latest URL", async () => {
    const uploadedKeys: string[] = [];
    const savedUrls: string[] = [];
    const bucket = {
      upload: vi.fn(async (key: string) => {
        uploadedKeys.push(key);
        return { data: { path: key }, error: null };
      }),
      getPublicUrl: vi.fn((key: string) => ({
        data: { publicUrl: `https://storage.example/${key}` },
      })),
    };
    const admin = {
      storage: { from: vi.fn(() => bucket) },
      from: vi.fn(() => ({
        update(payload: { image_url: string }) {
          savedUrls.push(payload.image_url);
          return {
            eq() {
              return {
                select() {
                  return {
                    single: async () => ({
                      data: {
                        id: QUESTION_ID,
                        image_url: payload.image_url,
                        image_source: "upload",
                      },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        },
      })),
    };
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const first = await POST(requestWithPng() as never);
    const second = await POST(requestWithPng() as never);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(uploadedKeys).toHaveLength(2);
    expect(uploadedKeys[0]).not.toBe(uploadedKeys[1]);
    expect(savedUrls).toEqual(uploadedKeys.map((key) => `https://storage.example/${key}`));
    await expect(second.json()).resolves.toMatchObject({
      question: { image_url: savedUrls[1] },
    });
  });
});
