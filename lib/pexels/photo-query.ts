// Search words for the swap screen's library photos (GET
// /api/questions/[id]/photos). Kept out of the route file because a
// Next.js route may only export its handlers and config.

/** The stored search words when there are any, else words from the prompt. */
export function choosePhotoQuery(
  storedQuery: string | null | undefined,
  prompt: string,
): string {
  const stored = storedQuery?.trim();
  return stored ? stored.slice(0, 100) : derivePhotoQuery(prompt);
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
