// Pick a default Pexels photo for a generated question + collect the
// alternatives for the host's "Twelve more" swap UI.
//
// Strategy:
//   * Search Pexels with the photoQuery Claude generated. The query is
//     2-4 words, concrete, and (per the prompt) does NOT contain the
//     literal answer text.
//   * The first result is the auto-attached photo. The other 11 are
//     stashed for the swap UI.
//   * If Pexels has zero results, we return imageUrl=null and an empty
//     alternatives list — the host can either upload her own or leave it
//     image-less. Returning null is NOT an error.
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
}

/**
 * Run a single Pexels search for the question's photoQuery and return
 * the default + alternatives. Pure logic — the calling job is responsible
 * for writing image_url + image_attribution + image_source='pexels' to
 * the database.
 */
export async function autoAttachPhoto(
  q: GeneratedQuestion,
): Promise<AttachedPhotoResult> {
  const photos = await searchPexels(q.photoQuery, 12);
  if (photos.length === 0) {
    return { imageUrl: null, attribution: null, alternatives: [] };
  }

  const first = photos[0]!;
  return {
    imageUrl: first.src.large2x,
    attribution: attributionFor(first),
    alternatives: photos.slice(1),
  };
}
