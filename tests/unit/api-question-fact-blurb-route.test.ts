// Route handler test — POST /api/questions/[id]/fact-blurb.
//
// Called automatically right after the host saves an edit that changed what
// the question asks. Contract: the stored fun fact ends up matching the
// question, or it ends up EMPTY. It must never be left holding the previous
// question's fact — that is issue #173, and it happened live on 2026-07-29.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({ requireOwnedQuestion: vi.fn() }));
const aiMock = vi.hoisted(() => ({ generateFactBlurb: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/ai/generate-fact-blurb", () => aiMock);

const QUESTION_ID = "11111111-1111-1111-1111-111111111111";
const CATEGORY_ID = "22222222-2222-2222-2222-222222222222";

function makeCtx() {
  return { params: Promise.resolve({ id: QUESTION_ID }) };
}
function makeRequest() {
  return new NextRequest(`http://test/api/questions/${QUESTION_ID}/fact-blurb`, {
    method: "POST",
  });
}

function makeSupa() {
  const rpc = vi.fn().mockResolvedValue({
    data: { id: QUESTION_ID, category_id: CATEGORY_ID },
    error: null,
  });
  return { supaClient: { rpc }, rpc };
}

beforeEach(() => {
  vi.resetAllMocks();
  authMock.requireOwnedQuestion.mockResolvedValue({
    ok: true,
    question: {
      id: QUESTION_ID,
      category_id: CATEGORY_ID,
      prompt: "The square root of 900 is:",
      options: ["25", "30", "40", "35"],
      correct_index: 1,
      fact_blurb: "5² + 12² = 169 — the classic Pythagorean triple.",
    },
  });
});

describe("POST /api/questions/[id]/fact-blurb", () => {
  it("writes a rewritten fact through the fenced authoring RPC", async () => {
    const { supaClient, rpc } = makeSupa();
    adminMock.getSupabaseAdmin.mockReturnValue(supaClient);
    aiMock.generateFactBlurb.mockResolvedValue("30 x 30 = 900.");
    const { POST } = await import("@/app/api/questions/[id]/fact-blurb/route");

    const res = await POST(makeRequest(), makeCtx());

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("apply_question_authoring_patch", {
      p_question_id: QUESTION_ID,
      p_patch: { fact_blurb: "30 x 30 = 900." },
    });
  });

  it("generates from the question's CURRENT text and marked answer", async () => {
    const { supaClient } = makeSupa();
    adminMock.getSupabaseAdmin.mockReturnValue(supaClient);
    aiMock.generateFactBlurb.mockResolvedValue("30 x 30 = 900.");
    const { POST } = await import("@/app/api/questions/[id]/fact-blurb/route");

    await POST(makeRequest(), makeCtx());

    expect(aiMock.generateFactBlurb).toHaveBeenCalledWith({
      prompt: "The square root of 900 is:",
      options: ["25", "30", "40", "35"],
      correctIndex: 1,
    });
  });

  it("CLEARS the fact when Claude returns nothing usable — silence beats a wrong fact", async () => {
    const { supaClient, rpc } = makeSupa();
    adminMock.getSupabaseAdmin.mockReturnValue(supaClient);
    aiMock.generateFactBlurb.mockResolvedValue(null);
    const { POST } = await import("@/app/api/questions/[id]/fact-blurb/route");

    const res = await POST(makeRequest(), makeCtx());

    expect(res.status).toBe(200);
    // The key must be present and null. Leaving the stale blurb in place is
    // the exact failure this route exists to prevent.
    const patch = rpc.mock.calls[0]![1].p_patch as Record<string, unknown>;
    expect("fact_blurb" in patch).toBe(true);
    expect(patch.fact_blurb).toBeNull();
  });

  it("surfaces a generation failure instead of writing anything", async () => {
    const { supaClient, rpc } = makeSupa();
    adminMock.getSupabaseAdmin.mockReturnValue(supaClient);
    aiMock.generateFactBlurb.mockRejectedValue(new Error("rate limited"));
    const { POST } = await import("@/app/api/questions/[id]/fact-blurb/route");

    const res = await POST(makeRequest(), makeCtx());

    expect(res.status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses when the host does not own the question", async () => {
    authMock.requireOwnedQuestion.mockResolvedValue({
      ok: false,
      status: 403,
      error: "not yours",
    });
    const { POST } = await import("@/app/api/questions/[id]/fact-blurb/route");

    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(403);
    expect(aiMock.generateFactBlurb).not.toHaveBeenCalled();
  });
});
