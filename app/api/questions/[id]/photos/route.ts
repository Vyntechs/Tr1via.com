// GET /api/questions/[id]/photos
//
// Returns up to 12 alternative Pexels photos for the swap UI. The query
// is re-derived from the question:
//   * Prefer the `photoQuery` Claude originally generated (we don't have
//     it stored, so we fall back to a 2-4 word slice of the prompt).
//   * In practice the original `photoQuery` is embedded in the existing
//     image_url's referer for Pexels-sourced images, but Pexels doesn't
//     give us a clean way to recover it; the prompt-derived query is
//     adequate for the "show me more" use case.
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
  const { question } = owned;

  const query = derivePhotoQuery(question.prompt);
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

/**
 * Best-effort query derivation. Picks the first 3 meaningful words of the
 * prompt — drops stopwords and the question mark. NOT a perfect inverse
 * of Claude's original photoQuery, but adequate for "show me 12 more."
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
