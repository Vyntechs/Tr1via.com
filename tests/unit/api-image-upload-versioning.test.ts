import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.hoisted(() => ({ requireOwnedQuestion: vi.fn() }));
const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));

vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/supabase/admin", () => adminMock);

import { POST } from "@/app/api/images/upload/route";
import { PATCH } from "@/app/api/questions/[id]/photo/route";

const QUESTION_ID = "11111111-1111-4111-8111-111111111111";
const NIGHT_ID = "22222222-2222-4222-8222-222222222222";
const SUPABASE_URL = "https://project-ref.supabase.co";
const PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/question-images`;
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
]);

function requestWithPng() {
  const form = new FormData();
  form.set("questionId", QUESTION_ID);
  const file = new File([PNG_BYTES], "question.png", { type: "image/png" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => PNG_BYTES.buffer,
  });
  form.set("file", file);
  return { formData: async () => form };
}

function noImageRequest() {
  return new NextRequest(`http://test/api/questions/${QUESTION_ID}/photo`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

interface ImageState {
  image_url: string | null;
  image_source: string | null;
  image_attribution: string | null;
}

function createAdminHarness(options: {
  blockFirstCas?: boolean;
  publicUrlMissing?: boolean;
  casError?: boolean;
  removeError?: boolean;
} = {}) {
  const state: ImageState = {
    image_url: null,
    image_source: null,
    image_attribution: null,
  };
  const uploadedKeys: string[] = [];
  const removedKeys: string[] = [];
  const events: string[] = [];
  const firstCasStarted = deferred();
  const releaseFirstCas = deferred();
  let casCalls = 0;

  const runCas = async (
    payload: Partial<ImageState>,
    filters: Map<string, unknown>,
  ) => {
    casCalls += 1;
    if (options.blockFirstCas && casCalls === 1) {
      firstCasStarted.resolve();
      await releaseFirstCas.promise;
    }
    events.push(`cas:${String(payload.image_url)}`);
    if (options.casError) {
      return { data: null, error: { message: "database unavailable" } };
    }
    const matches = ["image_url", "image_source"].every(
      (column) =>
        !filters.has(column) ||
        state[column as keyof ImageState] === filters.get(column),
    );
    if (!matches) return { data: null, error: null };
    Object.assign(state, payload);
    return { data: { id: QUESTION_ID, ...state }, error: null };
  };

  const bucket = {
    upload: vi.fn(async (key: string) => {
      uploadedKeys.push(key);
      events.push(`upload:${key}`);
      return { data: { path: key }, error: null };
    }),
    getPublicUrl: vi.fn((key: string) => ({
      data: {
        publicUrl: options.publicUrlMissing ? "" : `${PUBLIC_PREFIX}/${key}`,
      },
    })),
    remove: vi.fn(async (paths: string[]) => {
      removedKeys.push(...paths);
      events.push(...paths.map((path) => `remove:${path}`));
      return options.removeError
        ? { data: null, error: { message: "storage cleanup failed" } }
        : { data: [], error: null };
    }),
  };

  const admin = {
    storage: { from: vi.fn(() => bucket) },
    from: vi.fn(() => ({
      update(payload: Partial<ImageState>) {
        const filters = new Map<string, unknown>();
        const builder = {
          eq(column: string, value: unknown) {
            if (column !== "id") filters.set(column, value);
            return builder;
          },
          is(column: string, value: unknown) {
            filters.set(column, value);
            return builder;
          },
          select() {
            return builder;
          },
          single: () => runCas(payload, filters),
          maybeSingle: () => runCas(payload, filters),
        };
        return builder;
      },
      select() {
        const builder = {
          eq() {
            return builder;
          },
          neq() {
            return builder;
          },
          limit() {
            return builder;
          },
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return builder;
      },
    })),
  };

  return {
    admin,
    state,
    uploadedKeys,
    removedKeys,
    events,
    firstCasStarted: firstCasStarted.promise,
    releaseFirstCas: releaseFirstCas.resolve,
  };
}

function ownedQuestion(harness: ReturnType<typeof createAdminHarness>) {
  return {
    ok: true,
    night: { id: NIGHT_ID },
    question: { id: QUESTION_ID, ...harness.state },
  };
}

describe("question image upload CAS and compensation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  });

  it("uses unique URLs and removes only the proven predecessor after a replacement", async () => {
    const harness = createAdminHarness();
    adminMock.getSupabaseAdmin.mockReturnValue(harness.admin);
    authMock.requireOwnedQuestion.mockImplementation(async () => ownedQuestion(harness));

    const first = await POST(requestWithPng() as never);
    const second = await POST(requestWithPng() as never);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(harness.uploadedKeys).toHaveLength(2);
    expect(harness.uploadedKeys[0]).not.toBe(harness.uploadedKeys[1]);
    expect(harness.state).toMatchObject({
      image_url: `${PUBLIC_PREFIX}/${harness.uploadedKeys[1]}`,
      image_source: "upload",
    });
    expect(harness.removedKeys).toEqual([harness.uploadedKeys[0]]);
    expect(harness.events.indexOf(`cas:${harness.state.image_url}`)).toBeLessThan(
      harness.events.indexOf(`remove:${harness.uploadedKeys[0]}`),
    );
  });

  it("lets one concurrent upload win and compensates the stale upload object", async () => {
    const harness = createAdminHarness({ blockFirstCas: true });
    adminMock.getSupabaseAdmin.mockReturnValue(harness.admin);
    authMock.requireOwnedQuestion.mockImplementation(async () => ownedQuestion(harness));

    const firstPromise = POST(requestWithPng() as never);
    await harness.firstCasStarted;
    const second = await POST(requestWithPng() as never);
    harness.releaseFirstCas();
    const first = await firstPromise;

    expect(second.status).toBe(200);
    expect(first.status).toBe(409);
    expect(harness.state).toMatchObject({
      image_url: `${PUBLIC_PREFIX}/${harness.uploadedKeys[1]}`,
      image_source: "upload",
    });
    expect(harness.removedKeys).toEqual([harness.uploadedKeys[0]]);
  });

  it("lets no-image win over an in-flight upload and removes the stale upload object", async () => {
    const harness = createAdminHarness({ blockFirstCas: true });
    adminMock.getSupabaseAdmin.mockReturnValue(harness.admin);
    authMock.requireOwnedQuestion.mockImplementation(async () => ownedQuestion(harness));

    const uploadPromise = POST(requestWithPng() as never);
    await harness.firstCasStarted;
    const clear = await PATCH(noImageRequest(), {
      params: Promise.resolve({ id: QUESTION_ID }),
    });
    harness.releaseFirstCas();
    const upload = await uploadPromise;

    expect(clear.status).toBe(200);
    expect(upload.status).toBe(409);
    expect(harness.state).toMatchObject({ image_url: null, image_source: "none" });
    expect(harness.removedKeys).toEqual([harness.uploadedKeys[0]]);
  });

  it("lets upload win over an in-flight no-image choice without removing the winner", async () => {
    const harness = createAdminHarness({ blockFirstCas: true });
    adminMock.getSupabaseAdmin.mockReturnValue(harness.admin);
    authMock.requireOwnedQuestion.mockImplementation(async () => ownedQuestion(harness));

    const clearPromise = PATCH(noImageRequest(), {
      params: Promise.resolve({ id: QUESTION_ID }),
    });
    await harness.firstCasStarted;
    const upload = await POST(requestWithPng() as never);
    harness.releaseFirstCas();
    const clear = await clearPromise;

    expect(upload.status).toBe(200);
    expect(clear.status).toBe(409);
    expect(harness.state).toMatchObject({
      image_url: `${PUBLIC_PREFIX}/${harness.uploadedKeys[0]}`,
      image_source: "upload",
    });
    expect(harness.removedKeys).toEqual([]);
  });

  it("removes the new key when public URL resolution fails", async () => {
    const harness = createAdminHarness({ publicUrlMissing: true });
    adminMock.getSupabaseAdmin.mockReturnValue(harness.admin);
    authMock.requireOwnedQuestion.mockResolvedValue(ownedQuestion(harness));

    const response = await POST(requestWithPng() as never);

    expect(response.status).toBe(500);
    expect(harness.removedKeys).toEqual([harness.uploadedKeys[0]]);
    expect(harness.events.some((event) => event.startsWith("cas:"))).toBe(false);
  });

  it("does not mask public URL failure when new-key compensation also fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const harness = createAdminHarness({
      publicUrlMissing: true,
      removeError: true,
    });
    adminMock.getSupabaseAdmin.mockReturnValue(harness.admin);
    authMock.requireOwnedQuestion.mockResolvedValue(ownedQuestion(harness));

    const response = await POST(requestWithPng() as never);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: "failed to resolve public URL for uploaded image",
    });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/new upload/i));
  });

  it("removes the new key after a database failure without masking that failure", async () => {
    const harness = createAdminHarness({ casError: true });
    adminMock.getSupabaseAdmin.mockReturnValue(harness.admin);
    authMock.requireOwnedQuestion.mockResolvedValue(ownedQuestion(harness));

    const response = await POST(requestWithPng() as never);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/database unavailable/),
    });
    expect(harness.removedKeys).toEqual([harness.uploadedKeys[0]]);
  });

  it("keeps a successful replacement successful when predecessor cleanup fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const harness = createAdminHarness({ removeError: true });
    adminMock.getSupabaseAdmin.mockReturnValue(harness.admin);
    authMock.requireOwnedQuestion.mockImplementation(async () => ownedQuestion(harness));

    expect((await POST(requestWithPng() as never)).status).toBe(200);
    const second = await POST(requestWithPng() as never);

    expect(second.status).toBe(200);
    expect(harness.state.image_url).toBe(
      `${PUBLIC_PREFIX}/${harness.uploadedKeys[1]}`,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/cleanup/i));
  });
});
