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

  const update: Partial<QuestionInsert> = { source: "host-edit" };
  if (patch.prompt !== undefined) update.prompt = patch.prompt;
  if (patch.options !== undefined)
    update.options = patch.options as [string, string, string, string];
  if (patch.correctIndex !== undefined)
    update.correct_index = patch.correctIndex;
  if (patch.difficulty !== undefined) update.difficulty = patch.difficulty;
  if (patch.factBlurb !== undefined) update.fact_blurb = patch.factBlurb;

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
