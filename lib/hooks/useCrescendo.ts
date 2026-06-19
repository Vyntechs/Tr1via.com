// useCrescendo — drives the finale "build" by animating an intensity value from
// `from` up to `to` over `durationMs`, which the Pyrotechnics engine reads live
// to escalate the show into the synchronized erupt beat. Thin rAF wrapper around
// the pure crescendoIntensity curve.
//
// Reduced motion: skip the animation entirely and sit at the peak. The engine's
// reduced-motion fallback is a static glow that ignores the value anyway, so
// there's nothing to animate and no rAF to spin.

"use client";

import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import { crescendoIntensity, type CrescendoConfig } from "@/lib/game/crescendo";

export function useCrescendo({ from, to, durationMs }: CrescendoConfig): number {
  const reduced = usePrefersReducedMotion();
  const [intensity, setIntensity] = useState(from);

  useEffect(() => {
    // Reduced motion (or no rAF clock): no ramp — the value is read straight
    // from the `reduced ? to` short-circuit below, so the effect does nothing
    // and never setStates synchronously.
    if (reduced || typeof requestAnimationFrame !== "function") return;
    let raf = 0;
    let startMs = 0;
    let lastEmitMs = 0;
    const step = (now: number) => {
      if (startMs === 0) startMs = now;
      const elapsed = now - startMs;
      const done = elapsed >= durationMs;
      // Throttle React updates to ~12/sec. The engine reads intensity live and
      // interpolates cadence/density smoothly between steps, so a per-frame
      // setState would re-render the finale subtree 60×/s for no visible gain —
      // and could jank a weak venue laptop already running the canvas RAF.
      // Always emit the final peak. setState here is in the rAF callback (an
      // external clock), not synchronously in the effect body.
      if (done || now - lastEmitMs >= 80) {
        lastEmitMs = now;
        setIntensity(crescendoIntensity(elapsed, { from, to, durationMs }));
      }
      if (!done) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [reduced, from, to, durationMs]);

  // Reduced motion sits at the peak (the engine's static fallback ignores the
  // value anyway); otherwise return the live ramp value.
  return reduced ? to : intensity;
}
