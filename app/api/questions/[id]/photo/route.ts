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
  conflict,
  forbidden,
  notFound,
  ok,
  unauthorized,
} from "@/lib/api/responses";
import {
  cleanupReplacedQuestionUpload,
  compareAndSetQuestionImage,
  type QuestionImageUpdate,
} from "@/lib/host/question-image-storage";
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
  const { night, question } = owned;

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
  const update: QuestionImageUpdate = patch.url === undefined
    ? { image_url: null, image_attribution: null, image_source: "none" }
    : {
        image_url: patch.url,
        image_attribution: patch.attribution ?? null,
        image_source: patch.source ?? "pexels",
      };

  const predecessor = {
    imageUrl: question.image_url,
    imageSource: question.image_source,
  };
  const result = await compareAndSetQuestionImage(admin, {
    questionId,
    predecessor,
    update,
  });
  if (result.status === "error") {
    return badRequest(`failed to update photo: ${result.error}`);
  }
  if (result.status === "conflict") {
    return conflict(
      "Another image choice was saved first. Review the current image and try again.",
    );
  }

  await cleanupReplacedQuestionUpload(admin, {
    nightId: night.id,
    questionId,
    predecessor,
    replacementUrl: result.question.image_url,
  });

  return ok({ question: result.question });
}
