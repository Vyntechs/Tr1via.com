// Pure ramp math for the finale "build → erupt" crescendo. The synchronized
// erupt is the Phase-2 firework beat (a burst cluster every July screen fires at
// the same instant); the BUILD is this rising intensity, which the Pyrotechnics
// engine reads live to tighten cadence + grow multi-shell salvos + density as it
// climbs. Smoothstep so the ramp eases in and out rather than ramping linearly.
//
// Kept pure (no React, no time source passed implicitly) so the curve is
// unit-testable; useCrescendo wraps it with a rAF clock.

export interface CrescendoConfig {
  /** Intensity at elapsed 0 (must be > 0 so the engine stays running). */
  from: number;
  /** Peak intensity at elapsed >= durationMs. */
  to: number;
  /** Ramp length in ms. */
  durationMs: number;
}

/** Intensity at `elapsedMs` into the ramp. Clamped to [from, to]. */
export function crescendoIntensity(elapsedMs: number, config: CrescendoConfig): number {
  const { from, to, durationMs } = config;
  if (durationMs <= 0) return to;
  const t = Math.max(0, Math.min(1, elapsedMs / durationMs));
  // smoothstep: 3t² − 2t³ — zero slope at both ends.
  const eased = t * t * (3 - 2 * t);
  return from + (to - from) * eased;
}
