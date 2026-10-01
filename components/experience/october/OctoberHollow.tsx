// October's weather: the still Sleepy Hollow scene, for every surface that
// isn't the live TV world — player phones, the host's laptop screens, the
// theme cards. A painted scene plus a low ember glow along the bottom; the
// glow's slow flicker is CSS, so reduced motion stills it.

"use client";

import { useMemo } from "react";
import { HOLLOW_PHONE, HOLLOW_TV, artUrl } from "./art";

export interface OctoberHollowProps {
  /** Phone-sized surface: use the tall phone scene. */
  compact?: boolean;
  /** False when the surface paints its own background: glow only. */
  substrate?: boolean;
  intensity?: number;
}

export function OctoberHollow({ compact = false, substrate = true, intensity = 1 }: OctoberHollowProps) {
  const url = useMemo(() => artUrl(compact ? HOLLOW_PHONE : HOLLOW_TV), [compact]);
  return (
    <div
      aria-hidden
      data-testid="october-hollow"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}
    >
      {substrate ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "50% 100%",
          }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(120% 40% at 50% 100%, rgba(240,140,42,${Math.min(0.32, 0.13 * intensity)}), transparent 60%)`,
          animation: "tr1via-glow-flicker 4.2s ease-in-out infinite",
          mixBlendMode: "screen",
        }}
      />
    </div>
  );
}
