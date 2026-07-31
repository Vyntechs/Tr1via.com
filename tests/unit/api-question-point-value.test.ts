// Route handler test — PATCH /api/questions/[id], point-value slotting.
//
// the first host's bug: saving a question into an already-used point-value slot
// threw the raw Postgres unique-constraint error. The fix routes every
// point-value assignment through the atomic `swap_point_value` RPC (which
// vacates whatever holds the slot, picked or not), clears the slot when a
// question is un-picked, and translates a slot collision into a host-
// readable message instead of leaking the constraint name.
//
// Mocks the admin client + auth helper at module boundaries.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({ requireOwnedQuestion: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);

const QUESTION_ID = "11111111-1111-1111-1111-111111111111";
const CATEGORY_ID = "22222222-2222-2222-2222-222222222222";

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

/**
 * Chainable admin mock that records the RPC call and the UPDATE payload.
 * - `.rpc(name, args)` resolves to `rpcResult` (default success).
 * - `.from().update(payload).eq().select().single()` resolves a fake row.
 * - `.from().select().eq().single()` (empty-update refetch) resolves it too.
 */
function makeSupa(
  rpcResult: { data: Record<string, unknown> | null; error: unknown } = {
    data: {
      id: QUESTION_ID,
      category_id: CATEGORY_ID,
      point_value: 200,
    },
    error: null,
  },
) {
  const calls = {
    rpc: vi.fn().mockResolvedValue(rpcResult),
    updatePayload: undefined as Record<string, unknown> | undefined,
  };

  const singleFn = vi.fn().mockResolvedValue({
    data: { id: QUESTION_ID, category_id: CATEGORY_ID, point_value: 200 },
    error: null,
  });
  const updateFn = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
    calls.updatePayload = payload;
    return supaClient;
  });

  const supaClient = {
    rpc: calls.rpc,
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    update: updateFn,
    eq: vi.fn().mockReturnThis(),
    single: singleFn,
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  return { supaClient, calls };
}

beforeEach(() => {
  vi.resetAllMocks();
  authMock.requireOwnedQuestion.mockResolvedValue({
    ok: true,
    question: {
      id: QUESTION_ID,
      category_id: CATEGORY_ID,
      is_picked: false,
      point_value: null,
    },
  });
});

describe("PATCH /api/questions/[id] — point-value slotting", () => {
  it("saves content and point placement through one atomic authoring RPC", async () => {
    const { supaClient, calls } = makeSupa();
    adminMock.getSupabaseAdmin.mockReturnValue(supaClient);
    const { PATCH } = await import("@/app/api/questions/[id]/route");

    const res = await PATCH(
      makeRequest({
        prompt: "Which aircraft first broke the sound barrier?",
        options: ["Bell X-1", "F-86 Sabre", "P-80", "D-558"],
        correctIndex: 0,
        pointValue: 200,
      }),
      makeCtx(),
    );

    expect(res.status).toBe(200);
    expect(calls.rpc).toHaveBeenCalledTimes(1);
    expect(calls.rpc).toHaveBeenCalledWith("apply_question_authoring_patch", {
      p_question_id: QUESTION_ID,
      p_patch: {
        prompt: "Which aircraft first broke the sound barrier?",
        options: ["Bell X-1", "F-86 Sabre", "P-80", "D-558"],
        correct_index: 0,
        point_value: 200,
        source: "host-edit",
      },
    });
    expect(supaClient.from).not.toHaveBeenCalled();
  });

  it("translates a unique-slot violation into a host-readable message (never the raw constraint)", async () => {
    const { supaClient } = makeSupa({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "questions_category_id_point_value_key"',
      },
    });
    adminMock.getSupabaseAdmin.mockReturnValue(supaClient);
    const { PATCH } = await import("@/app/api/questions/[id]/route");

    const res = await PATCH(
      makeRequest({ pointValue: 200 }),
      makeCtx(),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/already used in this category/i);
    expect(body.error).not.toMatch(/duplicate key|constraint|questions_category_id/i);
  });

  it("clears point_value when a question is un-picked (no stale orphan slot)", async () => {
    const { supaClient, calls } = makeSupa();
    adminMock.getSupabaseAdmin.mockReturnValue(supaClient);
    const { PATCH } = await import("@/app/api/questions/[id]/route");

    const res = await PATCH(makeRequest({ isPicked: false }), makeCtx());

    expect(res.status).toBe(200);
    expect(calls.rpc).toHaveBeenCalledWith("apply_question_authoring_patch", {
      p_question_id: QUESTION_ID,
      p_patch: {
        is_picked: false,
        point_value: null,
      },
    });
  });

  it("routes a content-only edit through the fenced authoring RPC", async () => {
    const { supaClient, calls } = makeSupa();
    adminMock.getSupabaseAdmin.mockReturnValue(supaClient);
    const { PATCH } = await import("@/app/api/questions/[id]/route");

    const res = await PATCH(
      makeRequest({ prompt: "A sufficiently long replacement prompt." }),
      makeCtx(),
    );

    expect(res.status).toBe(200);
    expect(calls.rpc).toHaveBeenCalledWith("apply_question_authoring_patch", {
      p_question_id: QUESTION_ID,
      p_patch: {
        prompt: "A sufficiently long replacement prompt.",
        source: "host-edit",
      },
    });
  });
});

