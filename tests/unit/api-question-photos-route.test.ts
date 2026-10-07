import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Everything outside the route is mocked: no Pexels calls, no database.
const authMock = vi.hoisted(() => ({ requireOwnedQuestion: vi.fn() }));
const pexelsMock = vi.hoisted(() => {
  class PexelsRateLimitError extends Error {}
  return { searchPexels: vi.fn(), PexelsRateLimitError };
});

vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/pexels/search", () => pexelsMock);

import { GET } from "@/app/api/questions/[id]/photos/route";

const QUESTION_ID = "11111111-1111-4111-8111-111111111111";

const TOPIC = "Alaska Travel";
const PHOTO = { id: 1, src: { large: "https://img.test/1.jpg" }, photographer: "Pat" };

function owned(question: { prompt: string; photo_query: string | null }) {
  authMock.requireOwnedQuestion.mockResolvedValue({
    ok: true,
    question: { id: QUESTION_ID, ...question },
    category: { id: "cat-1", topic: TOPIC },
  });
}

async function callGet() {
  return GET(new NextRequest(`http://localhost/api/questions/${QUESTION_ID}/photos`), {
    params: Promise.resolve({ id: QUESTION_ID }),
  });
}

describe("GET /api/questions/[id]/photos search words", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pexelsMock.searchPexels.mockResolvedValue([]);
  });

  it("searches with the saved photo_query, not words from the question", async () => {
    pexelsMock.searchPexels.mockResolvedValue([PHOTO]);
    owned({
      prompt: "Which U.S. state has more tidal coastline than all the others combined?",
      photo_query: "alaska coastline aerial",
    });

    const res = await callGet();

    expect(pexelsMock.searchPexels).toHaveBeenCalledTimes(1);
    expect(pexelsMock.searchPexels).toHaveBeenCalledWith("alaska coastline aerial", 12);
    expect(await res.json()).toMatchObject({
      query: "alaska coastline aerial",
      photos: [PHOTO],
    });
  });

  it("tries the first 3 question words when the saved query finds nothing", async () => {
    owned({
      prompt: "Which U.S. state has more tidal coastline than all the others combined?",
      photo_query: "alaska coastline aerial",
    });
    pexelsMock.searchPexels
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([PHOTO]);

    const res = await callGet();

    expect(pexelsMock.searchPexels).toHaveBeenCalledTimes(2);
    expect(pexelsMock.searchPexels).toHaveBeenNthCalledWith(1, "alaska coastline aerial", 12);
    expect(pexelsMock.searchPexels).toHaveBeenNthCalledWith(2, "state has more", 12);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ query: "state has more", photos: [PHOTO] });
  });

  it("then tries the category topic, and stops at the first search that finds photos", async () => {
    owned({
      prompt: "Which U.S. state has more tidal coastline than all the others combined?",
      photo_query: "alaska coastline aerial",
    });
    pexelsMock.searchPexels
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([PHOTO]);

    const res = await callGet();

    expect(pexelsMock.searchPexels).toHaveBeenCalledTimes(3);
    expect(pexelsMock.searchPexels).toHaveBeenNthCalledWith(3, TOPIC, 12);
    expect(await res.json()).toMatchObject({ query: TOPIC, photos: [PHOTO] });
  });

  it("answers an empty list (the usual no-matches message) when every search is empty", async () => {
    owned({
      prompt: "Which U.S. state has more tidal coastline than all the others combined?",
      photo_query: "alaska coastline aerial",
    });

    const res = await callGet();

    expect(pexelsMock.searchPexels).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ photos: [] });
  });

  it("does not repeat a search it already made", async () => {
    // The topic matches the saved words apart from case and spacing at the ends.
    authMock.requireOwnedQuestion.mockResolvedValue({
      ok: true,
      question: { id: QUESTION_ID, prompt: "Any question here?", photo_query: " ALASKA travel " },
      category: { id: "cat-1", topic: "alaska TRAVEL" },
    });

    await callGet();

    expect(pexelsMock.searchPexels.mock.calls.map(([query]) => query)).toEqual([
      "ALASKA travel",
      "Any question here",
    ]);
  });

  it("trims the saved photo_query", async () => {
    owned({ prompt: "Any question here?", photo_query: "  vintage record player \n" });

    await callGet();

    expect(pexelsMock.searchPexels).toHaveBeenCalledWith("vintage record player", 12);
  });

  it.each([
    ["null", null],
    ["an empty string", ""],
    ["only spaces", "   "],
  ])("falls back to the first 3 meaningful question words when photo_query is %s", async (_label, saved) => {
    owned({
      prompt: "Which U.S. state has more tidal coastline than all the others combined?",
      photo_query: saved,
    });

    await callGet();

    expect(pexelsMock.searchPexels).toHaveBeenCalledWith("state has more", 12);
  });

  it("still answers 503 when Pexels is rate limited on a fallback search", async () => {
    owned({ prompt: "Any question here?", photo_query: "alaska coastline aerial" });
    pexelsMock.searchPexels
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new pexelsMock.PexelsRateLimitError("slow down"));

    const res = await callGet();

    expect(res.status).toBe(503);
  });

  it("still answers 503 when Pexels is rate limited", async () => {
    owned({ prompt: "Any question here?", photo_query: "alaska coastline aerial" });
    pexelsMock.searchPexels.mockRejectedValue(new pexelsMock.PexelsRateLimitError("slow down"));

    const res = await callGet();

    expect(res.status).toBe(503);
  });

  it("does not search at all when the host does not own the question", async () => {
    authMock.requireOwnedQuestion.mockResolvedValue({ ok: false, status: 403, error: "forbidden" });

    const res = await callGet();

    expect(res.status).toBe(403);
    expect(pexelsMock.searchPexels).not.toHaveBeenCalled();
  });
});
