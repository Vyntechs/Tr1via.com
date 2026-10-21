/**
 * Coalesces durable generation heartbeats so a terminal state never loses to
 * a late interval write. Call drain() after stopping the interval, before a
 * caller records ready or needs_attention.
 */
export function createGenerationHeartbeat(write: () => Promise<void>) {
  let inFlight: Promise<void> | null = null;

  function beat(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = write()
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  /** Never throws. A heartbeat is only a sign of life: if the last one hit a
   *  one-off database error, that must not fail a build whose questions are
   *  all saved. The terminal ready / needs_attention write after this is
   *  fenced by attempt on its own, so nothing stale can win. */
  async function drain(): Promise<void> {
    await inFlight?.catch(() => undefined);
  }

  return { beat, drain };
}
