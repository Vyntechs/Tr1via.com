// The TR1VIA brand mark.
// "TR" + "VIA" are set in Geist (sans). The "1" is a Geist Mono numeral
// in the accent color, pretending to be a letter. Never substitute a capital
// "I". Never recolor the "1". Never set it in sans.
//
// Marked client because useTheme() reads from React context; Server
// Components that need the wordmark (not-found, etc.) re-render it as a
// child client island automatically.

"use client";

import type { CSSProperties } from "react";
import { useTheme } from "./ThemeProvider";

export interface WordmarkProps {
  size?: number;
  /** Override the accent color (defaults to current theme accent). */
  accent?: string;
  /** Override the ink/letter color (defaults to current theme ink). */
  ink?: string;
  tracking?: number;
  weight?: number;
  style?: CSSProperties;
}

export function Wordmark({
  size = 32,
  accent,
  ink,
  tracking = -0.025,
  weight = 700,
  style,
}: WordmarkProps) {
  const { t } = useTheme();
  const a = accent ?? t.accent;
  const i = ink ?? t.ink;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        fontFamily: "var(--font-sans)",
        fontWeight: weight,
        fontSize: size,
        letterSpacing: `${tracking}em`,
        lineHeight: 1,
        color: i,
        ...style,
      }}
    >
      <span>TR</span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontWeight: weight,
          color: a,
          fontSize: size * 1.04,
          margin: `0 ${size * 0.005}em`,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        1
      </span>
      <span>VIA</span>
    </span>
  );
}
