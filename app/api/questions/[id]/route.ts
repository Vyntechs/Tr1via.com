// PATCH /api/questions/[id]
//
// Host edits to a generated question: prompt, options, correctIndex,
// difficulty, factBlurb. Any subset is allowed. After any edit the row's
// `source` flips to 'host-edit' so we can later audit how often the host
// reaches in vs accepts AI output verbatim.
//
// Host-only.

import { type NextRequest } from "next/server";

import { requireOwnedQuestion } from "@/lib/api/auth";
import { PatchQuestionBodySchema } from "@/lib/api/schemas";
import {
  badRequest,
  forbidden,
  notFound,
  ok,
  unauthorized,
} from "@/lib/api/responses";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: questionId } = await context.params;

  const owned = await requireOwnedQuestion(questionId);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON body");
  }
  const parsed = PatchQuestionBodySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  // Cross-field check: if correctIndex is being changed without new
  // options, ensure the index is still in range (0..3 is enforced by the
  // schema — nothing else to check here).
  const patch = parsed.data;
  const admin = getSupabaseAdmin();

  const rpcPatch: Record<string, unknown> = {};
  // Only mark source as 'host-edit' when content fields change.
  // A pick-only toggle (isPicked) must not flip the source flag.
  const isContentEdit =
    patch.prompt !== undefined ||
    patch.options !== undefined ||
    patch.correctIndex !== undefined ||
    patch.difficulty !== undefined ||
    patch.factBlurb !== undefined;
  if (isContentEdit) rpcPatch.source = "host-edit";
  if (patch.prompt !== undefined) rpcPatch.prompt = patch.prompt;
  if (patch.options !== undefined)
    rpcPatch.options = patch.options as [string, string, string, string];
  if (patch.correctIndex !== undefined)
    rpcPatch.correct_index = patch.correctIndex;
  if (patch.difficulty !== undefined) rpcPatch.difficulty = patch.difficulty;
  if (patch.factBlurb !== undefined) rpcPatch.fact_blurb = patch.factBlurb;
  if (patch.isPicked !== undefined) rpcPatch.is_picked = patch.isPicked;

  // Un-picking frees the board slot. Without this an un-picked row keeps its
  // point_value and silently occupies the slot — the stale orphan that makes
  // a later save collide on the unique (category_id, point_value) index.
  if (patch.isPicked === false) rpcPatch.point_value = null;
  else if (patch.pointValue !== undefined)
    rpcPatch.point_value = patch.pointValue;

  // Content and slot state are one transaction. Besides preventing a partial
  // save, the database function locks the canonical game row; Start either
  // waits for this whole patch or wins and makes this patch fail untouched.
  const result = await (admin.rpc as unknown as (
    name: "apply_question_authoring_patch",
    args: { p_question_id: string; p_patch: Record<string, unknown> },
  ) => PromiseLike<{
    data: Record<string, unknown> | null;
    error: { code?: string; message?: string } | null;
  }>)("apply_question_authoring_patch", {
    p_question_id: questionId,
    p_patch: rpcPatch,
  });
  if (result.error || !result.data) return slotUpdateError(result.error);

  return ok({ question: result.data });
}

// A point-value collision should never reach the host as a raw Postgres
// string. Translate the unique-violation (SQLSTATE 23505 / the slot index)
// into a recoverable instruction; surface anything else as a generic save
// failure.
function slotUpdateError(error: { code?: string; message?: string } | null) {
  if (
    error?.code === "23505" ||
    error?.message?.includes("questions_category_id_point_value_key")
  ) {
    return badRequest(
      "That point value is already used in this category — pick a different value or clear the other one first.",
    );
  }
  return badRequest(`failed to update: ${error?.message ?? "unknown"}`);
}
