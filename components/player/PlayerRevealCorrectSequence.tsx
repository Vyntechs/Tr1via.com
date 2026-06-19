"use client";

import { useEffect, useState } from "react";
import { Weather, useTheme } from "@/components/system";
import { PlayerRevealCorrect, type PlayerRevealCorrectProps } from "./PlayerRevealCorrect";

export interface PlayerRevealCorrectSequenceProps {
  /** Total correct (incl. you) — drives the social line on the payoff. */
  correctCount?: number;
  /** Everything the bright payoff needs (category, value, awardedPoints, …). */
  payoffProps?: PlayerRevealCorrectProps;
  /** How long the dark fireworks moment holds before the payoff. */
  darkMs?: number;
}

/**
 * The correct player's cinematic reveal: a dark navy sky where real fireworks
 * ignite in sync with the TV (the salvo beat is published by the gated
 * conductor on the player route, and the engine mounted here draws it), then a
 * gentle transition into the bright "Correct! +points" payoff carrying the
 * social line. Glowing fireworks wash out on the bright takeover, so they play
 * during this dark beat first. Reduced motion: Weather renders its static glow.
 */
export function PlayerRevealCorrectSequence({
  correctCount,
  payoffProps,
  darkMs = 1000,
}: PlayerRevealCorrectSequenceProps) {
  const { themeKey } = useTheme();
  const [phase, setPhase] = useState<"dark" | "bright">("dark");

  useEffect(() => {
    const h = window.setTimeout(() => setPhase("bright"), darkMs);
    return () => window.clearTimeout(h);
  }, [darkMs]);

  if (phase === "bright") {
    return <PlayerRevealCorrect {...payoffProps} correctCount={correctCount} />;
  }

  return (
    <div
      data-testid="reveal-correct-dark"
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background: "#0E1A36",
        display: "flex",
        flexDirection: "column",
        animation: "tr1via-correct-flash .5s ease-out both",
      }}
    >
      {/* Phase-1 engine on a dark sky; the salvo beat ignites the burst in sync. */}
      <Weather themeKey={themeKey} intensity={2.2} />
    </div>
  );
}
