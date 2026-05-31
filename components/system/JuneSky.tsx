// June "Endless Evening" — the summer-evening atmosphere for the june theme.
//
// A living, sky-led color-field (warm coral/gold/periwinkle drifting, never
// quite repeating) with a thin cool water shimmer along the bottom edge. No
// objects, ever — pure light + motion. Rendered only via Weather → TVStage,
// so it is TV-only by construction.
//
// Reacts to two game moments via a module-level beat (mirrors Lightning.tsx's
// fireLightningBeat pattern so game-state callsites don't have to thread a
// prop 3-4 levels down through every TVStage):
//   • "lock"   — a player committed; the sky warms a touch.
//   • "reveal" — the answer is shown; the horizon swells + a soft bloom rises.
//
// Honors prefers-reduced-motion: renders a tasteful static gradient, no motion.

"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

export type JuneBeatKind = "lock" | "reveal";
type JuneBeatListener = (kind: JuneBeatKind) => void;

const beatListeners = new Set<JuneBeatListener>();

function subscribeJuneBeat(fn: JuneBeatListener): () => void {
  beatListeners.add(fn);
  return () => beatListeners.delete(fn);
}

/** Test-only alias so unit tests can subscribe without a mounted component. */
export const __subscribeJuneBeatForTest = subscribeJuneBeat;

/** Pulse the June sky from a game-state callsite. No-op unless a JuneSky is
 *  mounted (i.e. the current theme is june and a TVStage is on screen). */
export function fireJuneBeat(kind: JuneBeatKind): void {
  for (const fn of beatListeners) fn(kind);
}

export interface JuneSkyProps {
  /** 0 = off, 1 = default, >1 = heightened (finale). Matches Weather's contract. */
  intensity?: number;
}

export function JuneSky({ intensity = 1 }: JuneSkyProps) {
  const reduced = usePrefersReducedMotion();
  // beat state drives the reactive overlays; set in a later task.
  const [, setBeat] = useState<{ kind: JuneBeatKind; at: number } | null>(null);
  const clearRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduced) return;
    const unsub = subscribeJuneBeat((kind) => {
      setBeat({ kind, at: Date.now() });
      if (clearRef.current !== null) window.clearTimeout(clearRef.current);
      clearRef.current = window.setTimeout(() => setBeat(null), 1400);
    });
    return () => {
      unsub();
      if (clearRef.current !== null) window.clearTimeout(clearRef.current);
    };
  }, [reduced]);

  if (intensity <= 0) return null;

  // Visual layers added in a later task. For now render the static base so the
  // theme never looks broken mid-implementation.
  return (
    <div
      data-testid="june-sky"
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        background:
          "linear-gradient(180deg,#6E5DB6 0%, #C56E84 52%, #F2A65C 100%)",
        opacity: reduced ? 1 : 1,
      }}
    />
  );
}
