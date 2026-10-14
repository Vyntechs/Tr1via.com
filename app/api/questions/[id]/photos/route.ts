// GET /api/questions/[id]/photos
//
// Returns up to 12 alternative Pexels photos for the swap UI. The query:
//   * The `photo_query` Claude wrote for this question when it was made
//     (stored on the row). It is the search that found the auto-matched
//     photo, so the alternatives match the same subject.
//   * If that is empty (hand-written or older questions), a 2-4 word
//     slice of the prompt.
//
// Host-only. Errors:
//   503 → Pexels rate-limited or unreachable.
//   500 → unexpected failure.

import { type NextRequest, NextResponse } from "next/server";

import { requireOwnedQuestion } from "@/lib/api/auth";
import {
  forbidden,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "@/lib/api/responses";
import { choosePhotoQuery } from "@/lib/pexels/photo-query";
import { PexelsRateLimitError, searchPexels } from "@/lib/pexels/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: questionId } = await context.params;

  const owned = await requireOwnedQuestion(questionId);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }
  const { question } = owned;

  const query = choosePhotoQuery(question.photo_query, question.prompt);
  try {
    const photos = await searchPexels(query, 12);
    return ok({ query, photos });
  } catch (err) {
    if (err instanceof PexelsRateLimitError) {
      return NextResponse.json(
        { error: "Pexels rate-limited, try again shortly" },
        { status: 503 },
      );
    }
    return serverError(
      `photo search failed: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }
}
