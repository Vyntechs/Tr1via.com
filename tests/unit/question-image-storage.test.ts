import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanupReplacedQuestionUpload,
  parseOwnedQuestionImagePath,
} from "@/lib/host/question-image-storage";

const SUPABASE_URL = "https://project-ref.supabase.co";
const NIGHT_ID = "22222222-2222-4222-8222-222222222222";
const QUESTION_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const PREFIX = `${SUPABASE_URL}/storage/v1/object/public/question-images`;

describe("owned question-image paths", () => {
  it.each([
    [`${PREFIX}/${NIGHT_ID}/${QUESTION_ID}/${VERSION_ID}.png`, `${NIGHT_ID}/${QUESTION_ID}/${VERSION_ID}.png`],
    [`${PREFIX}/${NIGHT_ID}/${QUESTION_ID}.jpg`, `${NIGHT_ID}/${QUESTION_ID}.jpg`],
  ])("accepts the exact current question path %s", (publicUrl, expected) => {
    expect(
      parseOwnedQuestionImagePath({
        publicUrl,
        supabaseUrl: SUPABASE_URL,
        nightId: NIGHT_ID,
        questionId: QUESTION_ID,
      }),
    ).toBe(expected);
  });

  it.each([
    `https://attacker.example/storage/v1/object/public/question-images/${NIGHT_ID}/${QUESTION_ID}/${VERSION_ID}.png`,
    `${SUPABASE_URL}/storage/v1/object/public/other-bucket/${NIGHT_ID}/${QUESTION_ID}/${VERSION_ID}.png`,
    `${PREFIX}/55555555-5555-4555-8555-555555555555/${QUESTION_ID}/${VERSION_ID}.png`,
    `${PREFIX}/${NIGHT_ID}/44444444-4444-4444-8444-444444444444/${VERSION_ID}.png`,
    `${PREFIX}/${NIGHT_ID}/${QUESTION_ID}/%2Fetc.png`,
    `${PREFIX}/${NIGHT_ID}/${QUESTION_ID}/%2e%2e`,
    `${PREFIX}/${NIGHT_ID}/${QUESTION_ID}/%E0%A4%A.png`,
    "not a URL",
  ])("rejects an unowned or malformed URL: %s", (publicUrl) => {
    expect(
      parseOwnedQuestionImagePath({
        publicUrl,
        supabaseUrl: SUPABASE_URL,
        nightId: NIGHT_ID,
        questionId: QUESTION_ID,
      }),
    ).toBeNull();
  });
});

describe("question-image shared-reference cleanup", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  });

  it("does not remove an upload URL still referenced by another question", async () => {
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      neq: vi.fn(() => query),
      limit: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: { id: "other-question" }, error: null })),
    };
    const admin = {
      from: vi.fn(() => query),
      storage: { from: vi.fn(() => ({ remove })) },
    };

    await cleanupReplacedQuestionUpload(admin as never, {
      nightId: NIGHT_ID,
      questionId: QUESTION_ID,
      predecessor: {
        imageUrl: `${PREFIX}/${NIGHT_ID}/${QUESTION_ID}/${VERSION_ID}.webp`,
        imageSource: "upload",
      },
      replacementUrl: null,
    });

    expect(remove).not.toHaveBeenCalled();
  });

  it("does not remove the object when the question keeps the same URL", async () => {
    const remove = vi.fn();
    const from = vi.fn();
    const admin = {
      from,
      storage: { from: vi.fn(() => ({ remove })) },
    };
    const publicUrl = `${PREFIX}/${NIGHT_ID}/${QUESTION_ID}/${VERSION_ID}.png`;

    await cleanupReplacedQuestionUpload(admin as never, {
      nightId: NIGHT_ID,
      questionId: QUESTION_ID,
      predecessor: { imageUrl: publicUrl, imageSource: "upload" },
      replacementUrl: publicUrl,
    });

    expect(from).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("fails closed when the shared-reference query fails", async () => {
    const remove = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      neq: vi.fn(() => query),
      limit: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({
        data: null,
        error: { message: "reference read failed" },
      })),
    };
    const admin = {
      from: vi.fn(() => query),
      storage: { from: vi.fn(() => ({ remove })) },
    };

    await cleanupReplacedQuestionUpload(admin as never, {
      nightId: NIGHT_ID,
      questionId: QUESTION_ID,
      predecessor: {
        imageUrl: `${PREFIX}/${NIGHT_ID}/${QUESTION_ID}/${VERSION_ID}.gif`,
        imageSource: "upload",
      },
      replacementUrl: null,
    });

    expect(remove).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/reference check/i));
  });
});
