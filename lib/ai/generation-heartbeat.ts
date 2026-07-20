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

  async function drain(): Promise<void> {
    await inFlight;
  }

  return { beat, drain };
}
