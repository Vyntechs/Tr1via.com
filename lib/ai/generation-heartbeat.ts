/**
 * Coalesces durable generation heartbeats so a terminal state never loses to
 * a late interval write. Call drain() after stopping the interval, before a
 * caller records ready or needs_attention.
 */
export function createGenerationHeartbeat(write: () => Promise<void>) {
  let inFlight: Promise<void> | null = null;

  function beat(): void {
    if (inFlight) return;
    inFlight = write()
      // A heartbeat is observational. The job's real work and terminal state
      // remain authoritative even when a best-effort tick cannot be written.
      .catch(() => undefined)
      .finally(() => {
        inFlight = null;
      });
  }

  async function drain(): Promise<void> {
    await inFlight;
  }

  return { beat, drain };
}
