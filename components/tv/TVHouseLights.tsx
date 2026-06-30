"use client";

import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import { deriveHouseLightsPresence } from "@/lib/room-magic/house-lights";

export interface TVHouseLightsProps {
  roomMagicEnabled: boolean;
  lockedCount: number | null | undefined;
  totalPlayers: number | null | undefined;
  accent: string;
}

const INTENSITY_OPACITY = {
  idle: 0.12,
  low: 0.18,
  medium: 0.28,
  high: 0.38,
} as const;

export function TVHouseLights({
  roomMagicEnabled,
  lockedCount,
  totalPlayers,
  accent,
}: TVHouseLightsProps) {
  const reducedMotion = usePrefersReducedMotion();
  const presence = deriveHouseLightsPresence({
    roomMagicEnabled,
    lockedCount,
    totalPlayers,
  });

  if (!presence) return null;

  const opacity = INTENSITY_OPACITY[presence.intensity];
  const animation = reducedMotion
    ? "none"
    : "tr1via-house-lights-breathe 2.4s ease-in-out infinite";

  return (
    <div
      aria-hidden="true"
      data-reduced-motion={String(reducedMotion)}
      data-testid="tv-house-lights"
      style={{
        position: "absolute",
        inset: 12,
        borderRadius: 24,
        pointerEvents: "none",
        zIndex: 0,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} 24%, transparent), inset 0 0 58px color-mix(in srgb, ${accent} ${Math.round(opacity * 100)}%, transparent)`,
        opacity: presence.lockedCount === 0 ? 0.62 : 1,
        animation,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "5%",
          right: "5%",
          bottom: 10,
          height: 5,
          borderRadius: 999,
          background: "rgba(255,255,255,.10)",
          overflow: "hidden",
        }}
      >
        <div
          data-testid="tv-house-lights-fill"
          style={{
            width: `${presence.progressPct}%`,
            height: "100%",
            borderRadius: 999,
            background: accent,
            transition: reducedMotion ? "none" : "width .32s ease",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: "5%",
          bottom: 22,
          color: "rgba(244,230,196,.74)",
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: 0,
          textTransform: "uppercase",
        }}
      >
        {presence.lockedCount} of {presence.totalPlayers} locked in
      </div>
      <style>{`
        @keyframes tr1via-house-lights-breathe {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(1.16); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-testid="tv-house-lights"] {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
