// GET /api/questions/[id]/photos
//
// Returns up to 12 alternative Pexels photos for the swap UI. The search uses
// the `photo_query` Claude wrote for the question and we saved with it (the
// same words the first photo was found with). If that finds nothing, or the
// question has no saved query (older rows), it tries a 3-word slice of the
// question text, then the category topic, so the host is not left with an
// empty list when a broader search would have found photos.
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
  const { question, category } = owned;

  // Same order the first auto-attached photo used (saved words, then topic),
  // with the old 3-word guess between them. Blank and repeated queries skipped.
  const queries: string[] = [];
  for (const candidate of [
    question.photo_query,
    derivePhotoQuery(question.prompt),
    category.topic,
  ]) {
    const trimmed = candidate?.trim();
    if (!trimmed) continue;
    if (queries.some((seen) => seen.toLowerCase() === trimmed.toLowerCase())) continue;
    queries.push(trimmed);
  }

  try {
    let query = queries[0] ?? "";
    for (const candidate of queries) {
      query = candidate;
      const photos = await searchPexels(candidate, 12);
      if (photos.length > 0) return ok({ query, photos });
    }
    // Nothing matched any of them: the host sees the usual "no matches" message.
    return ok({ query, photos: [] });
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

/**
 * Fallback for questions with no saved `photo_query` (older rows, hand-written
 * questions). Picks the first 3 meaningful words of the prompt — drops
 * stopwords and the question mark. Only a rough guess at what to search for.
 */
function derivePhotoQuery(prompt: string): string {
  const STOPWORDS = new Set([
    "the",
    "a",
    "an",
    "of",
    "and",
    "or",
    "is",
    "are",
    "was",
    "were",
    "which",
    "what",
    "who",
    "where",
    "when",
    "why",
    "how",
    "to",
    "in",
    "on",
    "for",
    "with",
    "by",
    "this",
    "that",
    "these",
    "those",
    "his",
    "her",
    "their",
    "its",
  ]);
  const words = prompt
    .replace(/[?.,!:;"'()\[\]]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()));
  return words.slice(0, 3).join(" ") || prompt.slice(0, 40);
}
