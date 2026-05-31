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
  // beat state drives the reactive overlays.
  const [beat, setBeat] = useState<{ kind: JuneBeatKind; at: number } | null>(null);
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

  // Reduced motion: a single calm static evening gradient. No animation,
  // no reactive overlays.
  if (reduced) {
    return (
      <div
        data-testid="june-sky"
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "linear-gradient(180deg,#6E5DB6 0%, #C56E84 52%, #F7D9B0 100%)",
        }}
      />
    );
  }

  const lockActive = beat?.kind === "lock";
  const revealActive = beat?.kind === "reveal";

  return (
    <div
      data-testid="june-sky"
      aria-hidden
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}
    >
      {/* Layer 1 — the drifting warm sky (sky-led: fills the whole stage). */}
      <div
        style={{
          position: "absolute",
          inset: "-20%",
          // backgroundImage (longhand) — NOT the `background` shorthand — paired
          // with backgroundSize below. The shorthand resets background-size to
          // auto on re-render (e.g. when the lock filter changes), which both
          // breaks the drift (the 200% size gives the gradient room to move) and
          // trips React's shorthand/longhand-conflict warning.
          backgroundImage:
            "radial-gradient(55% 50% at 28% 22%, #F6B45C 0%, transparent 60%)," +
            "radial-gradient(60% 55% at 82% 26%, #E85C82 0%, transparent 60%)," +
            "linear-gradient(180deg,#6E5DB6 0%, #C56E84 52%, #F2A65C 100%)",
          backgroundSize: "200% 200%, 200% 200%, 100% 100%",
          animation: "tr1via-june-drift 18s ease-in-out infinite",
          // Lock-in warms the whole field a touch via saturation/brightness.
          filter: lockActive ? "blur(6px) saturate(1.18) brightness(1.06)" : "blur(6px)",
          transition: "filter 700ms ease-out",
        }}
      />

      {/* Water body — a cool mirror of the warm sky, pinned to the bottom band,
          breathing slowly at rest. The same evening light, reflected cooler. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "26%",
          mixBlendMode: "screen",
          backgroundImage:
            "linear-gradient(0deg, rgba(120,200,220,.55) 0%, rgba(150,190,225,.30) 45%, transparent 100%)," +
            "radial-gradient(120% 90% at 50% 120%, rgba(255,225,180,.28) 0%, transparent 60%)",
          filter: "blur(3px)",
          animation: "tr1via-water-breathe 7s ease-in-out infinite",
        }}
      />

      {/* Layer 2 — thin cool water shimmer along the very bottom (the sliver). */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "18%",
          mixBlendMode: "screen",
          background:
            "radial-gradient(closest-side, rgba(190,255,248,.55), transparent 70%) 18% 60%/110px 60px," +
            "radial-gradient(closest-side, rgba(210,255,250,.45), transparent 70%) 62% 70%/140px 70px," +
            "radial-gradient(closest-side, rgba(255,245,220,.5), transparent 70%) 84% 55%/90px 50px",
          backgroundRepeat: "no-repeat",
          filter: "blur(2px)",
          animation: "tr1via-june-shimmer 9s ease-in-out infinite",
        }}
      />

      {/* Layer 3 — the glowing horizon seam where sky meets water. Swells on reveal. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: "16%",
          height: revealActive ? "44px" : "26px",
          background:
            "linear-gradient(180deg, transparent 0%, rgba(255,236,190,.7) 50%, rgba(160,220,225,.35) 70%, transparent 100%)",
          filter: "blur(2px)",
          opacity: revealActive ? 1 : 0.7,
          transition: "height 600ms ease-out, opacity 600ms ease-out",
        }}
      />

      {/* Layer 4 — reveal bloom: a soft light rising once when "reveal" fires.
          key={beat.at} restarts the one-shot breathe animation each reveal. */}
      {revealActive && (
        <div
          key={beat?.at}
          style={{
            position: "absolute",
            left: "50%",
            bottom: "10%",
            width: "60%",
            height: "55%",
            transform: "translateX(-50%)",
            background:
              "radial-gradient(closest-side, rgba(255,238,200,.6), transparent 72%)",
            animation: "tr1via-june-breathe 1300ms ease-out forwards",
          }}
        />
      )}

      {/* Reveal reflection — the warm bloom above, caught cool on the water.
          Same light, two media. Mirrors the bloom's centered position. */}
      {revealActive && (
        <div
          key={`reflect-${beat?.at}`}
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            bottom: 0,
            width: "70%",
            height: "30%",
            transform: "translateX(-50%)",
            transformOrigin: "bottom center",
            mixBlendMode: "screen",
            backgroundImage:
              "radial-gradient(closest-side, rgba(150,225,235,.6) 0%, rgba(170,210,240,.25) 45%, transparent 75%)",
            filter: "blur(4px)",
            animation: "tr1via-water-reflect 1300ms ease-out forwards",
          }}
        />
      )}

      {/* Lock-in ripple — a drop into the pool. key={beat.at} restarts the ring
          on every new lock so bursts read as multiple drops. */}
      {lockActive && (
        <div
          key={beat?.at}
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            bottom: "13%",
            width: "42%",
            height: "42%",
            borderRadius: "50%",
            border: "2px solid rgba(170,225,235,.5)",
            transform: "translate(-50%, -50%)",
            animation: "tr1via-water-ripple 1100ms ease-out forwards",
          }}
        />
      )}
    </div>
  );
}
