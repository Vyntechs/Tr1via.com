// GET /api/questions/[id]/photos: which words the library is searched with.
//
// The swap screen's 12 library photos must match the question as it reads
// now. Claude's stored photo words are only trusted on an unedited question,
// and if they find nothing the route tries the question's own words once.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.hoisted(() => ({ requireOwnedQuestion: vi.fn() }));
const searchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/pexels/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pexels/search")>()),
  searchPexels: searchMock,
}));

import { GET } from "@/app/api/questions/[id]/photos/route";
import { PexelsRateLimitError } from "@/lib/pexels/search";

const QUESTION_ID = "11111111-1111-4111-8111-111111111111";
const PROMPT = "Which saint is the patron of animals?";
const PROMPT_WORDS = "saint patron animals";
const STORED = "st francis of assisi animals";

function photo(id: number) {
  return { id, src: { large: `https://images.pexels.com/photos/${id}.jpeg` }, photographer: "P" };
}

function question(over: Record<string, unknown> = {}) {
  return { id: QUESTION_ID, prompt: PROMPT, photo_query: STORED, source: "ai", ...over };
}

async function call() {
  const res = await GET(new NextRequest(`http://localhost/api/questions/${QUESTION_ID}/photos`), {
    params: Promise.resolve({ id: QUESTION_ID }),
  });
  return { status: res.status, body: (await res.json()) as { query?: string; photos?: unknown[] } };
}

function searchedWith(): string[] {
  return searchMock.mock.calls.map(([q]) => q as string);
}

describe("GET /api/questions/[id]/photos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchMock.mockReset();
    authMock.requireOwnedQuestion.mockResolvedValue({ ok: true, question: question() });
    searchMock.mockResolvedValue([photo(1), photo(2)]);
  });

  it("searches with Claude's stored words on an unedited question", async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(searchedWith()).toEqual([STORED]);
    expect(body.query).toBe(STORED);
    expect(body.photos).toHaveLength(2);
  });

  it("searches with the current question words after the host rewrote it", async () => {
    authMock.requireOwnedQuestion.mockResolvedValue({
      ok: true,
      question: question({ prompt: "Which saint is the patron of sailors?", source: "host-edit" }),
    });
    const { body } = await call();
    expect(searchedWith()).toEqual(["saint patron sailors"]);
    expect(body.query).toBe("saint patron sailors");
  });

  it("tries the question's own words once when the stored words find nothing", async () => {
    searchMock.mockResolvedValueOnce([]).mockResolvedValueOnce([photo(7)]);
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(searchedWith()).toEqual([STORED, PROMPT_WORDS]);
    expect(body.query).toBe(PROMPT_WORDS);
    expect(body.photos).toHaveLength(1);
  });

  it("does not search twice when the question's own words already found nothing", async () => {
    authMock.requireOwnedQuestion.mockResolvedValue({
      ok: true,
      question: question({ photo_query: null }),
    });
    searchMock.mockResolvedValue([]);
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(searchedWith()).toEqual([PROMPT_WORDS]);
    expect(body.photos).toEqual([]);
  });

  it("skips the second search when the first was slow, so the screen is not kept waiting", async () => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    searchMock.mockImplementationOnce(async () => {
      now += 5_000;
      return [];
    });
    const { status, body } = await call();
    clock.mockRestore();
    expect(status).toBe(200);
    expect(searchedWith()).toEqual([STORED]);
    expect(body.photos).toEqual([]);
  });

  it("answers 503 on a Pexels rate limit without a second search", async () => {
    searchMock.mockRejectedValueOnce(new PexelsRateLimitError("Pexels search failed: 429"));
    const { status } = await call();
    expect(status).toBe(503);
    expect(searchMock).toHaveBeenCalledTimes(1);
  });
});
