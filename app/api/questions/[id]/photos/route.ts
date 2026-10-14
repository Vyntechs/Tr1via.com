// GET /api/questions/[id]/photos
//
// Returns up to 12 alternative Pexels photos for the swap UI. The query:
//   * The `photo_query` Claude wrote for this question when it was made
//     (stored on the row), but only while the question is unedited
//     (source 'ai'). It is the search that found the auto-matched photo,
//     so the alternatives match the same subject.
//   * Otherwise (edited, hand-written or older questions), a 2-4 word
//     slice of the prompt as it reads now. An edit may have changed the
//     subject, and the stored words would then find the old one.
//   * If the stored words find nothing, one more search with the prompt
//     words, so "Try again" is not stuck repeating an empty search.
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
import { choosePhotoQuery, fallbackPhotoQuery } from "@/lib/pexels/photo-query";
import { PexelsRateLimitError, searchPexels } from "@/lib/pexels/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The host's screen stops waiting for this lookup after 8 seconds. The
// second search only starts when the first came back quickly, so the two
// together stay well inside that on a normal day.
const FALLBACK_SEARCH_BUDGET_MS = 3_000;

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

  const chosen = choosePhotoQuery(question);
  try {
    const startedAt = Date.now();
    let query = chosen.query;
    let photos = await searchPexels(query, 12);
    if (photos.length === 0 && chosen.fromStored) {
      const fallback = fallbackPhotoQuery(question, query);
      if (fallback && Date.now() - startedAt < FALLBACK_SEARCH_BUDGET_MS) {
        query = fallback;
        photos = await searchPexels(fallback, 12);
      }
    }
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
