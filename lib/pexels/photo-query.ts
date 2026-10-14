// Search words for the swap screen's library photos (GET
// /api/questions/[id]/photos). Kept out of the route file because a
// Next.js route may only export its handlers and config.

export interface PhotoQueryQuestion {
  prompt: string;
  /** Claude's photo search words, saved when the question was generated. */
  photo_query?: string | null;
  /** 'ai' until the host saves an edit, then 'host-edit'. */
  source?: string | null;
}

/**
 * Which words to search the library with.
 *
 * Claude's stored words are used only while the question is still exactly
 * as generated (source 'ai'). Any saved edit flips source to 'host-edit',
 * and the edit may have rewritten the question, so then the words come from
 * the question as it reads now. Nothing stored (older or hand-written
 * questions) also falls back to the question's own words.
 */
export function choosePhotoQuery(question: PhotoQueryQuestion): {
  query: string;
  fromStored: boolean;
} {
  const stored = question.photo_query?.trim();
  if (stored && question.source === "ai") {
    return { query: stored.slice(0, 100), fromStored: true };
  }
  return { query: derivePhotoQuery(question.prompt), fromStored: false };
}

/**
 * Second try when the stored words found nothing: the question's own words,
 * or null when they are the same search (repeating it cannot help).
 */
export function fallbackPhotoQuery(
  question: PhotoQueryQuestion,
  triedQuery: string,
): string | null {
  const fallback = derivePhotoQuery(question.prompt);
  const same =
    fallback.trim().toLowerCase() === triedQuery.trim().toLowerCase();
  return fallback.trim() && !same ? fallback : null;
}

/**
 * Best-effort query derivation. Picks the first 3 meaningful words of the
 * prompt — drops stopwords and the question mark. NOT a perfect inverse
 * of Claude's original photoQuery, but adequate for "show me 12 more."
 */
export function derivePhotoQuery(prompt: string): string {
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