// Issue #173. The edit panel never sent factBlurb, so a rewritten question kept
// the previous occupant's fun fact and the host read it aloud as fact. The
// route always accepted the field; these pin the contract the UI now relies on
// — in particular that `null` CLEARS, because an empty box has to mean "say
// nothing" rather than "leave the wrong one there".
describe("PATCH /api/questions/[id] — fun fact (fact_blurb)", () => {
  it("forwards an edited blurb alongside the rewritten question", async () => {
    const { supaClient, calls } = makeSupa();
    adminMock.getSupabaseAdmin.mockReturnValue(supaClient);
    const { PATCH } = await import("@/app/api/questions/[id]/route");

    const res = await PATCH(
      makeRequest({
        prompt: "The square root of 900 is:",
        factBlurb: "30 x 30 = 900.",
      }),
      makeCtx(),
    );

    expect(res.status).toBe(200);
    expect(calls.rpc).toHaveBeenCalledWith("apply_question_authoring_patch", {
      p_question_id: QUESTION_ID,
      p_patch: {
        prompt: "The square root of 900 is:",
        fact_blurb: "30 x 30 = 900.",
        source: "host-edit",
      },
    });
  });

  it("clears the blurb when sent null — an empty box must not leave a stale fact", async () => {
    const { supaClient, calls } = makeSupa();
    adminMock.getSupabaseAdmin.mockReturnValue(supaClient);
    const { PATCH } = await import("@/app/api/questions/[id]/route");

    const res = await PATCH(makeRequest({ factBlurb: null }), makeCtx());

    expect(res.status).toBe(200);
    // The key must be PRESENT and null. Omitting it is what caused the bug:
    // the RPC only overwrites fact_blurb when the key exists in the patch.
    const patch = calls.rpc.mock.calls[0]![1].p_patch as Record<string, unknown>;
    expect("fact_blurb" in patch).toBe(true);
    expect(patch.fact_blurb).toBeNull();
  });

  it("rejects a blurb past the 280-char cap rather than truncating it", async () => {
    const { supaClient, calls } = makeSupa();
    adminMock.getSupabaseAdmin.mockReturnValue(supaClient);
    const { PATCH } = await import("@/app/api/questions/[id]/route");

    const res = await PATCH(makeRequest({ factBlurb: "x".repeat(281) }), makeCtx());

    expect(res.status).toBe(400);
    expect(calls.rpc).not.toHaveBeenCalled();
  });

  it("leaves the blurb untouched when the host edits only the prompt", async () => {
    const { supaClient, calls } = makeSupa();
    adminMock.getSupabaseAdmin.mockReturnValue(supaClient);
    const { PATCH } = await import("@/app/api/questions/[id]/route");

    await PATCH(makeRequest({ prompt: "A sufficiently long replacement prompt." }), makeCtx());

    const patch = calls.rpc.mock.calls[0]![1].p_patch as Record<string, unknown>;
    expect("fact_blurb" in patch).toBe(false);
  });
});
