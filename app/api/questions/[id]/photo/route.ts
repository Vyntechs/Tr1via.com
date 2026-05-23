// PATCH /api/questions/[id]/photo
//
// Swap or clear the photo attached to a question.
//
//   { url: "...", attribution: "...", source: "pexels"|"upload" }
//     → set the photo to this URL.
//   { }
//     → CLEAR the photo. Used by the upload UI when the host removes the
//       image without immediately replacing it.
//
// Host-only.

import { type NextRequest } from "next/server";

import { requireOwnedQuestion } from "@/lib/api/auth";
import { PatchQuestionPhotoBodySchema } from "@/lib/api/schemas";
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
  const parsed = PatchQuestionPhotoBodySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);
  const patch = parsed.data;

  const admin = getSupabaseAdmin();
  const isClear = patch.url === undefined;
  const update = isClear
    ? { image_url: null, image_attribution: null, image_source: null }
    : {
        image_url: patch.url,
        image_attribution: patch.attribution ?? null,
        image_source: patch.source ?? "pexels",
      };

  const { data: updated, error } = await admin
    .from("questions")
    .update(update)
    .eq("id", questionId)
    .select("id, image_url, image_attribution, image_source")
    .single();
  if (error || !updated) {
    return badRequest(`failed to update photo: ${error?.message ?? "unknown"}`);
  }

  return ok({ question: updated });
}
