// Pexels API client for TR1VIA.
//
// The Pexels free tier allows 200 requests/hour and 20,000/month. Each
// question generation can fan out up to ~20 requests (one per generated
// question) — a busy host could realistically burn through 10 categories
// in a setup session = ~200 requests, so the rate limit matters.
//
// Rate-limit handling:
//   * Pexels returns 429 with X-Ratelimit-* headers when over budget.
//   * We translate any non-2xx (and any "error" key in the response body)
//     into a PexelsRateLimitError so callers can surface a clean 503 to
//     the host UI ("Pexels is being slow — try again in a moment").
//
// Privacy / safety:
//   * The query Claude generates should never contain the literal correct
//     answer (enforced in the prompt). The URL with the query is logged
//     by Pexels' edge.
//   * We do not log the API key. Ever.

import "server-only";

import { createClient, type Photo, type PhotosWithTotalResults } from "pexels";

export interface PexelsPhoto {
  id: number;
  /** Page URL on pexels.com — used for attribution link-out. */
  url: string;
  src: {
    medium: string;
    large: string;
    large2x: string;
    original: string;
  };
  photographer: string;
  photographer_url: string;
  /** Pexels' own alt text. May be empty string if the photographer didn't set one. */
  alt: string;
}

/**
 * Thrown when Pexels rejects the request — rate limit, auth failure, etc.
 * Callers can `instanceof` this to map to a 503 response.
 */
export class PexelsRateLimitError extends Error {
  readonly code = "pexels_rate_limited";
  constructor(message: string) {
    super(message);
    this.name = "PexelsRateLimitError";
  }
}

const DEFAULT_PER_PAGE = 12;
const MAX_PER_PAGE = 12;

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing env: ${name} — set in .env.local before searching Pexels`,
    );
  }
  return v;
}

// Lazy singleton — avoids creating the client at module import time so
// unit tests that don't touch Pexels don't need the env var set.
type PexelsClient = ReturnType<typeof createClient>;
let _client: PexelsClient | undefined;
function getClient(): PexelsClient {
  if (!_client) {
    _client = createClient(getEnv("PEXELS_API_KEY"));
  }
  return _client;
}

/**
 * Search Pexels for `query` and return up to `perPage` (default 12,
 * capped at 12 — the design's "Twelve more" UI shows 12 alternatives).
 *
 * Returns [] if Pexels has no results for the query (a normal,
 * non-error outcome). Throws PexelsRateLimitError on 429/5xx — the
 * caller should map this to a 503.
 */
export async function searchPexels(
  query: string,
  perPage: number = DEFAULT_PER_PAGE,
): Promise<PexelsPhoto[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }
  const capped = Math.max(1, Math.min(perPage, MAX_PER_PAGE));

  const client = getClient();
  const response = await client.photos.search({
    query: trimmedQuery,
    per_page: capped,
  });

  if (isPexelsError(response)) {
    throw new PexelsRateLimitError(
      `Pexels search failed: ${response.error}`,
    );
  }

  const photos = (response as PhotosWithTotalResults).photos ?? [];
  return photos.map(normalizePhoto);
}

function normalizePhoto(photo: Photo): PexelsPhoto {
  return {
    id: photo.id,
    url: photo.url,
    src: {
      medium: photo.src.medium,
      large: photo.src.large,
      large2x: photo.src.large2x,
      original: photo.src.original,
    },
    photographer: photo.photographer,
    photographer_url: photo.photographer_url,
    alt: photo.alt ?? "",
  };
}

function isPexelsError(value: unknown): value is { error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
  );
}

/**
 * Build the human-readable attribution string Pexels asks API consumers
 * to display. Format: "Photo by {photographer} on Pexels".
 *
 * We store this on the question row so we can render attribution on the
 * TV reveal screen without re-querying.
 */
export function attributionFor(photo: PexelsPhoto): string {
  return `Photo by ${photo.photographer} on Pexels`;
}
