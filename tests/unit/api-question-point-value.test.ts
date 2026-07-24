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
