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
  if (patch.pointValue !== undefined) {
    update.point_value = patch.pointValue as
      | 100 | 200 | 300 | 400 | 500 | 600 | 700 | null;
  }
  if (patch.isPicked !== undefined) update.is_picked = patch.isPicked;

  // Atomic swap: if this question is already PICKED and the host is
  // moving it to a slot held by ANOTHER picked question in the same
  // category, vacate the current slot, hand it to the displaced question,
  // then fall through to the main update which lands the new value.
  // Three writes, never overlapping, so the deferrable unique
  // (category_id, point_value) partial index never fires.
  if (
    patch.pointValue !== undefined &&
    patch.pointValue !== null &&
    owned.question.is_picked === true
  ) {
    const { data: occupant } = await admin
      .from("questions")
      .select("id, point_value")
      .eq("category_id", owned.question.category_id)
      .eq("is_picked", true)
      .eq("point_value", patch.pointValue)
      .neq("id", questionId)
      .maybeSingle();

    if (occupant && occupant.point_value !== null) {
      const previousValue = owned.question.point_value;
      await admin
        .from("questions")
        .update({ point_value: null })
        .eq("id", questionId);
      await admin
        .from("questions")
        .update({ point_value: previousValue })
        .eq("id", occupant.id);
      // Falls through to the main update which sets this question's
      // point_value to patch.pointValue.
    }
  }

  const { data: updated, error } = await admin
    .from("questions")
    .update(update)
    .eq("id", questionId)
    .select("*")
    .single();
  if (error || !updated) {
    return badRequest(`failed to update: ${error?.message ?? "unknown"}`);
  }

  return ok({ question: updated });
}
