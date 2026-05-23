// Drifting particle field. Used by every weather pattern (snow, hearts,
// clovers, leaves, pumpkins, pine, rain). Each particle gets stable
// per-particle randomness via a seed so positions don't jitter on theme
// change. Pure visual decoration — pointer-events: none.
//
// Honors `prefers-reduced-motion: reduce` — skips render entirely rather
// than freezing particles in mid-air via the CSS catch-all in globals.css.

"use client";

import { useMemo, type ComponentType } from "react";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

interface ParticleFieldProps {
  count?: number;
  /** Render function for each particle, given its size + color. */
  Glyph: ComponentType<{ size?: number; color?: string }>;
  sizeRange?: [number, number];
  durationRange?: [number, number];
  colors?: string[];
  opacityRange?: [number, number];
  driftRange?: [number, number];
  spinRange?: [number, number];
  seed?: number;
}

export function ParticleField({
  count = 14,
  Glyph,
  sizeRange = [6, 12],
  durationRange = [12, 22],
  colors = ["#fff"],
  opacityRange = [0.2, 0.5],
  driftRange = [-30, 30],
  spinRange = [-180, 180],
  seed = 1,
}: ParticleFieldProps) {
  const reduced = usePrefersReducedMotion();
  const particles = useMemo(() => {
    let h = (seed * 2654435761) >>> 0;
    const r = () => {
      h = (h * 1664525 + 1013904223) >>> 0;
      return h / 0xffffffff;
    };
    return Array.from({ length: count }, (_, i) => ({
      i,
      left: r() * 100,
      delay: r() * durationRange[1],
      duration: durationRange[0] + r() * (durationRange[1] - durationRange[0]),
      size: sizeRange[0] + r() * (sizeRange[1] - sizeRange[0]),
      color: colors[Math.floor(r() * colors.length)],
      opacity: opacityRange[0] + r() * (opacityRange[1] - opacityRange[0]),
      drift: driftRange[0] + r() * (driftRange[1] - driftRange[0]),
      spin: spinRange[0] + r() * (spinRange[1] - spinRange[0]),
    }));
  }, [count, seed, sizeRange, durationRange, colors, opacityRange, driftRange, spinRange]);

  if (reduced) return null;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
      {particles.map((p) => (
        <div
          key={p.i}
          style={{
            position: "absolute",
            left: `${p.left}%`,
            top: "-12%",
            width: p.size,
            height: p.size,
            opacity: p.opacity,
            animation: `tr1via-drift-down ${p.duration}s linear ${-p.delay}s infinite`,
            // Custom CSS vars consumed by tr1via-drift-down keyframes
            ["--drift" as string]: `${p.drift}px`,
            ["--spin" as string]: `${p.spin}deg`,
          } as React.CSSProperties}
        >
          <Glyph size={p.size} color={p.color} />
        </div>
      ))}
    </div>
  );
}
