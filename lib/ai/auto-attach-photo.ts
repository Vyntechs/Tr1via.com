// Pick a default Pexels photo for a generated question + collect the
// alternatives for the host's "Twelve more" swap UI.
//
// Strategy — cascade so SOMETHING always attaches:
//   1. Claude's photoQuery (2-4 concrete words, no answer leak). First hit
//      is the default; the next 11 are stashed for the swap UI.
//   2. If zero hits, retry with the category topic — the topic always has
//      mass-appeal photos in Pexels' library.
//   3. If still zero, retry with a final generic visual fallback so the
//      card NEVER renders empty. A generic landscape is better than a
//      striped placeholder.
//   4. Only if all three queries return zero do we give up and return
//      null — that should be essentially impossible against Pexels.
//
// Failure handling:
//   * Rate-limit / API failures bubble up as PexelsRateLimitError. The
//     background job catches that and broadcasts an error event.

import "server-only";

import {
  searchPexels,
  attributionFor,
  type PexelsPhoto,
} from "@/lib/pexels/search";
import type { GeneratedQuestion } from "./generate-questions";

export interface AttachedPhotoResult {
  /** The default photo's display URL (large2x or large). null = none found. */
  imageUrl: string | null;
  /** Human-readable photographer attribution. null when imageUrl is null. */
  attribution: string | null;
  /** Up to 11 other photos for the swap UI. */
  alternatives: PexelsPhoto[];
  /** Which query ultimately produced the result. "primary" = Claude's
   *  photoQuery; "topic" = category topic fallback; "generic" = visual
   *  fallback. Useful for logging + future quality tracking. */
  source?: "primary" | "topic" | "generic";
}

export interface AutoAttachOptions {
  /** Category topic — used as the secondary fallback query. */
  topic?: string;
}

const GENERIC_FALLBACK_QUERY = "abstract texture";

/**
 * Cascade through up to three Pexels queries until we get a hit. Pure
 * logic — the calling job writes image_url + image_attribution +
 * image_source='pexels' to the database.
 */
export async function autoAttachPhoto(
  q: GeneratedQuestion,
  opts: AutoAttachOptions = {},
): Promise<AttachedPhotoResult> {
  // 1. Primary query — Claude's per-question photoQuery
  let photos = await searchPexels(q.photoQuery, 12);
  let source: AttachedPhotoResult["source"] = "primary";

  // 2. Topic fallback — Pexels almost always has results for the broad
  //    topic name; better than rendering nothing
  if (photos.length === 0 && opts.topic && opts.topic.trim().length > 0) {
    photos = await searchPexels(opts.topic.trim(), 12);
    source = "topic";
  }

  // 3. Generic visual fallback — a textured abstract is better than the
  //    striped placeholder card
  if (photos.length === 0) {
    photos = await searchPexels(GENERIC_FALLBACK_QUERY, 12);
    source = "generic";
  }

  if (photos.length === 0) {
    // Pexels truly returned nothing for any query — extremely rare. Caller
    // surfaces the striped placeholder.
    return { imageUrl: null, attribution: null, alternatives: [] };
  }

  const first = photos[0]!;
  return {
    imageUrl: first.src.large2x,
    attribution: attributionFor(first),
    alternatives: photos.slice(1),
    source,
  };
}
