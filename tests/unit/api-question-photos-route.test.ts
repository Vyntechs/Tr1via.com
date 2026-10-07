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

function owned(question: { prompt: string; photo_query: string | null }) {
  authMock.requireOwnedQuestion.mockResolvedValue({
    ok: true,
    question: { id: QUESTION_ID, ...question },
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
    owned({
      prompt: "Which U.S. state has more tidal coastline than all the others combined?",
      photo_query: "alaska coastline aerial",
    });

    const res = await callGet();

    expect(pexelsMock.searchPexels).toHaveBeenCalledTimes(1);
    expect(pexelsMock.searchPexels).toHaveBeenCalledWith("alaska coastline aerial", 12);
    expect(await res.json()).toMatchObject({ query: "alaska coastline aerial" });
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
