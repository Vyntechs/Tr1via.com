// "Show answer now" races the timer, and the host always loses that race
// gracefully.
//
// The console decides whether to offer "Show answer now" from its room
// snapshot. The server resolves a question the instant its timer expires.
// Between the expiry and the next snapshot the console still shows the
// button, so a host tapping it at the wrong second gets a 409 back for
// something that already happened.
//
// That 409 is not a failure. The host wanted the answer on screen; the
// answer is on screen. Treating it as an error puts a red banner in front
// of a room of players for a non-event — which is exactly the moment a
// host least needs to wonder whether the app broke.
//
// Only THIS 409 is benign. "question is not live" (never revealed) and
// "not all eligible players are locked" mean the host's intent did not
// happen, and those must still surface.

/** The server's wording for "the timer already did what you just asked for."
 *  Matches `app/api/games/[id]/end-early/route.ts`. */
const ALREADY_RESOLVED = "question is already resolved";

/**
 * True when an end-early rejection means the question had already resolved
 * on its own — i.e. the host's intent is satisfied and there is nothing to
 * report. Matches leniently so a future rewording ("this question is
 * already resolved.") stays benign rather than turning back into a banner.
 */
export function isAlreadyResolved(serverError: string | null | undefined): boolean {
  if (!serverError) return false;
  return serverError.toLowerCase().includes(ALREADY_RESOLVED);
}
