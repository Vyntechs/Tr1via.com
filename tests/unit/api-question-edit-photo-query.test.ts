// Route handler test — PATCH /api/questions/[id], saved photo search words.
//
// A question's `photo_query` is what the Image button searches with first. If
// the host rewrites the question, those words describe the OLD question, so
// they must be cleared (the Image button then falls back to the new text). An
// edit that leaves the question text alone must not touch them.
//
// Mocks the admin client + auth helper at module boundaries (no real database).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({ requireOwnedQuestion: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);

const QUESTION_ID = "11111111-1111-1111-1111-111111111111";
const CATEGORY_ID = "22222222-2222-2222-2222-222222222222";
const OLD_PROMPT = "Which state has the longest coastline?";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://test/api/questions/${QUESTION_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeCtx() {
  return { params: Promise.resolve({ id: QUESTION_ID }) };
}

function makeSupa(clearResult: { error: { message: string } | null } = { error: null }) {
  const eq = vi.fn().mockResolvedValue(clearResult);
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  const rpc = vi.fn().mockResolvedValue({
    data: { id: QUESTION_ID, category_id: CATEGORY_ID, photo_query: "alaska coastline aerial" },
    error: null,
  });
  return { client: { rpc, from }, rpc, from, update, eq };
}

function ownedQuestion(photoQuery: string | null) {
  authMock.requireOwnedQuestion.mockResolvedValue({
    ok: true,
    question: {
      id: QUESTION_ID,
      category_id: CATEGORY_ID,
      prompt: OLD_PROMPT,
      photo_query: photoQuery,
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("PATCH /api/questions/[id] — saved photo search words", () => {
  it("clears the saved words when the question text changes", async () => {
    ownedQuestion("alaska coastline aerial");
    const supa = makeSupa();
    adminMock.getSupabaseAdmin.mockReturnValue(supa.client);
    const { PATCH } = await import("@/app/api/questions/[id]/route");

    const res = await PATCH(
      makeRequest({ prompt: "Which state has the most active volcanoes?" }),
      makeCtx(),
    );

    expect(res.status).toBe(200);
    expect(supa.from).toHaveBeenCalledWith("questions");
    expect(supa.update).toHaveBeenCalledWith({ photo_query: null });
    expect(supa.eq).toHaveBeenCalledWith("id", QUESTION_ID);
    const body = await res.json();
    expect(body.question.photo_query).toBeNull();
  });

  it("leaves the saved words alone when the edit does not touch the question text", async () => {
    ownedQuestion("alaska coastline aerial");
    const supa = makeSupa();
    adminMock.getSupabaseAdmin.mockReturnValue(supa.client);
    const { PATCH } = await import("@/app/api/questions/[id]/route");

    const res = await PATCH(makeRequest({ difficulty: 2, factBlurb: "A new fact." }), makeCtx());

    expect(res.status).toBe(200);
    expect(supa.rpc).toHaveBeenCalledTimes(1);
    expect(supa.from).not.toHaveBeenCalled();
    expect(supa.update).not.toHaveBeenCalled();
  });

  it("leaves the saved words alone when the same question text is sent again", async () => {
    ownedQuestion("alaska coastline aerial");
    const supa = makeSupa();
    adminMock.getSupabaseAdmin.mockReturnValue(supa.client);
    const { PATCH } = await import("@/app/api/questions/[id]/route");

    const res = await PATCH(
      makeRequest({ prompt: OLD_PROMPT, options: ["Alaska", "Maine", "Florida", "Texas"] }),
      makeCtx(),
    );

    expect(res.status).toBe(200);
    expect(supa.update).not.toHaveBeenCalled();
  });

  it("does not write anything extra when the question had no saved words", async () => {
    ownedQuestion(null);
    const supa = makeSupa();
    adminMock.getSupabaseAdmin.mockReturnValue(supa.client);
    const { PATCH } = await import("@/app/api/questions/[id]/route");

    const res = await PATCH(makeRequest({ prompt: "A brand new question?" }), makeCtx());

    expect(res.status).toBe(200);
    expect(supa.update).not.toHaveBeenCalled();
  });

  it("still saves the host's edit if clearing the saved words fails", async () => {
    ownedQuestion("alaska coastline aerial");
    const supa = makeSupa({ error: { message: "boom" } });
    adminMock.getSupabaseAdmin.mockReturnValue(supa.client);
    const { PATCH } = await import("@/app/api/questions/[id]/route");

    const res = await PATCH(makeRequest({ prompt: "A brand new question?" }), makeCtx());

    expect(res.status).toBe(200);
    expect(supa.update).toHaveBeenCalledWith({ photo_query: null });
  });
});
