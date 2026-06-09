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
import type { QuestionInsert } from "@/lib/supabase/types";

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

  const update: Partial<QuestionInsert> = {};
  // Only mark source as 'host-edit' when content fields change.
  // A pick-only toggle (isPicked) must not flip the source flag.
  const isContentEdit =
    patch.prompt !== undefined ||
    patch.options !== undefined ||
    patch.correctIndex !== undefined ||
    patch.difficulty !== undefined ||
    patch.factBlurb !== undefined;
  if (isContentEdit) update.source = "host-edit";
  if (patch.prompt !== undefined) update.prompt = patch.prompt;
  if (patch.options !== undefined)
    update.options = patch.options as [string, string, string, string];
  if (patch.correctIndex !== undefined)
    update.correct_index = patch.correctIndex;
  if (patch.difficulty !== undefined) update.difficulty = patch.difficulty;
  if (patch.factBlurb !== undefined) update.fact_blurb = patch.factBlurb;
  if (patch.isPicked !== undefined) update.is_picked = patch.isPicked;

  // Un-picking frees the board slot. Without this an un-picked row keeps its
  // point_value and silently occupies the slot — the stale orphan that makes
  // a later save collide on the unique (category_id, point_value) index.
  if (patch.isPicked === false) update.point_value = null;
  // Clearing the slot explicitly never collides — let the main update do it.
  if (patch.pointValue === null) update.point_value = null;

  // Assigning a point value goes through the atomic swap_point_value RPC
  // (migration 0012), never the main UPDATE below. The unique index is
  // DEFERRABLE INITIALLY DEFERRED, so the vacate-then-place must happen in a
  // single transaction; the RPC also frees whatever currently holds the slot
  // (picked or not) so a stale row can't collide.
  if (patch.pointValue !== undefined && patch.pointValue !== null) {
    const { error: swapError } = await admin.rpc("swap_point_value", {
      p_question_id: questionId,
      p_point_value: patch.pointValue,
    });
    if (swapError) return slotUpdateError(swapError);
  }

  // The main UPDATE carries every field EXCEPT a non-null point_value (the
  // RPC already landed that). It may be empty when the host only re-slotted
  // a question — in that case re-read the row to return the current state.
  let updated;
  if (Object.keys(update).length > 0) {
    const result = await admin
      .from("questions")
      .update(update)
      .eq("id", questionId)
      .select("*")
      .single();
    if (result.error || !result.data) return slotUpdateError(result.error);
    updated = result.data;
  } else {
    const result = await admin
      .from("questions")
      .select("*")
      .eq("id", questionId)
      .single();
    if (result.error || !result.data) return slotUpdateError(result.error);
    updated = result.data;
  }

  return ok({ question: updated });
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
