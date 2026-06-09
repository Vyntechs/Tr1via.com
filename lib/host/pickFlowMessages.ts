// Host-facing failure messages + resync decisions for the pick screen.
//
// The pick flow (edit → save → swap photo → upload → lock) talks to several
// routes that can fail in ways the host must never see raw. A question can be
// deleted out from under an open panel by a concurrent "↻ Another 20" reroll
// (→ 404), and a stale picked id can make Lock fail with a raw count string.
// These pure helpers translate every such failure into a recoverable,
// plain-language instruction and decide when the board must be re-fetched to
// reconcile a server-side change the client didn't make.
//
// Kept out of HostSetupPickClient so the mapping is unit-testable in isolation
// (the fetch-orchestrating parent component is, by convention, not mounted in
// tests — see lib/host/mergePickedAfterRefetch + generationFailureMessages).

// Shown whenever the host acts on a question that a regeneration already
// replaced. Same wording across edit / photo-swap / upload so the recovery
// step ("close this panel, pick a fresh one") is consistent.
export const QUESTION_REPLACED_MESSAGE =
  "This question was replaced by a regeneration — close this panel and pick a fresh one from the new batch.";

/**
 * Lock POST (`/api/categories/[id]/pick`) failed. The load-bearing case is a
 * picked id that a reroll deleted before the client refetched: the server
 * returns `badRequest("expected 7 questions in this category, found N")`.
 * The host must never see that raw — translate to a re-pick instruction.
 */
export function explainLockFailure(
  status: number,
  rawError?: string | null,
): string {
  const msg = (rawError ?? "").toLowerCase();
  const staleSet =
    status === 404 ||
    msg.includes("expected") ||
    msg.includes("found") ||
    msg.includes("not found");
  if (staleSet) {
    return "One of your picked questions was replaced by a regeneration. Re-pick to fill all 7 slots, then lock again.";
  }
  if (status === 401 || status === 403) {
    return "Your sign-in expired. Refresh the page and lock again.";
  }
  return "Couldn't lock the category. Refresh the page and try again.";
}

/**
 * Photo-swap PATCH (`/api/questions/[id]/photo`) failed. A 404 means the
 * question was rerolled away while the swap panel was open; anything else is a
 * transient save problem. Mapped purely by status so the route's raw
 * `failed to update photo: <pg message>` string can never reach the host.
 */
export function explainPhotoSaveFailure(status: number): string {
  if (status === 404) return QUESTION_REPLACED_MESSAGE;
  if (status === 401 || status === 403) {
    return "Your sign-in expired. Refresh the page and try again.";
  }
  return "Couldn't save that photo. Try another image or skip it for now.";
}

/**
 * Image-upload POST (`/api/images/upload`) failed. Maps Supabase Storage
 * errors to host-actionable guidance, and a 404 (question rerolled away mid
 * upload) to the shared replaced-question message. Moved here from
 * HostSetupPickClient so the 404 branch is covered by a unit test.
 */
export function explainUploadFailure(
  rawMessage: string | undefined,
  status: number,
): string {
  if (status === 404) return QUESTION_REPLACED_MESSAGE;
  const msg = (rawMessage ?? "").toLowerCase();
  if (msg.includes("too large")) {
    return "That file is over 10 MB. Try a smaller export or compress it first.";
  }
  if (msg.includes("supported image") || msg.includes("not a supported")) {
    return "That file isn't a PNG, JPEG, WEBP, or GIF. Pick a different image.";
  }
  if (msg.includes("empty file")) {
    return "That file came through empty. Try saving and uploading again.";
  }
  if (status === 401 || status === 403) {
    return "Your sign-in expired. Refresh the page and try again.";
  }
  if (status === 0 || status >= 500) {
    return "Storage didn't accept the upload. Try again in a moment.";
  }
  return rawMessage?.trim()
    ? rawMessage
    : "The upload didn't go through. Try a different file or retry.";
}

/**
 * Did a save change a question's board slot? When it did, the server's
 * `swap_point_value` RPC may have *displaced* whatever row held the target
 * slot (picked OR not) — a second row the client never saw change. The board
 * must be refetched to reconcile that displaced row, or the preview drifts
 * (two cards rendered at the same point value until the next load).
 *
 * Treats null/undefined as "unplaced" so clearing or first-assigning a slot is
 * detected too.
 */
export function pointValueChanged(
  prev: number | null | undefined,
  next: number | null | undefined,
): boolean {
  return (prev ?? null) !== (next ?? null);
}
