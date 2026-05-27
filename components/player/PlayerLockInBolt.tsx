// Phone-side bolt — the strike a player sees on their own phone the moment
// the server confirms their lock-in. Fires only when `active` is true,
// triggered by useAnswerSubmit's server-confirmed signal.
//
// Visually: a phone-scaled lightning bolt (smaller geometry than the TV
// Lightning component) shoots upward off the top of the screen, paired
// with a strobe-flash overlay tinted to the player's color. Total
// duration ~700ms — short enough to feel snappy, long enough to register.
//
// Reduced motion: no flash overlay. Bolt SVG still renders but without
// the high-contrast strobe.

"use client";

import { useEffect } from "react";
import { generateBolt, type BoltSegment } from "@/components/system/lightning-bolt";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

export interface PlayerLockInBoltProps {
  active: boolean;
  tint: string;
  /** Called once after the bolt animation completes (~700ms). */
  onComplete?: () => void;
}

const DURATION_MS = 700;
const BOLT_HEIGHT = 200;
const BOLT_WIDTH = 80;

export function PlayerLockInBolt({ active, tint, onComplete }: PlayerLockInBoltProps) {
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!active) return;
    const handle = setTimeout(() => onComplete?.(), DURATION_MS);
    return () => clearTimeout(handle);
  }, [active, onComplete]);

  if (!active) return null;

  // generateBolt takes absolute canvas coordinates, not a width/height box.
  // We place the bolt from top-center to bottom-center of our SVG viewport.
  const segments: BoltSegment[] = generateBolt({
    originX: BOLT_WIDTH / 2,
    originY: 0,
    targetX: BOLT_WIDTH / 2,
    targetY: BOLT_HEIGHT,
    depth: 5,
    branchChance: 0.15,
  });
  const path = segmentsToSvgPath(segments);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: -BOLT_HEIGHT,
        left: "50%",
        transform: "translateX(-50%)",
        width: BOLT_WIDTH,
        height: BOLT_HEIGHT,
        zIndex: 1000,
        pointerEvents: "none",
      }}
    >
      <svg
        data-testid="phone-bolt"
        width={BOLT_WIDTH}
        height={BOLT_HEIGHT}
        viewBox={`0 0 ${BOLT_WIDTH} ${BOLT_HEIGHT}`}
        style={{
          filter: `drop-shadow(0 0 6px #fff) drop-shadow(0 0 14px ${tint})`,
          animation: "phone-bolt-rise 0.7s ease-out forwards",
        }}
      >
        <path
          d={path}
          fill="none"
          stroke="white"
          strokeWidth={2.5}
          strokeLinejoin="miter"
          strokeLinecap="round"
        />
      </svg>
      {!reducedMotion && (
        <div
          data-testid="phone-bolt-flash"
          style={{
            position: "fixed",
            inset: 0,
            background: `radial-gradient(circle at center, ${tint}55, transparent 70%)`,
            mixBlendMode: "screen",
            pointerEvents: "none",
            animation: "phone-bolt-flash 0.7s ease-out forwards",
          }}
        />
      )}
      <style>{`
        @keyframes phone-bolt-rise {
          0% { transform: translateY(${BOLT_HEIGHT}px); opacity: 0; }
          15% { transform: translateY(${BOLT_HEIGHT * 0.6}px); opacity: 1; }
          70% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(-${BOLT_HEIGHT * 0.3}px); opacity: 0; }
        }
        @keyframes phone-bolt-flash {
          0%, 8% { opacity: 0; }
          12% { opacity: 1; }
          25% { opacity: 0.4; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function segmentsToSvgPath(segments: BoltSegment[]): string {
  if (segments.length === 0) return "";
  const [first, ...rest] = segments;
  return [
    `M${first!.x1},${first!.y1}`,
    ...segments.map((s) => `L${s.x2},${s.y2}`),
  ].join(" ");
}
